const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { once } = require("events");
const { Manager } = require("../src/main/manager");
const { readZip, chooseEntries } = require("../src/main/zip");
const { fileServer, randomBytes, makeZip, tempDir } = require("./helpers");

const MB = 1024 * 1024;

function manager(t, root) {
  const values = { downloadDir: path.join(root, "Downy"), connections: 4, maxActive: 3, organize: true };
  const m = new Manager({ dataDir: path.join(root, "data"), cache: {}, settings: { get: () => values } });
  t.after(() => m.shutdown());
  return { m, downloads: path.join(values.downloadDir, "Downloads"), parts: path.join(root, "data", "parts") };
}

const until = async (check, what) => {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(check(), what);
};

// Five entries, big ones between and after the chosen two so the gaps are not worth fetching.
const ENTRIES = [
  { name: "big one.bin", data: randomBytes(1.5 * MB) },
  { name: "../evil.txt", data: "I want out of the folder. ".repeat(50), method: 8 },
  { name: "middle.bin", data: randomBytes(1.5 * MB) },
  { name: "nested/deeper/data.bin", data: randomBytes(1.2 * MB), method: 8, descriptor: true },
  { name: "tail.bin", data: randomBytes(1.5 * MB) },
];

async function zipDraft(m, base) {
  const draft = await m.draftFile({ url: `${base}/Pack.zip`, referrer: "https://example.com/" });
  const dir = await readZip(draft);
  assert.ok(dir, "the archive's directory was read");
  return { draft, dir };
}

test("a ZIP job fetches only the chosen entries and unpacks them inside a folder named after the archive", async (t) => {
  const { body, entries } = makeZip(ENTRIES);
  const { base, log } = await fileServer(t, { "/Pack.zip": { body, type: "application/zip" } });
  const { m, downloads, parts } = manager(t, tempDir(t));

  const { draft, dir } = await zipDraft(m, base);
  const finished = once(m, "finished");
  const job = m.commit(chooseEntries(draft, dir, [1, 3]));
  assert.equal(job.title, "2 files from Pack.zip");
  const [done] = await finished;

  assert.equal(done.status, "done");
  const folder = path.join(downloads, "Pack");
  assert.equal(done.filepath, folder);
  assert.ok(fs.readFileSync(path.join(folder, "evil.txt")).equals(entries[1].data), "../evil.txt lands inside the folder");
  assert.ok(fs.readFileSync(path.join(folder, "nested", "deeper", "data.bin")).equals(entries[3].data));
  assert.deepEqual(fs.readdirSync(downloads), ["Pack"], "nothing lands beside the folder");
  assert.deepEqual(fs.readdirSync(parts), [], "the run files are gone");

  // Every byte asked for is the probe's first byte, the directory reads at the end, or a chosen span.
  const spanOf = (k) => [entries[k].offset, entries[k + 1].offset - 1];
  const tailFrom = body.length - Math.min(body.length, 0xffff + 22);
  const allowed = [[0, 0], spanOf(1), spanOf(3), [tailFrom, body.length - 1], [dir.cdOffset, dir.cdOffset + dir.cdSize - 1]];
  const ranges = log.map((r) => /^bytes=(\d+)-(\d+)$/.exec(r.range)).map((x) => [Number(x[1]), Number(x[2])]);
  for (const [s, e] of ranges) assert.ok(allowed.some(([a, b]) => s >= a && e <= b), `bytes ${s}-${e} are outside the chosen entries`);
  const fetched = ranges.reduce((n, [s, e]) => n + e - s + 1, 0);
  assert.ok(fetched < entries[3].data.length + 200 * 1024, `fetched ${fetched} of ${body.length} bytes`);

  if (process.platform === "win32") {
    for (const f of [path.join(folder, "evil.txt"), path.join(folder, "nested", "deeper", "data.bin")]) {
      assert.match(fs.readFileSync(`${f}:Zone.Identifier`, "utf8"), /ZoneId=3/);
    }
    assert.throws(() => fs.readFileSync(`${folder}:Zone.Identifier`), "the folder has no mark");
  }
});

test("a ZIP job with a damaged entry fails with a clear error and leaves no folder", async (t) => {
  const list = ENTRIES.map((e, k) => (k === 3 ? { ...e, crc: 0x12345678 } : e));
  const { body } = makeZip(list);
  const { base } = await fileServer(t, { "/Pack.zip": { body } });
  const { m, downloads } = manager(t, tempDir(t));

  const { draft, dir } = await zipDraft(m, base);
  const failed = once(m, "failed");
  m.commit(chooseEntries(draft, dir, [1, 3]));
  const [d] = await failed;
  assert.equal(d.status, "error");
  assert.match(d.error, /data\.bin is damaged in the archive: its checksum does not match/);
  assert.deepEqual(fs.readdirSync(downloads), []);
});

test("a ZIP job pauses, comes back after a restart and finishes", async (t) => {
  const { body, entries } = makeZip(ENTRIES);
  const server = await fileServer(t, { "/Pack.zip": { body } });
  const root = tempDir(t);
  const first = manager(t, root);

  const { draft, dir } = await zipDraft(first.m, server.base);
  const asked = server.log.length;
  server.hold("/Pack.zip");
  const job = first.m.commit(chooseEntries(draft, dir, [3]));
  await server.asked("/Pack.zip", asked + 1);
  first.m.pause(job.id);
  server.release("/Pack.zip");
  await until(() => first.m.get(job.id).status === "paused", "the job paused");
  await first.m.shutdown();

  const again = manager(t, root);
  assert.equal(again.m.get(job.id).status, "paused");
  assert.equal(again.m.get(job.id).zip.entries[0].name, "nested/deeper/data.bin");
  const finished = once(again.m, "finished");
  again.m.resume(job.id);
  const [done] = await finished;
  assert.equal(done.filepath, path.join(again.downloads, "data.bin"), "one file goes straight into Downloads");
  assert.ok(fs.readFileSync(done.filepath).equals(entries[3].data));
});

test("readZip leaves a link as a plain download when it can't list the files", async (t) => {
  const { body } = makeZip(ENTRIES);
  const one = makeZip([{ name: "only.txt", data: "one file" }]).body;
  const ranged = await fileServer(t, { "/Pack.zip": { body }, "/fake.zip": { body: randomBytes(4000) }, "/One.zip": { body: one } });
  const plain = await fileServer(t, { "/Pack.zip": { body } }, { ranges: false });
  const { m } = manager(t, tempDir(t));

  assert.equal(await readZip(await m.draftFile({ url: `${plain.base}/Pack.zip` })), null, "no Range support");
  assert.equal(await readZip(await m.draftFile({ url: `${ranged.base}/fake.zip` })), null, "not a ZIP inside");
  assert.equal(await readZip(await m.draftFile({ url: `${ranged.base}/One.zip` })), null, "nothing to pick from");
  const named = await m.draftFile({ url: `${ranged.base}/Pack.zip?dl=1`, filename: "download" });
  assert.equal(await readZip(named), null, "no .zip name and no ZIP type");
  assert.ok(await readZip(named, "application/zip"), "the type Chrome reports is enough");
});
