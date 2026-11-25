// Shared pieces for the tests: temp folders, a local file server with Range support and a ZIP writer.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const zlib = require("zlib");

function tempDir(t, prefix = "downy-test-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Serves `files` ({ "/path": { body, type, name, hold } }) on 127.0.0.1. With ranges off it
// ignores Range headers like many simple servers do. `deny` answers 403 to that many
// requests first, like an expired YouTube link. `log` collects every request.
//
// A file with `hold: true` gets no answer until `release(path)`, so a test can keep a
// download running for as long as it needs. `hold(path)` holds a file from then on.
// `requested()` lists the paths in the order the server first saw them, and
// `asked(path, n)` waits until the server has had n requests for path.
async function fileServer(t, files, { ranges = true, deny = 0 } = {}) {
  const log = [];
  const held = new Map(); // path -> answers waiting for release()
  const watchers = new Set();
  const count = (p) => log.filter((r) => r.path === p).length;

  const answer = (req, res, file) => {
    if (res.destroyed || req.socket.destroyed) return;
    if (typeof deny === "function" ? deny(req) : deny > 0) {
      if (typeof deny === "number") deny--;
      res.writeHead(403);
      return res.end();
    }
    const headers = { "Content-Type": file.type || "application/octet-stream" };
    if (file.name) headers["Content-Disposition"] = file.name;
    const m = ranges && /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
    if (m) {
      const start = Number(m[1]);
      const end = Math.min(m[2] ? Number(m[2]) : file.body.length - 1, file.body.length - 1);
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${file.body.length}`, "Content-Length": end - start + 1 });
      return res.end(file.body.subarray(start, end + 1));
    }
    res.writeHead(200, { ...headers, "Content-Length": file.body.length });
    res.end(file.body);
  };

  const server = http.createServer((req, res) => {
    const p = req.url.split("?")[0];
    log.push({ url: req.url, path: p, range: req.headers.range, headers: req.headers, remoteAddress: req.socket.remoteAddress });
    for (const w of watchers) w();
    const file = files[p];
    if (!file) {
      res.writeHead(404);
      return res.end();
    }
    if (file.hold) {
      if (!held.has(p)) held.set(p, []);
      held.get(p).push(() => answer(req, res, file));
      return;
    }
    answer(req, res, file);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => {
    held.clear();
    server.closeAllConnections();
    server.close(resolve);
  }));

  const hold = (p) => {
    files[p].hold = true;
  };
  const release = (p) => {
    files[p].hold = false;
    const waiting = held.get(p) || [];
    held.delete(p);
    for (const go of waiting) go();
  };
  const requested = () => [...new Set(log.map((r) => r.path))];
  const asked = (p, n = 1) => new Promise((resolve, reject) => {
    const check = () => {
      if (count(p) < n) return;
      watchers.delete(check);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      watchers.delete(check);
      reject(new Error(`The server got ${count(p)} of ${n} requests for ${p}`));
    }, 5000);
    watchers.add(check);
    check();
  });
  return { base: `http://127.0.0.1:${server.address().port}`, log, hold, release, requested, asked };
}

const randomBytes = (n) => crypto.randomBytes(n);

// Writes a ZIP archive in memory. Each entry: { name, data, method (0 stored, 8 deflate),
// descriptor (sizes and CRC after the data), utf8 (sets flag bit 11), nameBytes (raw name),
// encrypted (sets flag bit 0), crc and size (wrong ones on purpose), localExtra (an extra field
// only in the local header) }. zip64 writes ZIP64 extra fields and end records for every entry.
// Returns { body, entries: [{ name, data, offset }] }.
function makeZip(list, { zip64 = false, prefix = Buffer.alloc(0), comment = "" } = {}) {
  const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
  const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
  const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
  const parts = [prefix];
  const central = [];
  const out = [];
  let pos = prefix.length;
  const push = (buf) => {
    parts.push(buf);
    pos += buf.length;
  };
  for (const e of list) {
    const data = Buffer.from(e.data ?? "");
    const name = e.nameBytes || Buffer.from(e.name, "utf8");
    const method = e.method ?? 0;
    const packed = method === 8 ? zlib.deflateRawSync(data) : data;
    const crc = e.crc ?? zlib.crc32(data);
    const size = e.size ?? data.length;
    const flags = (e.utf8 ? 0x800 : 0) | (e.descriptor ? 0x8 : 0) | (e.encrypted ? 0x1 : 0);
    const offset = pos;
    const localExtra = e.localExtra || Buffer.alloc(0);
    push(Buffer.concat([
      u32(0x04034b50), u16(zip64 ? 45 : 20), u16(flags), u16(method), u16(0), u16(0x21),
      u32(e.descriptor ? 0 : crc), u32(e.descriptor ? 0 : packed.length), u32(e.descriptor ? 0 : size),
      u16(name.length), u16(localExtra.length), name, localExtra, packed,
    ]));
    if (e.descriptor) push(Buffer.concat([u32(0x08074b50), u32(crc), u32(packed.length), u32(size)]));
    const extra = zip64 ? Buffer.concat([u16(1), u16(24), u64(size), u64(packed.length), u64(offset)]) : Buffer.alloc(0);
    central.push(Buffer.concat([
      u32(0x02014b50), u16(0x031e), u16(zip64 ? 45 : 20), u16(flags), u16(method), u16(0), u16(0x21), u32(crc),
      u32(zip64 ? 0xffffffff : packed.length), u32(zip64 ? 0xffffffff : size),
      u16(name.length), u16(extra.length), u16(0), u16(0), u16(0), u32(/\/$/.test(e.name || "") ? 0x10 : 0),
      u32(zip64 ? 0xffffffff : offset), name, extra,
    ]));
    out.push({ name: e.name, data, offset });
  }
  const cdOffset = pos;
  const cd = Buffer.concat(central);
  push(cd);
  if (zip64) {
    const recAt = pos;
    push(Buffer.concat([u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0), u64(list.length), u64(list.length), u64(cd.length), u64(cdOffset)]));
    push(Buffer.concat([u32(0x07064b50), u32(0), u64(recAt), u32(1)]));
  }
  push(Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(zip64 ? 0xffff : list.length), u16(zip64 ? 0xffff : list.length),
    u32(zip64 ? 0xffffffff : cd.length), u32(zip64 ? 0xffffffff : cdOffset), u16(Buffer.byteLength(comment)), Buffer.from(comment),
  ]));
  return { body: Buffer.concat(parts), entries: out };
}

module.exports = { tempDir, fileServer, randomBytes, makeZip };
