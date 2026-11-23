// Picking files out of a ZIP archive on a web server without downloading all of it.
//
// A ZIP keeps its table of contents (the central directory) at the end of the file and
// says where each entry starts. With Range requests Downy reads the directory, then fetches
// only the byte spans of the chosen entries and unpacks them from those spans.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { Readable, Transform } = require("stream");
const { pipeline } = require("stream/promises");

const SIG = { end: 0x06054b50, end64: 0x06064b50, locator64: 0x07064b50, central: 0x02014b50, local: 0x04034b50 };
const END_SIZE = 22;
const MAX_COMMENT = 0xffff;
const MAX_DIRECTORY = 64 * 1024 * 1024;
// Fetching a gap this small between two chosen entries beats making more requests.
const MERGE_GAP = 1024 * 1024;
const READ_TIMEOUT = 10000;
const FLAG_ENCRYPTED = 0x1;
const FLAG_UTF8 = 0x800;
const STORED = 0;
const DEFLATE = 8;

const damaged = () => new Error("The ZIP archive is damaged");

// ---------------------------------------------------------------- names

// The upper half of code page 437, which ZIP tools used for names before UTF-8.
const CP437 =
  "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐" +
  "└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

function decodeName(bytes, utf8) {
  if (utf8) return new TextDecoder("utf-8").decode(bytes);
  try {
    return strictUtf8.decode(bytes);
  } catch {
    return Array.from(bytes, (b) => (b < 0x80 ? String.fromCharCode(b) : CP437[b - 0x80])).join("");
  }
}

// ------------------------------------------------------------ directory

// The end of central directory record sits in the last 22 bytes plus a comment of up to 64 KB.
function findEnd(tail) {
  for (let at = tail.length - END_SIZE; at >= 0; at--) {
    if (tail.readUInt32LE(at) === SIG.end && at + END_SIZE + tail.readUInt16LE(at + 20) <= tail.length) return at;
  }
  return -1;
}

// The ZIP64 extra field holds the real sizes and offset for each value the record set to all ones.
function readZip64Extra(extra, entry) {
  for (let p = 0; p + 4 <= extra.length; ) {
    const id = extra.readUInt16LE(p);
    const len = extra.readUInt16LE(p + 2);
    const end = p + 4 + len;
    if (end > extra.length) break;
    if (id === 0x0001) {
      let q = p + 4;
      const next = () => {
        if (q + 8 > end) throw damaged();
        const v = Number(extra.readBigUInt64LE(q));
        q += 8;
        return v;
      };
      if (entry.size === 0xffffffff) entry.size = next();
      if (entry.csize === 0xffffffff) entry.csize = next();
      if (entry.offset === 0xffffffff) entry.offset = next();
      return;
    }
    p = end;
  }
}

function parseCentral(cd, count, cdOffset) {
  if (count > cd.length / 46) throw damaged();
  const entries = [];
  let p = 0;
  for (let index = 0; index < count; index++) {
    if (p + 46 > cd.length || cd.readUInt32LE(p) !== SIG.central) throw damaged();
    const flags = cd.readUInt16LE(p + 8);
    const method = cd.readUInt16LE(p + 10);
    const nameLen = cd.readUInt16LE(p + 28);
    const extraLen = cd.readUInt16LE(p + 30);
    const commentLen = cd.readUInt16LE(p + 32);
    const next = p + 46 + nameLen + extraLen + commentLen;
    if (next > cd.length) throw damaged();
    if (cd.readUInt16LE(p + 34) !== 0 && cd.readUInt16LE(p + 34) !== 0xffff) throw new Error("ZIP archives split over several files are not supported");
    const entry = {
      index,
      name: decodeName(cd.subarray(p + 46, p + 46 + nameLen), flags & FLAG_UTF8),
      size: cd.readUInt32LE(p + 24),
      csize: cd.readUInt32LE(p + 20),
      offset: cd.readUInt32LE(p + 42),
      method,
      crc: cd.readUInt32LE(p + 16),
      flags,
      dir: false,
      supported: false,
    };
    readZip64Extra(cd.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen), entry);
    if (entry.offset + 30 > cdOffset) throw damaged();
    entry.dir = /[/\\]$/.test(entry.name);
    entry.supported = !(flags & FLAG_ENCRYPTED) && (method === STORED || method === DEFLATE);
    entries.push(entry);
    p = next;
  }
  return entries;
}

