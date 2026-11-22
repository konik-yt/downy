const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { once } = require("events");
const { Manager } = require("../src/main/manager");
const { fileServer, randomBytes } = require("./helpers");

// Every Manager made on a folder shuts down, which stops its downloads, before the folder is deleted.
const managersIn = new Map();

// With `root` the Manager opens the data of an earlier one, like Downy does when it starts again.
function manager(t, extra = {}) {
  let root = extra.root;
  if (!root) {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "downy-manager-"));
    managersIn.set(root, []);
    t.after(async () => {
      for (const m of managersIn.get(root)) await m.shutdown();
      managersIn.delete(root);
      fs.rmSync(root, { recursive: true, force: true });
    });
  }
  const dataDir = path.join(root, "data");
  const values = { downloadDir: path.join(root, "Downy"), connections: 4, maxActive: 3, organize: true, ...extra.settings };
  if (extra.saved) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, "downloads.json"), JSON.stringify(extra.saved));
  }
  const m = new Manager({ dataDir, cache: extra.cache || {}, settings: { get: () => values } });
  managersIn.get(root).push(m);
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
  const { m, values } = manager(t);
  const draft = () => ({ id: Math.random().toString(36).slice(2), kind: "file", ext: "zip", filename: "a.zip", title: "a.zip", folder: "Downloads", status: "paused", created: Date.now(), streams: [] });
  const relative = m.commit(draft(), { dir: "..\\..\\Windows", name: "" });
  assert.equal(m.dirFor(m.get(relative.id)).abs, path.join(values.downloadDir, "Downloads"));
  const named = m.commit(draft(), { dir: path.resolve("/tmp/x/../y"), name: "a/b" });
  assert.equal(m.dirFor(m.get(named.id)).abs, path.resolve("/tmp/y"));
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

// Saved downloads for small files on the test server. Rows without an order are how an
// older Downy saved them.
const rowsFor = (base, ids, extra = {}) => ids.map((id, k) => ({
  id, title: `${id}.bin`, filename: `${id}.bin`, kind: "file", source: "web", ext: "bin", status: "queued", mode: "segmented",
  streams: [{ role: "file", formatId: "", ext: "bin", protocol: "http", url: `${base}/${id}.bin`, headers: {}, size: 0, path: "", segments: null, index: 0 }],
  downloaded: 0, expected: 0, created: 1000 + k, ...extra,
}));
const filesFor = (ids, extra = {}) => Object.fromEntries(ids.map((id) => [`/${id}.bin`, { body: randomBytes(2048), ...extra }]));
const at = (id) => `/${id}.bin`;
const statuses = (m) => Object.fromEntries(m.list().map((d) => [d.id, d.status]));
// Ids in the order the server was first asked for their file.
const askedFor = (srv) => srv.requested().map((p) => path.basename(p, ".bin"));
// Gives a request that should not happen the time to arrive.
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

// Resolves with the names of the next n saved files, in the order they were saved.
function savedNames(m, n) {
  const names = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      m.off("finished", onFinished);
      reject(new Error(`Only ${names.length} of ${n} files were saved: ${names.join(", ")}`));
    }, 5000);
    const onFinished = (d) => {
      names.push(path.basename(d.filepath));
      if (names.length < n) return;
      clearTimeout(timer);
      m.off("finished", onFinished);
      resolve(names);
    };
    m.on("finished", onFinished);
  });
}

// Resolves once the statuses the list shows pass check.
function until(m, check) {
  return new Promise((resolve, reject) => {
    const onUpdate = () => {
      if (!check(statuses(m))) return;
      clearTimeout(timer);
      m.off("update", onUpdate);
      resolve();
    };
    const timer = setTimeout(() => {
      m.off("update", onUpdate);
      reject(new Error(`The list stayed at ${JSON.stringify(statuses(m))}`));
    }, 5000);
    m.on("update", onUpdate);
    onUpdate();
  });
}

