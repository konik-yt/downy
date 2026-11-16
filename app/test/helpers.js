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

// Serves `files` ({ "/path": { body, type, name } }) on 127.0.0.1. With ranges off it
// ignores Range headers like many simple servers do. `deny` answers 403 to that many
// requests first, like an expired YouTube link. `log` collects every request.
async function fileServer(t, files, { ranges = true, deny = 0 } = {}) {
  const log = [];
  const server = http.createServer((req, res) => {
    log.push({ url: req.url, range: req.headers.range, headers: req.headers });
    const file = files[req.url.split("?")[0]];
    if (!file) {
      res.writeHead(404);
      return res.end();
    }
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
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return { base: `http://127.0.0.1:${server.address().port}`, log };
}

const randomBytes = (n) => crypto.randomBytes(n);

module.exports = { tempDir, fileServer, randomBytes };
