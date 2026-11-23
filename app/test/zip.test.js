const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { directoryOf, planRuns, chooseEntries, entryParts, extract, zipView } = require("../src/main/zip");
const { makeZip, tempDir, randomBytes } = require("./helpers");

const reader = (body) => async (start, len) => body.subarray(start, start + len);
const dirOf = (body) => directoryOf(reader(body), body.length);

const ENTRIES = [
  { name: "stored.txt", data: "plain bytes" },
  { name: "docs/", data: "" },
  // A timestamp extra field that only the local header has, so its data starts later than the directory suggests.
  { name: "docs/deflated.txt", data: "squeeze me ".repeat(400), method: 8, localExtra: Buffer.from("555405000102030405", "hex") },
  { name: "docs/deep/after.bin", data: randomBytes(3000), method: 8, descriptor: true },
  { name: "naïve café.txt", data: "utf8", utf8: true },
  { name: "secret.txt", data: "hidden", encrypted: true },
  { name: "odd.bin", data: "lzma", method: 14 },
];

for (const zip64 of [false, true]) {
  test(`directoryOf lists every entry with its sizes, offset and flags${zip64 ? " from ZIP64 records" : ""}`, async () => {
    const { body, entries } = makeZip(ENTRIES, { zip64, comment: "made by a test" });
    const dir = await dirOf(body);
    assert.equal(dir.entries.length, ENTRIES.length);
    assert.equal(dir.cdOffset + dir.cdSize, zip64 ? body.length - 22 - 20 - 56 - "made by a test".length : body.length - 22 - "made by a test".length);
    dir.entries.forEach((e, k) => {
      assert.equal(e.index, k);
      assert.equal(e.name, ENTRIES[k].name);
      assert.equal(e.size, entries[k].data.length);
      assert.equal(e.offset, entries[k].offset);
    });
    const by = Object.fromEntries(dir.entries.map((e) => [e.name, e]));
    assert.equal(by["docs/"].dir, true);
    assert.equal(by["docs/deflated.txt"].method, 8);
    assert.ok(by["docs/deflated.txt"].csize < by["docs/deflated.txt"].size);
    assert.equal(by["docs/deep/after.bin"].supported, true, "a data descriptor does not stop an entry");
    assert.equal(by["secret.txt"].supported, false);
    assert.equal(by["odd.bin"].supported, false);
    assert.deepEqual(zipView(dir).find((f) => f.name === "secret.txt").why, "Encrypted");
    assert.equal(zipView(dir).some((f) => f.name === "docs/"), false, "folders are not listed as files");
  });
}

test("names without the UTF-8 flag are read as UTF-8 when valid, else as code page 437", async () => {
  const { body } = makeZip([
    { name: "x", nameBytes: Buffer.from("Ölmalerei.txt", "utf8") },
    { name: "y", nameBytes: Buffer.from([0x8e, 0x6c, 0x2e, 0x74, 0x78, 0x74]) }, // "Äl.txt" in CP437
  ]);
  const names = (await dirOf(body)).entries.map((e) => e.name);
  assert.deepEqual(names, ["Ölmalerei.txt", "Äl.txt"]);
});

test("directoryOf refuses files that are not a plain single ZIP", async () => {
  await assert.rejects(dirOf(randomBytes(5000)), /not a ZIP/);
  const { body } = makeZip([{ name: "a.txt", data: "a" }]);
  const split = Buffer.from(body);
  split.writeUInt16LE(1, body.length - 22 + 4);
  await assert.rejects(dirOf(split), /split over several files/);
  // A program glued in front of the archive shifts every offset.
  await assert.rejects(dirOf(Buffer.concat([randomBytes(100), body])), /damaged/);
  // One whose offsets were fixed up for the program is fine.
  assert.equal((await dirOf(makeZip([{ name: "a.txt", data: "a" }], { prefix: randomBytes(100) }).body)).entries[0].offset, 100);
  const cut = Buffer.from(body);
  cut.writeUInt32LE(0xdeadbeef, body.length - 22 - 46 - 5); // the central directory's signature
  await assert.rejects(dirOf(cut), /damaged/);
});

test("planRuns joins spans with small gaps and keeps big gaps out", () => {
  const MB = 1024 * 1024;
  const dir = {
    cdOffset: 10 * MB,
    entries: [0, 1 * MB, 1.5 * MB, 4 * MB, 9 * MB].map((offset, index) => ({ index, offset })),
  };
  const [a, b, c, d, e] = dir.entries;
  // a and c are 0.5 MB apart, so b between them is fetched too. e starts 5 MB after c ends.
  assert.deepEqual(planRuns(dir, [c, a, e]), [{ offset: 0, size: 4 * MB }, { offset: 9 * MB, size: 1 * MB }]);
  assert.deepEqual(planRuns(dir, [c, d]), [{ offset: 1.5 * MB, size: 7.5 * MB }], "spans that touch join");
  assert.deepEqual(planRuns(dir, [e]), [{ offset: 9 * MB, size: 1 * MB }], "the last entry ends where the directory starts");
  assert.deepEqual(planRuns(dir, [b, d]), [{ offset: 1 * MB, size: 0.5 * MB }, { offset: 4 * MB, size: 5 * MB }]);
});

