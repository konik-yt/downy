const test = require("node:test");
const assert = require("node:assert/strict");
const { isYoutubeUrl, isHttpUrl, humanSize, buildOptions, publicOptions, cookieFile } = require("../src/main/formats");

test("isYoutubeUrl accepts YouTube hosts and nothing that only looks like one", () => {
  for (const url of [
    "https://www.youtube.com/watch?v=abc",
    "https://m.youtube.com/watch?v=abc",
    "https://youtu.be/abc",
    "http://youtube.com/shorts/abc",
    "https://www.youtube-nocookie.com/embed/abc",
  ]) assert.equal(isYoutubeUrl(url), true, url);

  for (const url of [
    "https://youtube.com.evil.example/watch?v=abc",
    "https://notyoutube.com/watch?v=abc",
    "ftp://youtube.com/x",
    "javascript:alert(1)//youtube.com",
    "not a url",
    null,
    42,
  ]) assert.equal(isYoutubeUrl(url), false, String(url));
});

test("isHttpUrl only accepts http and https", () => {
  assert.equal(isHttpUrl("https://vimeo.com/1"), true);
  assert.equal(isHttpUrl("http://127.0.0.1/x"), true);
  for (const url of ["file:///C:/Windows/win.ini", "javascript:alert(1)", "data:text/html,x", "-o evil", "", undefined]) {
    assert.equal(isHttpUrl(url), false, String(url));
  }
});

test("humanSize picks the unit and precision", () => {
  assert.equal(humanSize(0), "");
  assert.equal(humanSize(undefined), "");
  assert.equal(humanSize(500), "500 B");
  assert.equal(humanSize(2048), "2 KB");
  assert.equal(humanSize(5.5 * 1024 * 1024), "5.5 MB");
  assert.equal(humanSize(3 * 1024 ** 3), "3.0 GB");
  assert.equal(humanSize(5 * 1024 ** 4), "5120.0 GB");
});

// A trimmed-down yt-dlp -J result for a YouTube video.
function youtubeInfo() {
  const v = (id, height, vcodec, ext, extra = {}) => ({
    format_id: id, height, vcodec, acodec: "none", ext, protocol: "https", url: `https://v/${id}`, filesize: 1000 * height, fps: 30, tbr: height, ...extra,
  });
  return {
    title: "Clip",
    formats: [
      { format_id: "sb0", ext: "mhtml", height: 90, vcodec: "none", acodec: "none", protocol: "mhtml" },
      { format_id: "140-drc", ext: "m4a", vcodec: "none", acodec: "mp4a.40.2", abr: 129, protocol: "https", url: "https://a/drc", filesize: 900 },
      { format_id: "140", ext: "m4a", vcodec: "none", acodec: "mp4a.40.2", abr: 129, protocol: "https", url: "https://a/140", filesize: 1000, format_note: "medium, original (default)" },
      { format_id: "251", ext: "webm", vcodec: "none", acodec: "opus", abr: 140, protocol: "https", url: "https://a/251", filesize: 1100 },
      v("137", 1080, "avc1.640028", "mp4"),
      v("248", 1080, "vp9", "webm", { tbr: 5000 }),
      v("299", 1080, "avc1.64002a", "mp4", { fps: 60 }),
      v("136", 720, "avc1.4d401f", "mp4"),
      v("hls-720", 720, "avc1.4d401f", "mp4", { protocol: "m3u8_native", tbr: 9999 }),
      v("313", 2160, "vp9", "webm"),
      { format_id: "18", ext: "mp4", height: 360, vcodec: "avc1.42001E", acodec: "mp4a.40.2", protocol: "https", url: "https://c/18", filesize: 5000 },
    ],
  };
}

test("buildOptions offers one option per height, best first, then audio", () => {
  const options = buildOptions(youtubeInfo());
  assert.deepEqual(options.map((o) => o.id), ["v2160", "v1080", "v720", "v360", "m4a", "mp3"]);
  assert.equal(options[0].label, "MP4 file, quality 2160p 4K");
  assert.equal(options[2].label, "MP4 file, quality 720p HD");
  assert.equal(options[0].folder, "2160p");
});

test("buildOptions prefers HTTP H.264 MP4 video at the highest frame rate", () => {
  const v1080 = buildOptions(youtubeInfo()).find((o) => o.id === "v1080");
  assert.deepEqual(v1080.streams.map((s) => [s.role, s.formatId]), [["video", "299"], ["audio", "140"]]);
  assert.equal(v1080.label, "MP4 file, quality 1080p 60fps HD");
  assert.equal(v1080.size, 1080 * 1000 + 1000);

  // An HLS stream at the same height loses to a plain HTTP one, whatever its bitrate.
  const v720 = buildOptions(youtubeInfo()).find((o) => o.id === "v720");
  assert.equal(v720.streams[0].formatId, "136");
});

test("buildOptions takes the original m4a track over the DRC one", () => {
  const audio = buildOptions(youtubeInfo()).find((o) => o.id === "m4a");
  assert.equal(audio.streams[0].formatId, "140");
  assert.equal(audio.streams[0].url, "https://a/140");
});

test("buildOptions falls back to the combined stream when there is no separate audio", () => {
  const info = { formats: [{ format_id: "18", ext: "mp4", height: 360, vcodec: "avc1", acodec: "mp4a", protocol: "https", url: "https://c/18", filesize: 5000 }] };
  const options = buildOptions(info);
  assert.deepEqual(options.map((o) => o.id), ["v360"]);
  assert.deepEqual(options[0].streams.map((s) => s.role), ["combined"]);
});

test("buildOptions lets yt-dlp choose when formats have no height", () => {
  const info = { formats: [{ format_id: "hls", ext: "mp4", vcodec: "avc1", acodec: "mp4a", protocol: "m3u8_native" }] };
  const [best] = buildOptions(info);
  assert.equal(best.id, "best");
  assert.equal(best.selector, "bv*+ba/b");
  assert.deepEqual(best.streams, []);
});

test("buildOptions returns nothing for a page without formats", () => {
  assert.deepEqual(buildOptions({}), []);
});

test("publicOptions leaves out stream links and headers", () => {
  const options = publicOptions(buildOptions(youtubeInfo()));
  assert.equal(options.length, buildOptions(youtubeInfo()).length);
  assert.doesNotMatch(JSON.stringify(options), /https:\/\/|"streams"|"headers"/);
});

test("cookieFile writes the Netscape format yt-dlp reads", () => {
  const text = cookieFile([
    { name: "sid", value: "abc", domain: ".vimeo.com", path: "/", secure: true, expirationDate: 1900000000.4 },
    { name: "host", value: "1", domain: "www.vimeo.com", hostOnly: true },
  ]);
  assert.equal(text, [
    "# Netscape HTTP Cookie File",
    ".vimeo.com\tTRUE\t/\tTRUE\t1900000000\tsid\tabc",
    "www.vimeo.com\tFALSE\t/\tFALSE\t0\thost\t1",
    "",
  ].join("\n"));
});

test("cookieFile keeps a cookie on one line and skips broken entries", () => {
  const text = cookieFile([
    null,
    { name: "", value: "x", domain: "a.com" },
    { name: "x", value: "y" },
    { name: "evil", value: "a\nb.com\tTRUE\t/\tFALSE\t0\tinjected\tz", domain: "a.com\r" },
  ]);
  const lines = text.trimEnd().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[1].split("\t").length, 7);
  assert.doesNotMatch(text, /\r/);
});
