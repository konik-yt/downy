const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { once } = require("events");
const { Manager } = require("../src/main/manager");
const { tempDir, fileServer, randomBytes } = require("./helpers");

function manager(t, extra = {}) {
  const root = tempDir(t, "downy-manager-");
  const dataDir = path.join(root, "data");
  const values = { downloadDir: path.join(root, "Downy"), connections: 4, maxActive: 3, organize: true, ...extra.settings };
  if (extra.saved) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "downloads.json"), JSON.stringify(extra.saved));
  }
  const m = new Manager({ dataDir, cache: extra.cache || {}, settings: { get: () => values } });
  t.after(() => m.shutdown());
  return { m, root, dataDir, values };
}

const savedRows = (dataDir) => JSON.parse(fs.readFileSync(path.join(dataDir, "downloads.json"), "utf8"));

test("a file download lands in the Downloads folder and keeps cookies out of the saved list", async (t) => {
  const body = randomBytes(3 * 1024 * 1024 + 7);
  const { base, log } = await fileServer(t, { "/get": { body, name: 'attachment; filename="Report: Q3?.pdf"', type: "application/pdf" } });
  const { m, dataDir, values } = manager(t);

  const finished = once(m, "finished");
  const job = await m.addFile({ url: `${base}/get?id=1`, referrer: "https://example.com/", cookies: "sid=secret" });
  assert.equal(job.title, "Report Q3 .pdf");
  assert.doesNotMatch(fs.readFileSync(path.join(dataDir, "downloads.json"), "utf8"), /secret/);

  const [done] = await finished;
  assert.equal(done.status, "done");
  assert.equal(done.progress, 1);
  assert.equal(done.filepath, path.join(values.downloadDir, "Downloads", "Report Q3 .pdf"));
  assert.ok(fs.readFileSync(done.filepath).equals(body));
  assert.ok(log.every((r) => r.headers.cookie === "sid=secret"), "every request carries the browser cookie");
  assert.ok(log.every((r) => r.headers.referer === "https://example.com/"));

  // The part file is gone, and the saved list has no headers or cookies left.
  assert.deepEqual(fs.readdirSync(path.join(dataDir, "parts")), []);
  m.save();
  const row = savedRows(dataDir).find((r) => r.id === job.id);
  assert.equal(row.status, "done");
  assert.equal(row.streams[0].headers, undefined);
  assert.doesNotMatch(JSON.stringify(row), /secret/);

  if (process.platform === "win32") {
    // Windows marks the file as downloaded from the internet, like a browser does.
    const zone = fs.readFileSync(`${done.filepath}:Zone.Identifier`, "utf8");
    assert.match(zone, /ZoneId=3/);
    assert.match(zone, /ReferrerUrl=https:\/\/example\.com\//);
  }
});

test("a second download with the same name gets a numbered file", async (t) => {
  const { base } = await fileServer(t, { "/a.txt": { body: Buffer.from("one") } });
  const { m } = manager(t);
  const paths = [];
  for (let i = 0; i < 2; i++) {
    const finished = once(m, "finished");
    await m.addFile({ url: `${base}/a.txt` });
    paths.push((await finished)[0].filepath);
  }
  assert.deepEqual(paths.map((p) => path.basename(p)), ["a.txt", "a (2).txt"]);
});

test("draftFile refuses other schemes and links that open a web page", async (t) => {
  const { base } = await fileServer(t, { "/page": { body: Buffer.from("<html>"), type: "text/html; charset=utf-8" } });
  const { m } = manager(t);
  await assert.rejects(m.draftFile({ url: "file:///C:/Windows/win.ini" }), /http and https/);
  await assert.rejects(m.draftFile({ url: "nope" }), /not a valid link/);
  await assert.rejects(m.draftFile({ url: `${base}/page` }), /web page/);
  // Asked for on purpose, a page can still be saved.
  const draft = await m.draftFile({ url: `${base}/page`, filename: "saved.html" });
  assert.equal(draft.filename, "saved.html");
});

test("saved downloads come back paused and without cookies", async (t) => {
  const stream = (headers) => ({ role: "file", url: "https://x/a", headers, path: "", segments: null });
  const { m, dataDir } = manager(t, {
    saved: [
      { id: "run", status: "downloading", kind: "file", created: 2, streams: [stream({ Cookie: "sid=old", Accept: "*/*" })] },
      { id: "wait", status: "queued", kind: "file", created: 1, streams: [stream({ cookie: "sid=old" })] },
      { id: "fin", status: "done", kind: "file", created: 3, streams: [] },
      null,
      { status: "queued" },
      "junk",
    ],
  });
  assert.deepEqual(m.list().map((d) => [d.id, d.status]), [["fin", "done"], ["run", "paused"], ["wait", "queued"]]);
  assert.doesNotMatch(fs.readFileSync(path.join(dataDir, "downloads.json"), "utf8"), /sid=old/);
  assert.deepEqual(m.get("run").streams[0].headers, { Accept: "*/*" });
});

test("a broken saved list starts empty", (t) => {
  const { m } = manager(t, { saved: { not: "a list" } });
  assert.deepEqual(m.list(), []);
});

test("folders follow the format, the site and the organize setting", (t) => {
  const { m, values } = manager(t);
  const at = (...parts) => path.join(values.downloadDir, ...parts);
  assert.deepEqual(m.dirFor({ kind: "video", source: "youtube", folder: "1080p" }), { abs: at("YouTube", "1080p"), rel: "YouTube/1080p" });
  assert.deepEqual(m.dirFor({ kind: "mp3", source: "video", folder: "MP3" }), { abs: at("Videos", "MP3"), rel: "Videos/MP3" });
  assert.deepEqual(m.dirFor({ kind: "file", folder: "Downloads" }), { abs: at("Downloads"), rel: "Downloads" });
  values.organize = false;
  assert.deepEqual(m.dirFor({ kind: "video", source: "youtube", folder: "1080p" }), { abs: at("YouTube"), rel: "YouTube" });

  assert.equal(m.dirFor({ kind: "file", customDir: at("Work", "Q3") }).rel, "Work/Q3");
  const outside = path.join(path.dirname(values.downloadDir), "Elsewhere");
  assert.deepEqual(m.dirFor({ kind: "file", customDir: outside }), { abs: outside, rel: "Other" });
});

test("file names are safe for Windows and keep their extension", (t) => {
  const { m } = manager(t);
  assert.equal(m.targetName({ kind: "video", title: 'A/B: "C"?', height: 720 }), "A B C (720p).mp4");
  assert.equal(m.targetName({ kind: "mp3", title: "..." }), "video.mp3");
  assert.equal(m.targetName({ kind: "audio", title: "Song\u0007 " }), "Song.m4a");
  const long = m.targetName({ kind: "file", filename: "x".repeat(300) + ".tar.gz" });
  assert.equal(long.length, 150);
  assert.ok(long.endsWith("x.gz"));

  // A typed name cannot leave the folder, and a typed extension is not doubled.
  const escape = m.targetName({ kind: "file", ext: "zip", customName: "..\\..\\evil" });
  assert.doesNotMatch(escape, /[\\/]/);
  assert.equal(path.basename(escape), escape);
  assert.equal(m.targetName({ kind: "file", ext: "zip", customName: "report" }), "report.zip");
  assert.equal(m.targetName({ kind: "video", customName: "clip.MP4", title: "x" }), "clip.mp4");
  assert.equal(m.targetName({ kind: "file", ext: "zip", customName: "notes.txt" }), "notes.txt");
});

test("commit only takes an absolute folder and a name without folders", (t) => {
  const { m } = manager(t);
  const draft = () => ({ id: Math.random().toString(36).slice(2), kind: "file", ext: "zip", filename: "a.zip", title: "a.zip", status: "paused", created: Date.now(), streams: [] });
  const relative = m.commit(draft(), { dir: "..\\..\\Windows", name: "" });
  assert.equal(m.get(relative.id).customDir, undefined);
  const named = m.commit(draft(), { dir: path.resolve("/tmp/x/../y"), name: "a/b" });
  assert.equal(m.get(named.id).customDir, path.resolve("/tmp/y"));
  assert.equal(named.title, "a b.zip");
});

test("cleanup only deletes files inside a parts folder", (t) => {
  const { m, root } = manager(t);
  const keep = path.join(root, "Downy", "mine.bin");
  const part = path.join(m.partsDir(), "job.file.bin");
  fs.mkdirSync(path.dirname(keep), { recursive: true });
  fs.writeFileSync(keep, "x");
  fs.writeFileSync(part, "x");
  m.cleanup({ id: "job", mode: "segmented", streams: [{ path: keep, headers: { Cookie: "a" } }, { path: part }] });
  assert.equal(fs.existsSync(keep), true);
  assert.equal(fs.existsSync(part), false);
});

test("pause, cancel and clear work on downloads that are not running", (t) => {
  const row = (id, status, created) => ({ id, status, kind: "file", created, streams: [] });
  const { m } = manager(t, { saved: [row("p", "paused", 1), row("d", "done", 2), row("e", "error", 3), row("c", "cancelled", 4)] });
  m.cancel("p");
  assert.equal(m.get("p").status, "cancelled");
  m.cancel("d"); // finished downloads stay as they are
  assert.equal(m.get("d").status, "done");
  m.clearFinished("done");
  assert.deepEqual(m.list().map((d) => d.id).sort(), ["c", "e", "p"]);
  m.clearFinished("failed");
  assert.deepEqual(m.list(), []);
});