test("chooseEntries keeps a whole-archive download unless a real subset is picked", async () => {
  const { body } = makeZip(ENTRIES.slice(0, 5));
  const dir = await dirOf(body);
  const draft = () => ({ filename: "Pack.zip", title: "Pack.zip", expected: body.length, streams: [{ role: "file", url: "http://x/Pack.zip", headers: {}, size: body.length, ranges: true }] });

  const whole = draft();
  assert.equal(chooseEntries(whole, dir, null), whole);
  assert.equal(chooseEntries(draft(), dir, [0, 2, 3, 4]).zip, undefined, "every file picked is the whole archive");

  const original = draft();
  const job = chooseEntries(original, dir, [3, 0]);
  assert.equal(original.streams.length, 1);
  assert.equal(original.zip, undefined, "the draft stays a whole-archive download");
  assert.equal(job.title, "2 files from Pack.zip");
  assert.deepEqual(job.zip.entries.map((e) => e.name), ["stored.txt", "docs/deep/after.bin"]);
  assert.equal(job.streams.length, 1, "small gaps join into one run");
  assert.equal(job.streams[0].offset, 0);
  assert.equal(job.expected, job.streams[0].size);
  assert.equal(chooseEntries(draft(), dir, [2]).title, "deflated.txt from Pack.zip");

  assert.throws(() => chooseEntries(draft(), dir, [1]), /not in the archive/, "a folder");
  assert.throws(() => chooseEntries(draft(), dir, [99]), /not in the archive/);
  assert.throws(() => chooseEntries(draft(), dir, ["0"]), /not in the archive/);
  assert.throws(() => chooseEntries(draft(), dir, []), /at least one/);
  const locked = await dirOf(makeZip(ENTRIES).body);
  assert.throws(() => chooseEntries(draft(), locked, [5]), /can't unpack secret\.txt/);
});

test("entryParts drops parent folders, drive letters and device names", () => {
  const clean = (s) => s.replace(/[<>:"|?*]/g, " ").trim();
  assert.deepEqual(entryParts("../evil.txt", clean), ["evil.txt"]);
  assert.deepEqual(entryParts("a/../../b\\..\\c.txt", clean), ["a", "b", "c.txt"]);
  assert.deepEqual(entryParts("/etc/./passwd", clean), ["etc", "passwd"]);
  assert.deepEqual(entryParts("C:\\Windows\\x.dll", clean), ["C", "Windows", "x.dll"]);
  assert.deepEqual(entryParts("dev/CON", clean), ["dev", "_CON"]);
  assert.deepEqual(entryParts("nul.txt", clean), ["_nul.txt"]);
  assert.deepEqual(entryParts("lpt9.tar.gz", clean), ["_lpt9.tar.gz"]);
  assert.deepEqual(entryParts("console.txt", clean), ["console.txt"]);
});

// A job whose one run is the whole archive, as if every byte had been downloaded.
function runJob(t, list, picks) {
  const { body } = makeZip(list);
  const work = tempDir(t);
  const run = path.join(work, "run.bin");
  fs.writeFileSync(run, body);
  return dirOf(body).then((dir) => {
    const entries = picks.map((i) => dir.entries[i]);
    return { work, job: { zip: { archive: "Pack.zip", entries }, streams: [{ offset: 0, size: body.length, path: run }] } };
  });
}

const place = (marked = []) => ({
  clean: (s) => s.replace(/[<>:"|?*]/g, " ").trim(),
  unique: (p) => {
    let q = p;
    for (let k = 2; fs.existsSync(q); k++) q = p.replace(/(\.[^.\\/]*)?$/, ` (${k})$1`);
    return q;
  },
  mark: (f) => marked.push(f),
});

test("extract unpacks stored, deflated and descriptor entries into a folder named after the archive", async (t) => {
  const { work, job } = await runJob(t, ENTRIES.slice(0, 5), [0, 2, 3, 4]);
  const out = path.join(work, "Downloads");
  fs.mkdirSync(out);
  fs.mkdirSync(path.join(out, "Pack")); // already taken
  const marked = [];
  const where = await extract(job, { dir: out, signal: new AbortController().signal, place: place(marked) });
  assert.equal(where, path.join(out, "Pack (2)"));
  for (const i of [0, 2, 3, 4]) {
    const e = ENTRIES[i];
    assert.ok(fs.readFileSync(path.join(where, ...e.name.split("/"))).equals(Buffer.from(e.data)), e.name);
  }
  assert.equal(marked.length, 4, "every file is marked, not the folder");
  assert.ok(!marked.includes(where));
});

test("extract puts one file straight into the folder under its own name", async (t) => {
  const { work, job } = await runJob(t, ENTRIES.slice(0, 5), [3]);
  const where = await extract(job, { dir: work, signal: new AbortController().signal, place: place() });
  assert.equal(where, path.join(work, "after.bin"));
  assert.ok(fs.readFileSync(where).equals(ENTRIES[3].data));
});

test("extract stops on a bad checksum or a file bigger than it says, and leaves nothing behind", async (t) => {
  for (const [bad, message] of [[{ crc: 1234 }, /checksum does not match/], [{ size: 10 }, /bigger than the archive says/], [{ size: 9999 }, /smaller than the archive says/]]) {
    const { work, job } = await runJob(t, [{ name: "good.txt", data: "fine" }, { name: "bad.txt", data: "not what it says on the tin", method: 8, ...bad }], [0, 1]);
    const out = path.join(work, "out");
    fs.mkdirSync(out);
    await assert.rejects(extract(job, { dir: out, signal: new AbortController().signal, place: place() }), message);
    assert.deepEqual(fs.readdirSync(out), [], "the half-made folder is removed");
  }
});