// read(start, length) returns those bytes of the archive. Returns the Directory:
// { entries, cdOffset, cdSize }.
async function directoryOf(read, size) {
  if (size < END_SIZE) throw new Error("This is not a ZIP archive");
  const tailStart = Math.max(0, size - MAX_COMMENT - END_SIZE);
  const tail = await read(tailStart, size - tailStart);
  const from = (start, len) => (start >= tailStart && start + len <= size ? tail.subarray(start - tailStart, start - tailStart + len) : read(start, len));

  const at = findEnd(tail);
  if (at < 0) throw new Error("This is not a ZIP archive");
  if (tail.readUInt16LE(at + 4) !== 0 || tail.readUInt16LE(at + 6) !== 0) throw new Error("ZIP archives split over several files are not supported");
  let count = tail.readUInt16LE(at + 10);
  let cdSize = tail.readUInt32LE(at + 12);
  let cdOffset = tail.readUInt32LE(at + 16);
  let cdEnd = tailStart + at;

  if (cdEnd >= 20) {
    const loc = await from(cdEnd - 20, 20);
    if (loc.readUInt32LE(0) === SIG.locator64) {
      if (loc.readUInt32LE(4) !== 0 || loc.readUInt32LE(16) > 1) throw new Error("ZIP archives split over several files are not supported");
      const recAt = Number(loc.readBigUInt64LE(8));
      if (recAt + 56 > cdEnd - 20) throw damaged();
      const rec = await from(recAt, 56);
      if (rec.readUInt32LE(0) !== SIG.end64) throw damaged();
      if (rec.readUInt32LE(16) !== 0 || rec.readUInt32LE(20) !== 0) throw new Error("ZIP archives split over several files are not supported");
      count = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOffset = Number(rec.readBigUInt64LE(48));
      cdEnd = recAt;
    }
  }
  // Data in front of the archive, as in a self-extracting program, would shift every offset.
  if (cdOffset + cdSize !== cdEnd) throw damaged();
  if (cdSize > MAX_DIRECTORY) throw new Error("This ZIP archive lists too many files");
  const cd = cdSize ? await from(cdOffset, cdSize) : Buffer.alloc(0);
  return { entries: parseCentral(cd, count, cdOffset), cdOffset, cdSize };
}

async function fetchRange(st, start, len, signal) {
  const headers = { ...st.headers, Range: `bytes=${start}-${start + len - 1}` };
  delete headers["Accept-Encoding"];
  const res = await fetch(st.url, { headers, signal });
  if (res.status !== 206 || Number(/bytes (\d+)-/.exec(res.headers.get("content-range") || "")?.[1]) !== start) {
    res.body?.cancel().catch(() => {});
    throw new Error(`The server answered ${res.status} to a range request`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length !== len) throw new Error("The server sent the wrong part of the archive");
  return buf;
}

// Reads the directory of the remote archive a stream points at. The stream must have its size.
function readDirectory(st, signal) {
  return directoryOf((start, len) => fetchRange(st, start, len, signal), st.size);
}

// --------------------------------------------------------------- choosing

// Runs of the archive to download: { offset, size }. Each entry's span runs from its local
// header to the next entry, so it holds the data and any data descriptor after it.
function planRuns(directory, chosen) {
  const starts = [...new Set(directory.entries.map((e) => e.offset)), directory.cdOffset].sort((a, b) => a - b);
  const endOf = new Map(starts.slice(0, -1).map((s, k) => [s, starts[k + 1]]));
  const spans = [...new Set(chosen.map((e) => e.offset))].sort((a, b) => a - b).map((s) => ({ start: s, end: endOf.get(s) }));
  const runs = [];
  for (const s of spans) {
    const last = runs[runs.length - 1];
    if (last && s.start - last.end < MERGE_GAP) last.end = Math.max(last.end, s.end);
    else runs.push({ ...s });
  }
  return runs.map((r) => ({ offset: r.start, size: r.end - r.start }));
}

const isZipDraft = (draft, mime) =>
  draft.ext === "zip" || /^application\/(x-)?zip(-compressed)?$/i.test(mime || draft.mime || "");

// The directory of a file draft that is a ZIP archive on a server that answers Range
// requests, or null. Any failure leaves the download as a plain whole file.
async function readZip(draft, mime) {
  const st = draft.streams[0];
  if (!isZipDraft(draft, mime) || !st.ranges || !st.size) return null;
  try {
    const stream = draft.cookies ? { ...st, headers: { ...st.headers, Cookie: draft.cookies } } : st;
    const directory = await readDirectory(stream, AbortSignal.timeout(READ_TIMEOUT));
    return directory.entries.filter((e) => !e.dir).length > 1 ? directory : null;
  } catch {
    return null;
  }
}

function whyNot(e) {
  if (e.flags & FLAG_ENCRYPTED) return "Encrypted";
  if (!e.supported) return "Packed in a way Downy can't open";
  return "";
}

// What a window shows of a directory: the files, by their index in the directory.
function zipView(directory) {
  return directory.entries.filter((e) => !e.dir).map((e) => ({ i: e.index, name: e.name, size: e.size, why: whyNot(e) }));
}

// A download of only the chosen files, made from a file draft without changing it. files lists
// entry indices from a window; null, or every file in the archive, returns the draft itself.
function chooseEntries(draft, directory, files) {
  if (files == null) return draft;
  if (!Array.isArray(files)) throw new Error("Pick the files to download");
  const picked = [...new Set(files)].map((i) => {
    const e = Number.isInteger(i) ? directory.entries[i] : null;
    if (!e || e.dir) throw new Error("That file is not in the archive");
    if (!e.supported) throw new Error(`Downy can't unpack ${e.name}: ${whyNot(e).toLowerCase()}`);
    return e;
  });
  if (!picked.length) throw new Error("Pick at least one file");
  if (picked.length === directory.entries.filter((e) => !e.dir).length) return draft;

  const base = draft.streams[0];
  const streams = planRuns(directory, picked).map((r, k) => ({
    ...base, role: `zip${k + 1}`, ext: "bin", offset: r.offset, size: r.size, ranges: true, path: "", segments: null, index: k,
  }));
  const one = picked.length === 1 ? entryParts(picked[0].name).pop() : "";
  return {
    ...draft,
    title: one ? `${one} from ${draft.filename}` : `${picked.length} files from ${draft.filename}`,
    streams,
    expected: streams.reduce((n, s) => n + s.size, 0),
    zip: {
      archive: draft.filename,
      entries: picked.sort((a, b) => a.offset - b.offset).map(({ name, size, csize, offset, method, crc }) => ({ name, size, csize, offset, method, crc })),
    },
  };
}

// ------------------------------------------------------------ extracting

// Windows opens these devices for any file named after them, with or without an extension.
const DEVICE = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\..*)?$/i;

