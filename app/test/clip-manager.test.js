const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { once } = require("events");
const { Manager } = require("../src/main/manager");
const tools = require("../src/main/tools");
const { fileServer } = require("./helpers");
const { fragmentedMp4 } = require("./mp4");

// A clip job with a video stream (fragments of 5 s) and an audio stream (fragments of 10 s that
// start half a second in), served from a local server. The whole video is 50 s.
function stream(frags, extra) {
  return fragmentedMp4({ frags, ...extra });
}
const video = stream(Array.from({ length: 10 }, () => ({ duration: 5000, size: 100000 })));
const audio = stream(Array.from({ length: 5 }, () => ({ duration: 480000, size: 20000 })), { timescale: 48000, ept: 24000 });

function info(base, duration = 50) {
  return {
    id: "vid", title: 'Big: Buck?', duration, thumbnail: "",
    formats: [
      { format_id: "v1", ext: "mp4", protocol: "https", url: `${base}/v.mp4`, vcodec: "avc1.64001f", acodec: "none", height: 720, fps: 30, filesize: video.file.length, http_headers: {} },
      { format_id: "a1", ext: "m4a", protocol: "https", url: `${base}/a.m4a`, vcodec: "none", acodec: "mp4a.40.2", abr: 128, filesize: audio.file.length, http_headers: {} },
    ],
  };
}

const movies = () => ({ "/v.mp4": { body: video.file }, "/a.m4a": { body: audio.file } });

function setup(t, base) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "downy-clip-"));
  const values = { downloadDir: path.join(root, "Downy"), connections: 4, maxActive: 3, organize: true };
  const cache = { get: async () => ({ info: info(base), file: "" }) };
  const m = new Manager({ dataDir: path.join(root, "data"), cache, settings: { get: () => values } });
  // ffmpeg is replaced by a stand-in that notes what it was asked to do and writes the output file.
  const calls = [];
  m.ffmpeg = async (args) => {
    calls.push(args);
    fs.writeFileSync(args[args.length - 1], "clip");
  };
  t.mock.method(tools, "find", () => "ffmpeg");
  t.after(async () => {
    await m.shutdown();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { m, values, calls, dataDir: path.join(root, "data") };
}

const rangeOf = (r) => /^bytes=(\d+)-(\d+)$/.exec(r.range).slice(1).map(Number);
// The part of a request log that is not the 64 KB read that plans the clip.
const fetched = (log, p) => log.filter((r) => r.path === p && r.range !== "bytes=0-65535" && r.range !== "bytes=0-0").map(rangeOf);
const total = video.file.length + audio.file.length;
const until = async (check) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(check(), "the job did not get there");
};
const covered = (ranges) => ranges.reduce((n, [a, b]) => n + b - a + 1, 0);

test("a clip downloads only the init bytes and the fragments that hold it, and trims with ffmpeg", async (t) => {
  const srv = await fileServer(t, movies());
  const { m, values, calls } = setup(t, srv.base);
  const finished = once(m, "finished");
  const d = await m.add("http://video.test/watch", "v720", {}, { start: 12, end: 23 });
  assert.deepEqual(d.clip, { start: 12, end: 23 });
  // The estimate before planning is the share of the whole video: 11 of 50 seconds.
  assert.equal(d.expected, Math.round(total * 11 / 50));
  const [done] = await finished;
  assert.equal(done.status, "done");
  assert.equal(path.basename(done.filepath), "Big Buck (720p, 0m12s-0m23s).mp4");
  assert.equal(path.dirname(done.filepath), path.join(values.downloadDir, "Videos", "720p"));

  // Video: fragments 3 to 5 (10 to 25 s) and the init bytes. Audio: fragments 2 and 3 (10.5 to 30.5 s).
  const v = fetched(srv.log, "/v.mp4").sort((a, b) => a[0] - b[0]);
  assert.deepEqual(v, [[0, video.initEnd - 1], [video.frags[2].offset, video.frags[4].offset + video.frags[4].size - 1]]);
  const a = fetched(srv.log, "/a.m4a").sort((x, y) => x[0] - y[0]);
  assert.deepEqual(a, [[0, audio.initEnd - 1], [audio.frags[1].offset, audio.frags[2].offset + audio.frags[2].size - 1]]);
  assert.ok(covered(v) + covered(a) < total / 3, "far less than the whole files");
  assert.equal(done.expected, covered(v) + covered(a));

  // ffmpeg reads each role as its init file joined to its clip file, and seeks to the clip start inside it.
  assert.equal(calls.length, 1);
  const args = calls[0];
  const inputs = args.filter((x) => String(x).startsWith("concat:"));
  assert.deepEqual([args.slice(0, 2), args.slice(4, 6)], [["-ss", "2"], ["-ss", "1.5"]]);
  assert.deepEqual(args.slice(args.indexOf("-t"), args.indexOf("-t") + 2), ["-t", "11"]);
  assert.ok(args.indexOf("-t") < args.indexOf("-movflags"), "the length stays before the part the MKV fallback cuts off");
  assert.match(inputs[0], /^concat:.*\.video\.init\.mp4\|.*\.video\.data\.mp4$/);
  assert.match(inputs[1], /^concat:.*\.audio\.init\.m4a\|.*\.audio\.data\.m4a$/);
  assert.deepEqual(fs.readdirSync(m.partsDir()), [], "part files are removed when the job ends");
});