test("the queue starts the file with the lowest order first", async (t) => {
  const ids = ["q1", "q2", "q3"];
  const srv = await fileServer(t, filesFor(ids));
  const rows = rowsFor(srv.base, ids);
  [3, 1, 2].forEach((order, k) => (rows[k].order = order));
  const { m } = manager(t, { saved: rows, settings: { maxActive: 1 } });
  const saved = savedNames(m, 3);
  m.schedule(); // Downy starts
  await saved;
  assert.deepEqual(askedFor(srv), ["q2", "q3", "q1"]);
});

test("rows without an order take their created time, so the queue keeps its old order", async (t) => {
  const ids = ["q1", "q2", "q3"];
  const srv = await fileServer(t, filesFor(ids));
  const { m } = manager(t, { saved: rowsFor(srv.base, ids).reverse(), settings: { maxActive: 1 } });
  const saved = savedNames(m, 3);
  m.schedule();
  await saved;
  assert.deepEqual(askedFor(srv), ["q1", "q2", "q3"]);
});

test("move and moveToTop change which waiting file starts next", async (t) => {
  const ids = ["q1", "q2", "q3", "q4"];
  const srv = await fileServer(t, filesFor(ids));
  const { m } = manager(t, { saved: rowsFor(srv.base, ids), settings: { maxActive: 1 } });
  m.move("q4", "q2");
  assert.deepEqual(m.queue().map((j) => j.id), ["q1", "q4", "q2", "q3"]);
  m.move("q1", null);
  assert.deepEqual(m.queue().map((j) => j.id), ["q4", "q2", "q3", "q1"]);
  m.moveToTop("q3");
  assert.deepEqual(m.queue().map((j) => j.id), ["q3", "q4", "q2", "q1"]);
  const saved = savedNames(m, 4);
  m.schedule();
  await saved;
  assert.deepEqual(askedFor(srv), ["q3", "q4", "q2", "q1"]);
});

test("move ignores files that are not waiting", (t) => {
  const rows = rowsFor("https://example.com", ["q1", "q2", "q3"]);
  rows[2].status = "paused";
  const { m } = manager(t, { saved: rows });
  m.move("q3", "q1");
  m.moveToTop("q3");
  assert.deepEqual(m.queue().map((j) => j.id), ["q1", "q2"]);
});

test("a resumed file joins the end of the line, and so does a new one", async (t) => {
  const ids = ["q1", "q2", "q3"];
  const srv = await fileServer(t, { ...filesFor(ids), "/new.bin": { body: randomBytes(2048) } });
  const rows = rowsFor(srv.base, ids);
  rows[0].status = "paused";
  const { m } = manager(t, { saved: rows, settings: { maxActive: 1 } });
  const saved = savedNames(m, 4);
  m.resume("q1");
  await m.addFile({ url: `${srv.base}/new.bin` });
  assert.deepEqual(await saved, ["q2.bin", "q3.bin", "q1.bin", "new.bin"]);
});

test("remove takes a list of ids", (t) => {
  const rows = rowsFor("https://example.com", ["q1", "q2", "q3"], { status: "done" });
  const { m, dataDir } = manager(t, { saved: rows });
  m.remove(["q1", "q3"]);
  assert.deepEqual(m.list().map((d) => d.id), ["q2"]);
  assert.deepEqual(savedRows(dataDir).map((r) => r.id), ["q2"]);
});

test("files that were running when Downy restarts come back at the front of the line", async (t) => {
  const ids = ["b1", "b2", "q3", "q4"];
  const srv = await fileServer(t, filesFor(ids, { hold: true }));
  // b2 waits behind b1 in a one at a time batch, so it waits with a lower order than the running q3 and q4.
  const rows = rowsFor(srv.base, ids).map((r, k) => ({ ...r, order: k + 1 }));
  Object.assign(rows[0], { batch: "x", batchIndex: 1, batchAt: 1, batchMode: "one" });
  Object.assign(rows[1], { batch: "x", batchIndex: 2, batchAt: 1, batchMode: "one" });
  const before = manager(t, { saved: rows, settings: { maxActive: 3 } });
  before.m.schedule();
  await Promise.all(["b1", "q3", "q4"].map((id) => srv.asked(at(id))));
  assert.equal(statuses(before.m).b2, "queued");
  await before.m.shutdown({ resume: true });

  // The new Downy runs one file at a time, so the order it saves them in is the order of the line.
  const { m } = manager(t, { root: before.root, settings: { maxActive: 1 } });
  for (const id of ids) srv.release(at(id));
  const saved = savedNames(m, 4);
  m.schedule();
  assert.deepEqual(await saved, ["b1.bin", "q3.bin", "q4.bin", "b2.bin"]);
});

