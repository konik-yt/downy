const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { downloadStream, streamDone, streamBytes, probe, AbortError } = require("../src/main/segmented");
const { tempDir, fileServer, randomBytes } = require("./helpers");

const MB = 1024 * 1024;

function stream(dir, url) {
  return { url, headers: { "User-Agent": "test" }, path: path.join(dir, "out.bin"), size: 0, segments: null };
}

function opts(extra = {}) {
  let bytes = 0;
  return {
    connections: 4,
    signal: new AbortController().signal,
    onBytes: (n) => (bytes += n),
    refresh: async () => {
      throw new Error("refresh was not expected");
    },
    bytes: () => bytes,
    ...extra,
  };
}

test("probe reads size, range support and the file name", async (t) => {
  const body = randomBytes(1000);
  const { base, log } = await fileServer(t, {
    "/star": { body, type: "application/zip; charset=binary", name: "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.zip" },
    "/plain": { body, name: 'attachment; filename="report 1.pdf"' },
  });
  const info = await probe({ url: `${base}/star`, headers: {} });
  assert.equal(info.size, 1000);
  assert.equal(info.ranges, true);
  assert.equal(info.filename, "résumé.zip");
  assert.equal(info.type, "application/zip");
  assert.equal(log[0].range, "bytes=0-0");
  assert.equal((await probe({ url: `${base}/plain`, headers: {} })).filename, "report 1.pdf");
});

test("probe reports a server without Range support and fails on errors", async (t) => {
  const { base } = await fileServer(t, { "/f": { body: randomBytes(10) } }, { ranges: false });
  const info = await probe({ url: `${base}/f`, headers: {} });
  assert.deepEqual([info.size, info.ranges], [10, false]);
  await assert.rejects(probe({ url: `${base}/missing`, headers: {} }), (e) => e.status === 404);
});

test("downloadStream fetches a file over several connections", async (t) => {
  const body = randomBytes(5 * MB + 123);
  const { base, log } = await fileServer(t, { "/v": { body } });
  const dir = tempDir(t);
  const st = stream(dir, `${base}/v`);
  const o = opts();
  await downloadStream(st, o);
  assert.ok(fs.readFileSync(st.path).equals(body));
  assert.equal(st.size, body.length);
  assert.equal(st.ranges, true);
  assert.equal(streamDone(st), true);
  assert.equal(streamBytes(st), body.length);
  assert.equal(o.bytes(), body.length);
  const ranged = log.filter((r) => r.range && r.range !== "bytes=0-0");
  assert.ok(ranged.length >= 4, `expected at least 4 range requests, saw ${ranged.length}`);
});

test("downloadStream resumes from saved segment offsets", async (t) => {
  const body = randomBytes(4 * MB);
  const { base, log } = await fileServer(t, { "/v": { body } });
  const dir = tempDir(t);
  const st = stream(dir, `${base}/v`);
  st.size = body.length;
  st.ranges = true;
  // The first half is already on disk; the second half is still empty.
  const half = 2 * MB;
  const partial = Buffer.alloc(body.length);
  body.copy(partial, 0, 0, half);
  fs.writeFileSync(st.path, partial);
  st.segments = [{ start: 0, end: half - 1, pos: half }, { start: half, end: body.length - 1, pos: half }];
  assert.equal(streamDone(st), false);
  assert.equal(streamBytes(st), half);

  await downloadStream(st, opts());
  assert.ok(fs.readFileSync(st.path).equals(body));
  // Nothing before the saved offset was asked for again.
  for (const r of log) assert.ok(Number(/bytes=(\d+)/.exec(r.range)[1]) >= half, r.range);
});

test("downloadStream uses one plain request when the server has no Range support", async (t) => {
  const body = randomBytes(3 * MB);
  const { base, log } = await fileServer(t, { "/v": { body } }, { ranges: false });
  const dir = tempDir(t);
  const st = stream(dir, `${base}/v`);
  await downloadStream(st, opts());
  assert.ok(fs.readFileSync(st.path).equals(body));
  assert.equal(st.ranges, false);
  assert.equal(streamDone(st), true);
  // Asking for identity keeps fetch from unpacking a gzip answer into a different file.
  assert.equal(log.at(-1).headers["accept-encoding"], "identity");
});