test("a clip joins the init and clip files into what ffmpeg reads", async (t) => {
  const srv = await fileServer(t, movies());
  const { m } = setup(t, srv.base);
  let seen = null;
  m.ffmpeg = async (args) => {
    const joined = args.filter((x) => String(x).startsWith("concat:")).map((x) => Buffer.concat(x.slice(7).split("|").map((f) => fs.readFileSync(f))));
    seen = joined;
    fs.writeFileSync(args[args.length - 1], "clip");
  };
  const finished = once(m, "finished");
  await m.add("http://video.test/watch", "v720", {}, { start: 12, end: 23 });
  await finished;
  const want = (movie, first, last) => Buffer.concat([movie.file.subarray(0, movie.initEnd), movie.file.subarray(movie.frags[first].offset, movie.frags[last].offset + movie.frags[last].size)]);
  assert.ok(seen[0].equals(want(video, 2, 4)));
  assert.ok(seen[1].equals(want(audio, 1, 2)));
});

test("a clip of audio is trimmed in the same way, for m4a and for mp3", async (t) => {
  const srv = await fileServer(t, movies());
  const { m, calls } = setup(t, srv.base);
  for (const [option, name] of [["m4a", "Big Buck (0m12s-0m23s).m4a"], ["mp3", "Big Buck (0m12s-0m23s).mp3"]]) {
    const finished = once(m, "finished");
    await m.add("http://video.test/watch", option, {}, { start: 12, end: 23 });
    const [done] = await finished;
    assert.equal(path.basename(done.filepath), name);
  }
  assert.deepEqual(calls[0].slice(0, 2), ["-ss", "1.5"]);
  assert.ok(calls[0].includes("copy") && calls[1].includes("libmp3lame"));
  for (const args of calls) assert.deepEqual(args.slice(args.indexOf("-t"), args.indexOf("-t") + 2), ["-t", "11"]);
});

test("a stream without an index is downloaded whole and trimmed from the clip start", async (t) => {
  const plain = Buffer.alloc(300000, 7);
  const srv = await fileServer(t, { "/v.mp4": { body: plain }, "/a.m4a": { body: audio.file } });
  const { m, calls } = setup(t, srv.base);
  const finished = once(m, "finished");
  await m.add("http://video.test/watch", "v720", {}, { start: 12, end: 23 });
  const [done] = await finished;
  assert.equal(done.status, "done");
  assert.equal(covered(fetched(srv.log, "/v.mp4")), plain.length);
  assert.deepEqual(calls[0].slice(0, 3), ["-ss", "12", "-i"]);
  assert.doesNotMatch(calls[0][3], /concat/);
  assert.match(calls[0][7], /concat:/, "the audio, which has an index, is still cut");
});