// The folders and file name an entry may use on disk. Names come from the archive, so
// "..", drive letters and device names never reach the file system. clean makes one
// part of a name safe, like safeFileName does for downloads.
function entryParts(name, clean = (s) => s) {
  return String(name)
    .split(/[/\\]+/)
    .filter((p) => p && p !== "." && p !== "..")
    .map((p) => {
      const c = clean(p) || "_";
      return DEVICE.test(c) ? `_${c}` : c;
    });
}

// Checks the size and CRC32 of an entry while it streams to disk.
function checker(e) {
  let n = 0;
  let crc = 0;
  return new Transform({
    transform(chunk, _enc, done) {
      n += chunk.length;
      if (n > e.size) return done(new Error(`${e.name} is damaged in the archive: it is bigger than the archive says`));
      crc = zlib.crc32(chunk, crc);
      done(null, chunk);
    },
    flush(done) {
      if (n !== e.size) return done(new Error(`${e.name} is damaged in the archive: it is smaller than the archive says`));
      if (crc !== e.crc) return done(new Error(`${e.name} is damaged in the archive: its checksum does not match`));
      done();
    },
  });
}

async function unpack(e, run, file, signal) {
  const at = e.offset - run.offset;
  const head = Buffer.alloc(30);
  const fh = await fs.promises.open(run.path, "r");
  try {
    await fh.read(head, 0, 30, at);
  } finally {
    await fh.close();
  }
  if (head.readUInt32LE(0) !== SIG.local) throw new Error(`${e.name} is damaged in the archive`);
  // The local header's extra field can differ in length from the one in the directory.
  const start = at + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
  if (start + e.csize > run.size) throw new Error(`${e.name} is damaged in the archive`);
  const steps = e.csize
    ? [fs.createReadStream(run.path, { start, end: start + e.csize - 1 }), ...(e.method === DEFLATE ? [zlib.createInflateRaw()] : [])]
    : [Readable.from([])];
  await pipeline([...steps, checker(e), fs.createWriteStream(file, { flags: "wx" })], { signal });
}

// Unpacks a zip job's entries from its downloaded runs into dir and returns where they went:
// one file goes straight into dir, several into a folder named after the archive.
// place: { clean(part), unique(path), mark(file) } from the manager.
async function extract(j, { dir, signal, place }) {
  const { entries, archive } = j.zip;
  const runOf = (e) => j.streams.find((st) => e.offset >= st.offset && e.offset < st.offset + st.size);
  const single = entries.length === 1;
  let root = dir;
  if (!single) {
    const name = place.clean(archive.replace(/\.zip$/i, ""));
    root = path.join(dir, name);
    for (let k = 2; fs.existsSync(root); k++) root = path.join(dir, `${name} (${k})`);
    fs.mkdirSync(root);
  }
  let file = "";
  try {
    for (const e of entries) {
      const parts = entryParts(e.name, place.clean);
      file = place.unique(path.join(root, ...(single ? parts.slice(-1) : parts)));
      const rel = path.relative(root, file);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`${e.name} would land outside the folder`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await unpack(e, runOf(e), file, signal);
      place.mark(file);
    }
  } catch (err) {
    // The file or folder was new, so this removes nothing the user had.
    if (!single) fs.rmSync(root, { recursive: true, force: true });
    else if (file) fs.rmSync(file, { force: true });
    throw err;
  }
  return single ? file : root;
}

module.exports = { directoryOf, readDirectory, planRuns, readZip, zipView, chooseEntries, entryParts, extract, decodeName };
