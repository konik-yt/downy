// Shared pieces for the tests: temp folders and a local file server with Range support.
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");

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
    if (deny > 0) {
      deny--;
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
    log.push({ url: req.url, path: p, range: req.headers.range, headers: req.headers });
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

module.exports = { tempDir, fileServer, randomBytes };
