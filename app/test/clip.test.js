const test = require("node:test");
const assert = require("node:assert/strict");
const { parseClip, label, estimate, timecode, plan, split, planStream } = require("../src/main/clip");
const { AbortError } = require("../src/main/segmented");
const { fileServer } = require("./helpers");
const { box, fragmentedMp4 } = require("./mp4");

// Ten fragments of five seconds each, a little bigger every time.
const evenFrags = (n = 10, seconds = 5, timescale = 1000) => Array.from({ length: n }, (_, i) => ({ duration: seconds * timescale, size: 1000 + i }));

test("parseClip returns whole seconds, and null for the whole video or no range", () => {
  assert.equal(parseClip(undefined, 600), null);
  assert.equal(parseClip(null, 600), null);
  assert.deepEqual(parseClip({ start: 60, end: 150 }, 600), { start: 60, end: 150 });
  assert.deepEqual(parseClip({ start: 59.6, end: 150.4 }, 600), { start: 60, end: 150 });
  assert.deepEqual(parseClip({ start: 0, end: 300 }, 600), { start: 0, end: 300 });
  assert.deepEqual(parseClip({ start: 300, end: 600 }, 600), { start: 300, end: 600 });
  assert.equal(parseClip({ start: 0, end: 600 }, 600), null);
  // A length with a fraction: the last whole second is the end of the video, and one more is still allowed.
  assert.equal(parseClip({ start: 0, end: 599 }, 599.6), null);
  assert.deepEqual(parseClip({ start: 10, end: 600 }, 599.6), { start: 10, end: 600 });
  // Without a known length only the order of the two times can be checked.
  assert.deepEqual(parseClip({ start: 0, end: 5000 }, 0), { start: 0, end: 5000 });
});

