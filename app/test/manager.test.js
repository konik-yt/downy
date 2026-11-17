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

// ----------------------------------------------------------------- queue order

// Queued rows as an older Downy saved them, with no order field.
const queuedRows = (n) => Array.from({ length: n }, (_, k) => ({
  id: `q${k + 1}`, title: `file ${k + 1}`, kind: "file", source: "web", status: "queued",
  mode: "segmented", streams: [], downloaded: 0, expected: 100, created: 1000 + k,
}));

// Records which jobs schedule() starts instead of downloading anything.
function recordStarts(m) {
  const started = [];
  m.start = (j) => {
    j.status = "downloading";
    started.push(j.id);
  };
  return started;
}

test("rows without an order take their created time, so the queue keeps its old order", (t) => {
  const { m } = manager(t, { saved: queuedRows(3).reverse(), settings: { maxActive: 1 } });
  const started = recordStarts(m);
  m.schedule();
  assert.deepEqual(started, ["q1"]);
  assert.deepEqual(m.list().map((d) => d.order).sort(), [1000, 1001, 1002]);
});

test("move puts a waiting file in front of another and schedule follows the new order", (t) => {
  const { m } = manager(t, { saved: queuedRows(4), settings: { maxActive: 1 } });
  m.move("q4", "q2");
  assert.deepEqual(m.queue().map((j) => j.id), ["q1", "q4", "q2", "q3"]);
  m.move("q1", null);
  assert.deepEqual(m.queue().map((j) => j.id), ["q4", "q2", "q3", "q1"]);
  m.moveToTop("q3");
  assert.deepEqual(m.queue().map((j) => j.id), ["q3", "q4", "q2", "q1"]);
  // The queue reuses its own order values, so nothing drifts.
  assert.deepEqual(m.queue().map((j) => j.order), [1000, 1001, 1002, 1003]);
  const started = recordStarts(m);
  m.schedule();
  assert.deepEqual(started, ["q3"]);
});

test("move ignores files that are not waiting", (t) => {
  const rows = queuedRows(3);
  rows[2].status = "paused";
  const { m } = manager(t, { saved: rows });
  m.move("q3", "q1");
  m.moveToTop("q3");
  assert.deepEqual(m.queue().map((j) => j.id), ["q1", "q2"]);
});

test("a new or resumed file joins the end of the line", (t) => {
  const rows = queuedRows(3);
  rows[0].status = "paused";
  const { m } = manager(t, { saved: rows });
  m.start = () => {}; // keep everything waiting
  m.resume("q1");
  assert.deepEqual(m.queue().map((j) => j.id), ["q2", "q3", "q1"]);
});

test("remove takes a list of ids", (t) => {
  const rows = queuedRows(3).map((r) => ({ ...r, status: "done" }));
  const { m, dataDir } = manager(t, { saved: rows });
  m.remove(["q1", "q3"]);
  assert.deepEqual(m.list().map((d) => d.id), ["q2"]);
  assert.deepEqual(savedRows(dataDir).map((r) => r.id), ["q2"]);
});

test("files that were running when Downy restarts come back at the front of the line", async (t) => {
  const { m } = manager(t, { saved: queuedRows(4) });
  for (const id of ["q3", "q4"]) {
    m.get(id).status = "downloading";
    m.runtime.set(id, { ctrl: new AbortController(), proc: null, done: Promise.resolve() });
  }
  await m.shutdown({ resume: true });
  assert.deepEqual(m.queue().map((j) => j.id), ["q3", "q4", "q1", "q2"]);
});

// ---------------------------------------------------------------------- batches

test("a batch runs one file at a time in queue order and leaves the other slots to other files", (t) => {
  const rows = queuedRows(5).map((r) => ({ ...r, status: "paused" }));
  const { m } = manager(t, { saved: rows, settings: { maxActive: 3 } });
  const started = recordStarts(m);
  // Picked in any order, the batch keeps the order the files had in the queue.
  const id = m.startBatch(["q3", "q1", "q2", "nope"]);
  assert.deepEqual(m.batchJobs(id).map((j) => [j.id, j.batchIndex]), [["q1", 1], ["q2", 2], ["q3", 3]]);
  assert.deepEqual(started, ["q1"]);
  m.resume("q4");
  m.resume("q5");
  assert.deepEqual(started, ["q1", "q4", "q5"]);
  // A batch file can't be moved around in the line.
  m.move("q3", "q2");
  assert.deepEqual(m.batchJobs(id).map((j) => j.id), ["q1", "q2", "q3"]);
});

test("a failed file in a batch is skipped and the batch goes on with the next one", (t) => {
  const rows = queuedRows(3).map((r) => ({ ...r, status: "paused" }));
  const { m } = manager(t, { saved: rows, settings: { maxActive: 1 } });
  const started = recordStarts(m);
  const ended = [];
  m.on("batch-finished", (b) => ended.push(b));
  const id = m.startBatch(["q1", "q2", "q3"]);
  for (const [k, status] of [[0, "done"], [1, "error"], [2, "done"]]) {
    const j = m.batchJobs(id)[k];
    j.status = status;
    m.schedule();
    m.batchEnded(id);
  }
  assert.deepEqual(started, ["q1", "q2", "q3"]);
  assert.deepEqual(ended, [{ id, count: 3, saved: 2, failed: 1 }]);

  // Retry failed puts only the failed file back.
  m.retryBatch(id);
  assert.deepEqual(started, ["q1", "q2", "q3", "q2"]);
});