test("downloadStream gets a fresh link after a 403 and goes on", async (t) => {
  const body = randomBytes(2 * MB);
  const { base } = await fileServer(t, { "/old": { body: Buffer.alloc(0) }, "/new": { body } }, { deny: 1 });
  const dir = tempDir(t);
  const st = stream(dir, `${base}/old`);
  let refreshed = 0;
  await downloadStream(st, opts({
    refresh: async () => {
      refreshed++;
      st.url = `${base}/new`;
    },
  }));
  assert.equal(refreshed, 1);
  assert.ok(fs.readFileSync(st.path).equals(body));
});

test("downloadStream stops with AbortError when paused", async (t) => {
  const body = randomBytes(2 * MB);
  const { base } = await fileServer(t, { "/v": { body } });
  const dir = tempDir(t);
  const st = stream(dir, `${base}/v`);
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(downloadStream(st, opts({ signal: ctrl.signal })), AbortError);
});

// A server for one file whose answers the test writes itself.
async function rawServer(t, onRequest) {
  const http = require("http");
  const log = [];
  const server = http.createServer((req, res) => {
    log.push(req.headers.range || "");
    onRequest(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  return { url: `http://127.0.0.1:${server.address().port}/v`, log };
}

test("a server that answers ranges with no bytes gets waits between tries, not a flood", async (t) => {
  const size = 4 * MB;
  const { url, log } = await rawServer(t, (req, res) => {
    const m = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || "");
    if (m && m[1] === "0" && m[2] === "0") {
      res.writeHead(206, { "Content-Range": `bytes 0-0/${size}`, "Content-Length": 1 });
      return res.end(Buffer.alloc(1));
    }
    res.writeHead(206, { "Content-Range": `bytes ${m[1]}-${m[2]}/${size}`, "Content-Length": 0 });
    res.end();
  });
  const ctrl = new AbortController();
  const run = downloadStream(stream(tempDir(t), url), opts({ connections: 1, signal: ctrl.signal }));
  await new Promise((r) => setTimeout(r, 1500));
  ctrl.abort();
  await assert.rejects(run, AbortError);
  const tries = log.length - 1;
  assert.ok(tries >= 1 && tries <= 3, `asked for the same range ${tries} times in 1.5 s`);
});

test("a cut off download from a server without Range support or a size is not done, and starts over", async (t) => {
  const body = randomBytes(256 * 1024);
  let cut = true;
  const { url } = await rawServer(t, (req, res) => {
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    if (!cut) return res.end(body);
    res.write(body.subarray(0, 64 * 1024));
  });
  const dir = tempDir(t);
  const st = stream(dir, url);
  const ctrl = new AbortController();
  const run = downloadStream(st, opts({ signal: ctrl.signal }));
  const wrote = () => fs.existsSync(st.path) && fs.statSync(st.path).size > 0;
  while (!wrote()) await new Promise((r) => setTimeout(r, 10));
  ctrl.abort();
  await assert.rejects(run, AbortError);
  assert.equal(streamDone(JSON.parse(JSON.stringify(st))), false, "a paused download must not count as finished");

  cut = false;
  await downloadStream(st, opts());
  assert.equal(streamDone(st), true);
  assert.ok(fs.readFileSync(st.path).equals(body));
});

test("streamDone and streamBytes treat a stream with no segments as not started", () => {
  assert.equal(streamDone({ segments: [] }), false);
  assert.equal(streamDone({}), false);
  assert.equal(streamBytes({}), 0);
});

test("downloadStream with an offset fetches only that part of the file", async (t) => {
  const body = randomBytes(6 * MB);
  const { base, log } = await fileServer(t, { "/z": { body } });
  const dir = tempDir(t);
  const from = 2 * MB + 17;
  const size = 3 * MB + 5;
  const st = { ...stream(dir, `${base}/z`), offset: from, size, ranges: true };
  await downloadStream(st, opts());
  assert.ok(fs.readFileSync(st.path).equals(body.subarray(from, from + size)));
  assert.equal(streamDone(st), true);
  for (const r of log) {
    const [a, b] = /^bytes=(\d+)-(\d+)$/.exec(r.range).slice(1).map(Number);
    assert.ok(a >= from && b < from + size, `${r.range} stays inside the part`);
  }
});

test("downloadStream splits segments across multiple live routes", async (t) => {
  const body = randomBytes(6 * MB + 17);
  const { base, log } = await fileServer(t, { "/v": { body } });
  const dir = tempDir(t);
  const st = stream(dir, `${base}/v`);
  const routes = [
    { name: "Primary", address: "127.0.0.1", primary: true },
    { name: "Secondary", address: "127.0.0.2", primary: false },
  ];
  await downloadStream(st, opts({ connections: 2, routes }));
  assert.ok(fs.readFileSync(st.path).equals(body));
  assert.equal(streamDone(st), true);
  const ranged = log.filter((r) => r.range && r.range !== "bytes=0-0");
  const remotes = new Set(ranged.map((r) => r.remoteAddress));
  assert.ok(remotes.has("127.0.0.1"), `expected requests from 127.0.0.1, got ${[...remotes]}`);
  assert.ok(remotes.has("127.0.0.2"), `expected requests from 127.0.0.2, got ${[...remotes]}`);
});

test("downloadStream drops a dead non-primary route and finishes on the live route", async (t) => {
  const body = randomBytes(4 * MB + 5);
  const { base } = await fileServer(t, { "/v": { body } });
  const dir = tempDir(t);
  const st = stream(dir, `${base}/v`);
  const routes = [
    { name: "Primary", address: "127.0.0.1", primary: true },
    { name: "Dead", address: "192.0.2.1", primary: false },
  ];
  await downloadStream(st, opts({ connections: 2, routes }));
  assert.ok(fs.readFileSync(st.path).equals(body));
  assert.equal(streamDone(st), true);
});

test("downloadStream drops a non-primary route on 403 without calling refresh", async (t) => {
  const body = randomBytes(4 * MB + 9);
  const { base, log } = await fileServer(t, { "/v": { body } }, { deny: (req) => req.socket.remoteAddress === "127.0.0.2" });
  const dir = tempDir(t);
  const st = stream(dir, `${base}/v`);
  const routes = [
    { name: "Primary", address: "127.0.0.1", primary: true },
    { name: "Secondary", address: "127.0.0.2", primary: false },
  ];
  let refreshed = 0;
  await downloadStream(st, opts({
    connections: 2,
    routes,
    refresh: async () => { refreshed++; },
  }));
  assert.equal(refreshed, 0);
  assert.ok(fs.readFileSync(st.path).equals(body));
  assert.equal(streamDone(st), true);
  assert.ok(log.some((r) => r.remoteAddress === "127.0.0.2"));
});

test("downloadStream refreshes a non-primary route once via refreshRoute and uses its link", async (t) => {
  const body = randomBytes(4 * MB + 11);
  const { base, log } = await fileServer(
    t,
    { "/primary": { body }, "/secondary": { body } },
    { deny: (req) => req.url === "/primary" && req.socket.remoteAddress === "127.0.0.2" },
  );
  const dir = tempDir(t);
  const st = stream(dir, `${base}/primary`);
  const routes = [
    { name: "Primary", address: "127.0.0.1", primary: true },
    { name: "Secondary", address: "127.0.0.2", primary: false },
  ];
  const routeRefreshes = [];
  await downloadStream(st, opts({
    connections: 2,
    routes,
    refreshRoute: async (route) => {
      routeRefreshes.push(route.address);
      st.links = { ...st.links, [route.address]: { url: `${base}/secondary`, headers: {} } };
    },
  }));
  assert.deepEqual(routeRefreshes, ["127.0.0.2"]);
  assert.ok(fs.readFileSync(st.path).equals(body));
  assert.ok(log.some((r) => r.url === "/secondary" && r.remoteAddress === "127.0.0.2"));
});