// ---------------------------------------------------------------------- batches

test("a batch runs one file at a time in queue order and leaves the other slots to other files", async (t) => {
  const ids = ["q1", "q2", "q3", "q4", "q5"];
  const srv = await fileServer(t, filesFor(ids, { hold: true }));
  const { m } = manager(t, { saved: rowsFor(srv.base, ids, { status: "paused" }), settings: { maxActive: 3 } });
  // Picked in any order, the batch keeps the order the files had in the queue.
  const id = m.startBatch(["q3", "q1", "q2", "nope"]);
  assert.deepEqual(m.batchJobs(id).map((j) => [j.id, j.batchIndex]), [["q1", 1], ["q2", 2], ["q3", 3]]);
  m.resume("q4");
  m.resume("q5");
  await Promise.all(["q1", "q4", "q5"].map((x) => srv.asked(at(x))));
  await settle();
  assert.deepEqual(askedFor(srv).sort(), ["q1", "q4", "q5"]);

  // A batch file can't be moved around in the line.
  m.move("q3", "q2");
  assert.deepEqual(m.queue().map((j) => j.id), ["q2", "q3"]);

  // The batch starts its next file once the one before it is saved.
  srv.release(at("q1"));
  await srv.asked(at("q2"));
  assert.equal(statuses(m).q1, "done");
  await settle();
  assert.equal(statuses(m).q3, "queued");
  assert.equal(srv.requested().includes(at("q3")), false);
  srv.release(at("q2"));
  await srv.asked(at("q3"));
  assert.equal(statuses(m).q2, "done");
});

test("pause, resume, cancel and dismiss act on the whole batch", async (t) => {
  const ids = ["q1", "q2", "q3", "q4"];
  const srv = await fileServer(t, filesFor(ids, { hold: true }));
  const { m } = manager(t, { saved: rowsFor(srv.base, ids, { status: "paused" }), settings: { maxActive: 1 } });
  const id = m.startBatch(["q1", "q2", "q3"]);
  await srv.asked(at("q1"));

  m.pauseBatch(id);
  await until(m, (s) => s.q1 === "paused" && s.q2 === "paused" && s.q3 === "paused");

  // The batch starts again from its first file.
  m.resumeBatch(id);
  await srv.asked(at("q1"), 2);
  assert.deepEqual(m.queue().map((j) => j.id), ["q2", "q3"]);

  m.cancelBatch(id);
  await until(m, (s) => s.q1 === "cancelled" && s.q2 === "cancelled" && s.q3 === "cancelled");
  assert.equal(statuses(m).q4, "paused");
  await settle();
  assert.deepEqual(askedFor(srv), ["q1"]);

  m.dismissBatch(id);
  assert.deepEqual(m.batchJobs(id), []);
  assert.equal(m.list().find((d) => d.id === "q1").batch, null);
});

test("startBatch only takes waiting, paused and failed files", async (t) => {
  const ids = ["q1", "q2", "q3"];
  const srv = await fileServer(t, filesFor(ids, { hold: true }));
  const rows = rowsFor(srv.base, ids);
  rows[0].status = "done";
  rows[1].status = "cancelled";
  rows[2].status = "error";
  const { m } = manager(t, { saved: rows });
  assert.throws(() => m.startBatch(["q1", "q2"]), /Pick waiting, paused or failed files/);
  const id = m.startBatch(["q1", "q2", "q3"]);
  assert.deepEqual(m.batchJobs(id).map((j) => j.id), ["q3"]);
  await srv.asked(at("q3"));
});