test("a paused clip keeps its plan and its progress, and a resume downloads the rest", async (t) => {
  const srv = await fileServer(t, movies());
  const { m, dataDir, calls } = setup(t, srv.base);
  const finished = once(m, "finished");
  const d = await m.add("http://video.test/watch", "v720", {}, { start: 12, end: 23 });
  // The video is finished once its clip request is in. The audio waits.
  await srv.asked("/v.mp4", 3);
  srv.hold("/a.m4a");
  await srv.asked("/a.m4a", 2);
  m.pause(d.id);
  const job = m.get(d.id);
  await until(() => job.status === "paused");
  assert.equal(job.clipPlanned, true);
  assert.deepEqual(job.streams.map((s) => [s.role, s.part]), [["video", "init"], ["video", "data"], ["audio", "init"], ["audio", "data"]]);
  assert.equal(m.public(job).stream.count, 2, "the init streams are not counted");
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "downloads.json"), "utf8")).find((r) => r.id === d.id);
  assert.equal(saved.clipPlanned, true);

  srv.release("/a.m4a");
  m.resume(d.id);
  const [done] = await finished;
  assert.equal(done.status, "done");
  assert.equal(srv.log.filter((r) => r.range === "bytes=0-65535").length, 2, "each stream is read for its index once");
  assert.equal(srv.log.filter((r) => r.path === "/v.mp4").length, 3, "the finished video is not fetched again");
  assert.equal(calls.length, 1);
});

test("a clip gets a name of its own, and a typed name is used as it is", (t) => {
  const { m } = setup(t, "http://127.0.0.1:9");
  const clip = { start: 60, end: 150 };
  assert.equal(m.targetName({ kind: "video", title: "Big Buck Bunny", height: 720, clip }), "Big Buck Bunny (720p, 1m00s-2m30s).mp4");
  assert.equal(m.targetName({ kind: "video", title: "Big Buck Bunny", height: 720 }), "Big Buck Bunny (720p).mp4");
  assert.equal(m.targetName({ kind: "mp3", title: "Song", clip }), "Song (1m00s-2m30s).mp3");
  assert.equal(m.targetName({ kind: "audio", title: "Song", clip: { start: 3725, end: 4200 } }), "Song (1h02m05s-1h10m00s).m4a");
  assert.equal(m.targetName({ kind: "video", title: "x", height: 720, clip, customName: "Intro" }), "Intro.mp4");
  // yt-dlp names its temp files after this, so a clip and the whole video never share them.
  assert.notEqual(m.ytdlpBase({ kind: "video", title: "x", height: 720, clip }), m.ytdlpBase({ kind: "video", title: "x", height: 720 }));
  assert.notEqual(m.ytdlpBase({ kind: "audio", title: "x", clip }), m.ytdlpBase({ kind: "audio", title: "x" }));
});

test("draftVideo checks the clip against the length of the video", async (t) => {
  const { m } = setup(t, "http://127.0.0.1:9");
  const draft = (clip) => m.draftVideo("http://video.test/watch", "v720", clip);
  assert.equal((await draft()).clip, undefined);
  assert.equal((await draft(null)).clip, undefined);
  assert.equal((await draft({ start: 0, end: 50 })).clip, undefined, "the whole video is not a clip");
  assert.equal((await draft({ start: 0, end: 50 })).expected, total);
  const part = await draft({ start: 10, end: 20 });
  assert.deepEqual(part.clip, { start: 10, end: 20 });
  assert.equal(part.expected, Math.round(total / 5));
  assert.equal(m.public(part).clip.start, 10);
  await assert.rejects(draft({ start: 10, end: 60 }), /past the end of the video, 0:50/);
  await assert.rejects(draft({ start: 20, end: 10 }), /end must come after/);
  await assert.rejects(draft({ from: 1 }), /as times/);
});

test("a clip that yt-dlp cuts shows no progress until yt-dlp reports, so the list can say so", (t) => {
  const { m } = setup(t, "http://127.0.0.1:9");
  const job = { id: "y", mode: "ytdlp", kind: "video", status: "downloading", downloaded: 0, expected: 1000, streams: [], clip: { start: 5, end: 25 } };
  assert.equal(m.public(job).indeterminate, true);
  assert.equal(m.public({ ...job, downloaded: 400 }).indeterminate, false);
  assert.equal(m.public({ ...job, status: "paused" }).indeterminate, false);
  assert.equal(m.public({ ...job, clip: undefined }).indeterminate, false);
  assert.equal(m.public({ ...job, mode: "segmented" }).indeterminate, false);
});