test("parseClip explains a range that cannot be used", () => {
  assert.throws(() => parseClip({ start: -1, end: 30 }, 600), /start can't be before/);
  assert.throws(() => parseClip({ start: 30, end: 30 }, 600), /end must come after/);
  assert.throws(() => parseClip({ start: 90, end: 30 }, 600), /end must come after/);
  assert.throws(() => parseClip({ start: 30, end: 601 }, 600), /past the end of the video, 10:00/);
});

test("parseClip refuses anything that is not two numbers", () => {
  for (const raw of ["1:00", 60, [], {}, { start: "1", end: 30 }, { start: 0, end: NaN }, { start: 0, end: Infinity }, { start: null, end: 30 }, { end: 30 }]) {
    assert.throws(() => parseClip(raw, 600), /start and the end as times/, JSON.stringify(raw));
  }
  assert.throws(() => parseClip({ start: 0, end: 1e300 }, 0), /too long/);
});

test("label writes the range with no colons, and hours once past an hour", () => {
  assert.equal(label({ start: 60, end: 150 }), "1m00s-2m30s");
  assert.equal(label({ start: 0, end: 9 }), "0m00s-0m09s");
  assert.equal(label({ start: 3599, end: 3600 }), "59m59s-1h00m00s");
  assert.equal(label({ start: 3725, end: 4200 }), "1h02m05s-1h10m00s");
  assert.equal(label({ start: 5, end: 36000 }), "0m05s-10h00m00s");
});

test("timecode and estimate", () => {
  assert.deepEqual([0, 75, 3599, 3725, 36000].map(timecode), ["0:00", "1:15", "59:59", "1:02:05", "10:00:00"]);
  assert.equal(estimate(1000, { start: 0, end: 30 }, 120), 250);
  assert.equal(estimate(1000, null, 120), 1000);
  assert.equal(estimate(1000, { start: 0, end: 30 }, 0), 0);
  assert.equal(estimate(0, { start: 0, end: 30 }, 120), 0);
});

test("plan takes the fragments that overlap the clip, and t0 is where the first one starts", () => {
  const { file, initEnd, frags } = fragmentedMp4({ frags: evenFrags() });
  const p = plan(file, { start: 12, end: 23 });
  // 12 s falls in the third fragment (10 to 15 s). 23 s falls in the fifth (20 to 25 s).
  assert.deepEqual(p.init, { offset: 0, size: initEnd });
  assert.equal(p.t0, 10);
  assert.equal(p.data.offset, frags[2].offset);
  assert.equal(p.data.size, frags[2].size + frags[3].size + frags[4].size);
});

test("plan at fragment edges: a clip starting where a fragment starts skips the one before it", () => {
  const { file, frags } = fragmentedMp4({ frags: evenFrags() });
  // Starts at 10 s, where the third fragment begins. Ends at 20 s, where the fifth would begin.
  let p = plan(file, { start: 10, end: 20 });
  assert.equal(p.t0, 10);
  assert.equal(p.data.offset, frags[2].offset);
  assert.equal(p.data.size, frags[2].size + frags[3].size);
  // One second less than the edge pulls in the fragment before.
  p = plan(file, { start: 9, end: 21 });
  assert.equal(p.t0, 5);
  assert.equal(p.data.offset, frags[1].offset);
  assert.equal(p.data.size, frags[1].size + frags[2].size + frags[3].size + frags[4].size);
  // The first fragment, and a clip that ends inside it.
  p = plan(file, { start: 0, end: 1 });
  assert.equal(p.t0, 0);
  assert.deepEqual([p.data.offset, p.data.size], [frags[0].offset, frags[0].size]);
  // A clip that runs past the end of the stream takes the last fragment and stops.
  p = plan(file, { start: 47, end: 600 });
  assert.equal(p.t0, 45);
  assert.deepEqual([p.data.offset, p.data.size], [frags[9].offset, frags[9].size]);
});

test("plan finds nothing to fetch when the clip starts after the stream ends", () => {
  const { file } = fragmentedMp4({ frags: evenFrags() });
  assert.equal(plan(file, { start: 50, end: 60 }), null);
});

test("plan reads version 1, 64 bit box sizes, a start time, and a gap before the first fragment", () => {
  // Fragments start at 59.1 s, like YouTube's, in a timescale of 90000.
  for (const opts of [{ version: 1 }, { big: true }, { version: 1, big: true, first: 120 }, { first: 7 }]) {
    const { file, initEnd, frags } = fragmentedMp4({ frags: evenFrags(6, 5, 90000), timescale: 90000, ept: 59.1 * 90000, ...opts });
    const p = plan(file, { start: 60, end: 70 });
    assert.equal(p.init.size, initEnd, JSON.stringify(opts));
    assert.ok(Math.abs(p.t0 - 59.1) < 1e-9, `t0 ${p.t0}`);
    assert.equal(p.data.offset, frags[0].offset, JSON.stringify(opts));
    assert.equal(p.data.size, frags[0].size + frags[1].size + frags[2].size, JSON.stringify(opts));
  }
});

test("plan asks for more bytes when the index runs past the buffer", () => {
  const { file, initEnd } = fragmentedMp4({ frags: evenFrags(), moov: 300 });
  const cut = plan(file.subarray(0, initEnd - 10), { start: 0, end: 5 });
  assert.equal(cut.need, initEnd + 16, "a moov that is cut off");
  const noSidx = plan(file.subarray(0, initEnd + 5), { start: 0, end: 5 });
  assert.ok(noSidx.need > initEnd + 5, "a sidx that has not started");
  const half = plan(file.subarray(0, file.indexOf("sidx") + 20), { start: 0, end: 5 });
  assert.ok(half.need > file.indexOf("sidx") + 20, "a sidx that is cut off");
  assert.ok(plan(file, { start: 0, end: 5 }).data.size > 0);
});

test("plan leaves a stream whole when it has no usable index", () => {
  const clip = { start: 0, end: 5 };
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01]), Buffer.alloc(200)]);
  assert.equal(plan(webm, clip), null);
  assert.equal(plan(Buffer.alloc(0), clip), null);
  assert.equal(plan(Buffer.from("not a video at all, just some text"), clip), null);
  // A progressive mp4: the media data comes before any index.
  const progressive = Buffer.concat([box("ftyp", Buffer.alloc(12)), box("mdat", Buffer.alloc(100)), box("moov", Buffer.alloc(40))]);
  assert.equal(plan(progressive, clip), null);
  // moov after the sidx is not a layout Downy cuts.
  const odd = fragmentedMp4({ frags: evenFrags() }).file;
  const moovAt = odd.indexOf("moov") - 4;
  const sidxAt = odd.indexOf("sidx") - 4;
  const sidxEnd = sidxAt + odd.readUInt32BE(sidxAt);
  const swapped = Buffer.concat([odd.subarray(0, moovAt), odd.subarray(sidxAt, sidxEnd), odd.subarray(moovAt, sidxAt), odd.subarray(sidxEnd)]);
  assert.equal(plan(swapped, clip), null);
});

test("plan leaves a stream whole when its index points at another index", () => {
  const { file } = fragmentedMp4({ frags: evenFrags() });
  const hier = Buffer.from(file);
  const at = hier.indexOf("sidx") - 4 + 8 + 4 + 4 + 4 + 8 + 4; // the first reference
  hier.writeUInt32BE((hier.readUInt32BE(at) | 0x80000000) >>> 0, at);
  assert.equal(plan(hier, { start: 0, end: 5 }), null);
});