test("pause, resume, cancel and dismiss act on the whole batch", (t) => {
  const rows = queuedRows(4).map((r) => ({ ...r, status: "paused" }));
  const { m } = manager(t, { saved: rows, settings: { maxActive: 1 } });
  m.start = () => {}; // keep everything waiting
  const id = m.startBatch(["q1", "q2", "q3"]);
  m.pauseBatch(id);
  assert.deepEqual(m.batchJobs(id).map((j) => j.status), ["paused", "paused", "paused"]);
  m.resumeBatch(id);
  assert.deepEqual(m.queue().map((j) => j.id), ["q1", "q2", "q3"]);
  m.cancelBatch(id);
  assert.deepEqual(m.batchJobs(id).map((j) => j.status), ["cancelled", "cancelled", "cancelled"]);
  assert.equal(m.get("q4").status, "paused");
  m.dismissBatch(id);
  assert.deepEqual(m.batchJobs(id), []);
  assert.equal(m.list().find((d) => d.id === "q1").batch, null);
});

test("startBatch only takes waiting, paused and failed files", (t) => {
  const rows = queuedRows(3);
  rows[0].status = "done";
  rows[1].status = "cancelled";
  rows[2].status = "error";
  const { m } = manager(t, { saved: rows });
  recordStarts(m);
  assert.throws(() => m.startBatch(["q1", "q2"]), /Pick waiting, paused or failed files/);
  const id = m.startBatch(["q1", "q2", "q3"]);
  assert.deepEqual(m.batchJobs(id).map((j) => j.id), ["q3"]);
});

test("a batch downloads real files one by one and reports what failed", async (t) => {
  const { base } = await fileServer(t, { "/a.bin": { body: randomBytes(300 * 1024) }, "/c.bin": { body: randomBytes(200 * 1024) } });
  const row = (id, file, order) => ({
    id, title: file, filename: file, kind: "file", source: "web", ext: "bin", status: "paused", mode: "segmented",
    streams: [{ role: "file", formatId: "", ext: "bin", protocol: "http", url: `${base}/${file}`, headers: {}, size: 0, path: "", segments: null, index: 0 }],
    downloaded: 0, expected: 0, created: order, order,
  });
  const { m } = manager(t, { saved: [row("a", "a.bin", 1), row("b", "missing.bin", 2), row("c", "c.bin", 3)], settings: { maxActive: 3 } });
  // Each file starts only when nothing else is running.
  const start = m.start.bind(m);
  const busyAtStart = [];
  m.start = (j) => {
    busyAtStart.push(m.activeCount());
    start(j);
  };
  const ended = once(m, "batch-finished");
  const id = m.startBatch(["a", "b", "c"]);
  const [summary] = await ended;
  assert.deepEqual(summary, { id, count: 3, saved: 2, failed: 1 });
  assert.deepEqual(busyAtStart, [0, 0, 0]);
  assert.deepEqual(m.batchJobs(id).map((j) => j.status), ["done", "error", "done"]);
});

test("an all together batch runs as many files at once as the setting allows", (t) => {
  const rows = queuedRows(5).map((r) => ({ ...r, status: "paused" }));
  const { m } = manager(t, { saved: rows, settings: { maxActive: 3 } });
  const started = recordStarts(m);
  const id = m.startBatch(["q1", "q2", "q3", "q4"], "all");
  assert.deepEqual(started, ["q1", "q2", "q3"]);
  assert.equal(m.list().find((d) => d.id === "q1").batchMode, "all");
  m.dismissBatch(id);
  assert.equal(m.list().find((d) => d.id === "q1").batchMode, null);
});

test("commitBatch adds drafts as one batch in the given order before any of them starts", (t) => {
  const { m } = manager(t, { settings: { maxActive: 3 } });
  const draft = (id) => ({ id, title: `${id}.bin`, filename: `${id}.bin`, kind: "file", source: "web", ext: "bin", status: "queued", mode: "segmented", streams: [], downloaded: 0, expected: 10, created: Date.now(), cookies: "sid=1" });
  const started = recordStarts(m);
  const { batch, downloads } = m.commitBatch([draft("c"), draft("a"), draft("b")], { dir: "" }, "one");
  assert.deepEqual(downloads.map((d) => [d.id, d.batchIndex]), [["c", 1], ["a", 2], ["b", 3]]);
  assert.deepEqual(started, ["c"]);
  assert.deepEqual(m.batchJobs(batch).map((j) => j.id), ["c", "a", "b"]);
  assert.equal(m.cookies.get("a"), "sid=1");
  assert.equal(m.get("a").cookies, undefined);
  assert.throws(() => m.commitBatch([]), /nothing to download/);
});