test("a batch with a failing file saves the others one by one and retry runs only the failed file", async (t) => {
  const files = filesFor(["a", "c"], { hold: true });
  const srv = await fileServer(t, files);
  const { m, values } = manager(t, { saved: rowsFor(srv.base, ["a", "missing", "c"], { status: "paused" }), settings: { maxActive: 3 } });
  let ended = once(m, "batch-finished", { signal: AbortSignal.timeout(5000) });
  const id = m.startBatch(["a", "missing", "c"]);
  await srv.asked(at("a"));
  await settle();
  assert.deepEqual(askedFor(srv), ["a"]);

  srv.release(at("a"));
  await srv.asked(at("missing"));
  assert.equal(statuses(m).a, "done");
  assert.equal(statuses(m).c, "queued");
  await srv.asked(at("c"));
  assert.equal(statuses(m).missing, "error");
  srv.release(at("c"));
  assert.deepEqual(await ended, [{ id, count: 3, saved: 2, failed: 1 }]);
  assert.deepEqual(["a", "missing", "c"].map((x) => statuses(m)[x]), ["done", "error", "done"]);
  const folder = path.join(values.downloadDir, "Downloads");
  assert.deepEqual(fs.readdirSync(folder).sort(), ["a.bin", "c.bin"]);
  for (const x of ["a", "c"]) assert.ok(fs.readFileSync(path.join(folder, `${x}.bin`)).equals(files[at(x)].body));

  const before = srv.log.length;
  ended = once(m, "batch-finished", { signal: AbortSignal.timeout(5000) });
  m.retryBatch(id);
  assert.deepEqual(await ended, [{ id, count: 3, saved: 2, failed: 1 }]);
  assert.deepEqual(srv.log.slice(before).map((r) => r.path), [at("missing")]);
});

test("an all together batch runs as many files at once as the setting allows", async (t) => {
  const ids = ["q1", "q2", "q3", "q4", "q5"];
  const srv = await fileServer(t, filesFor(ids, { hold: true }));
  const { m } = manager(t, { saved: rowsFor(srv.base, ids, { status: "paused" }), settings: { maxActive: 3 } });
  const id = m.startBatch(["q1", "q2", "q3", "q4"], "all");
  await Promise.all(["q1", "q2", "q3"].map((x) => srv.asked(at(x))));
  await settle();
  assert.deepEqual(askedFor(srv).sort(), ["q1", "q2", "q3"]);
  assert.equal(m.list().find((d) => d.id === "q1").batchMode, "all");

  srv.release(at("q1"));
  await srv.asked(at("q4"));
  m.dismissBatch(id);
  assert.equal(m.list().find((d) => d.id === "q1").batchMode, null);
});

test("commitBatch adds drafts as one batch in the given order and starts only its first file", async (t) => {
  const ids = ["c", "a", "b"];
  const srv = await fileServer(t, filesFor(ids));
  const { m, dataDir } = manager(t, { settings: { maxActive: 3 } });
  const drafts = [];
  for (const x of ids) drafts.push(await m.draftFile({ url: `${srv.base}${at(x)}`, cookies: "sid=1" }));
  for (const x of ids) srv.hold(at(x));
  const before = srv.log.length;

  const { batch, downloads } = m.commitBatch(drafts, { dir: "" }, "one");
  assert.deepEqual(downloads.map((d) => [d.title, d.batchIndex]), [["c.bin", 1], ["a.bin", 2], ["b.bin", 3]]);
  assert.deepEqual(m.batchJobs(batch).map((j) => j.title), ["c.bin", "a.bin", "b.bin"]);
  await srv.asked(at("c"), 2);
  await settle();
  assert.deepEqual(srv.log.slice(before).map((r) => r.path), [at("c")]);

  m.save();
  assert.doesNotMatch(fs.readFileSync(path.join(dataDir, "downloads.json"), "utf8"), /sid=1/);
  assert.throws(() => m.commitBatch([]), /nothing to download/);
});