test("split makes an init stream and a clip stream that keep the format id", () => {
  const st = { role: "video", formatId: "399", ext: "mp4", url: "https://x/v", headers: { A: "b" }, size: 123456, path: "/old/path", segments: [{ start: 0, end: 1, pos: 1 }], partial: true, index: 0 };
  const p = { init: { offset: 0, size: 700 }, data: { offset: 5000, size: 9000 }, t0: 59.1 };
  const [init, data] = split(st, p);
  assert.deepEqual([init.part, init.offset, init.size, init.ranges, init.path, init.segments], ["init", 0, 700, true, "", null]);
  assert.deepEqual([data.part, data.offset, data.size, data.t0, data.ranges], ["data", 5000, 9000, 59.1, true]);
  for (const s of [init, data]) assert.deepEqual([s.role, s.formatId, s.ext, s.url, s.headers, s.partial], ["video", "399", "mp4", "https://x/v", { A: "b" }, undefined]);
  assert.equal(st.path, "/old/path", "the original is left alone");
});

test("planStream reads one small piece of the stream and plans the clip", async (t) => {
  const { file, initEnd, frags } = fragmentedMp4({ frags: evenFrags() });
  const { base, log } = await fileServer(t, { "/v.mp4": { body: file } });
  const p = await planStream({ url: `${base}/v.mp4`, headers: { "Accept-Encoding": "gzip", "User-Agent": "t" } }, { start: 12, end: 23 }, {});
  assert.equal(p.init.size, initEnd);
  assert.equal(p.data.offset, frags[2].offset);
  assert.equal(log.length, 1);
  assert.match(log[0].range, /^bytes=0-65535$/);
  assert.notEqual(log[0].headers["accept-encoding"], "gzip");
});

test("planStream reads more when the index is past the first read", async (t) => {
  const { file, frags } = fragmentedMp4({ frags: evenFrags(), moov: 100 * 1024 });
  const { base, log } = await fileServer(t, { "/v.mp4": { body: file } });
  const p = await planStream({ url: `${base}/v.mp4`, headers: {} }, { start: 0, end: 5 }, {});
  assert.equal(p.data.offset, frags[0].offset);
  assert.equal(log[0].range, "bytes=0-65535");
  assert.ok(log.length >= 2 && log.length <= 3, `${log.length} reads`);
  const last = Number(/-(\d+)$/.exec(log[log.length - 1].range)[1]) + 1;
  assert.ok(last >= file.indexOf("sidx") + 4, log[log.length - 1].range);
});

test("planStream gives up on a stream without an index, without Range support, or with a huge moov", async (t) => {
  const webm = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(5000)]);
  const big = fragmentedMp4({ frags: evenFrags(), moov: 5 * 1024 * 1024 }).file;
  const { base } = await fileServer(t, { "/a.webm": { body: webm }, "/big.mp4": { body: big } });
  const clip = { start: 0, end: 5 };
  assert.equal(await planStream({ url: `${base}/a.webm`, headers: {} }, clip, {}), null);
  assert.equal(await planStream({ url: `${base}/big.mp4`, headers: {} }, clip, {}), null);
  const plain = await fileServer(t, { "/v.mp4": { body: fragmentedMp4({ frags: evenFrags() }).file } }, { ranges: false });
  assert.equal(await planStream({ url: `${plain.base}/v.mp4`, headers: {} }, clip, {}), null);
});

test("planStream gets a fresh link once when the first one is refused, then fails on a second refusal", async (t) => {
  const { file } = fragmentedMp4({ frags: evenFrags() });
  const { base } = await fileServer(t, { "/v.mp4": { body: file } }, { deny: 1 });
  let refreshed = 0;
  const p = await planStream({ url: `${base}/v.mp4`, headers: {} }, { start: 0, end: 5 }, { refresh: async () => refreshed++ });
  assert.ok(p.data.size > 0);
  assert.equal(refreshed, 1);
  const again = await fileServer(t, { "/v.mp4": { body: file } }, { deny: 5 });
  await assert.rejects(planStream({ url: `${again.base}/v.mp4`, headers: {} }, { start: 0, end: 5 }, { refresh: async () => {} }), /403/);
});

test("planStream stops with an AbortError when the download is paused", async (t) => {
  const { file } = fragmentedMp4({ frags: evenFrags() });
  const server = await fileServer(t, { "/v.mp4": { body: file, hold: true } });
  const ctrl = new AbortController();
  const planning = planStream({ url: `${server.base}/v.mp4`, headers: {} }, { start: 0, end: 5 }, { signal: ctrl.signal });
  await server.asked("/v.mp4");
  ctrl.abort();
  await assert.rejects(planning, AbortError);
});
