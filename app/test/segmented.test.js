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
  assert.equal(st.partial, undefined);
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

test("streamDone is false for an unfinished single-connection download", () => {
  assert.equal(streamDone({ partial: true, segments: [{ start: 0, end: 9, pos: 10 }] }), false);
  assert.equal(streamDone({ segments: [] }), false);
  assert.equal(streamDone({}), false);
  assert.equal(streamBytes({}), 0);
});
