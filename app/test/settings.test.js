const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Settings } = require("../src/main/settings");

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "downy-settings-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("a first start uses the defaults and still needs the welcome screen", (t) => {
  const s = new Settings(tempDir(t));
  const v = s.get();
  assert.equal(v.onboarded, false);
  assert.equal(v.connections, 8);
  assert.equal(v.maxActive, 3);
  assert.ok(path.isAbsolute(v.downloadDir));
});

test("settings from a version without the welcome screen count as onboarded", (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ connections: 4 }));
  const v = new Settings(dir).get();
  assert.equal(v.onboarded, true);
  assert.equal(v.connections, 4);
});

test("a blank saved download folder falls back to the default", (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ downloadDir: "   ", onboarded: true }));
  assert.ok(path.isAbsolute(new Settings(dir).get().downloadDir));
});

test("a broken settings file falls back to the defaults", (t) => {
  const dir = tempDir(t);
  fs.writeFileSync(path.join(dir, "settings.json"), "{ not json");
  assert.equal(new Settings(dir).get().connections, 8);
});

test("set clamps numbers, coerces booleans and drops unknown keys", (t) => {
  const dir = tempDir(t);
  const s = new Settings(dir);
  const next = s.set({ connections: 100, maxActive: "0", notify: 0, closeToTray: "yes", evil: "x", __proto__: { polluted: true } });
  assert.equal(next.connections, 32);
  assert.equal(next.maxActive, 1);
  assert.equal(next.notify, false);
  assert.equal(next.closeToTray, true);
  assert.equal("evil" in next, false);
  assert.equal({}.polluted, undefined);
  assert.equal(s.set({ connections: 4.6 }).connections, 5);
  assert.equal(s.set({ connections: "lots" }).connections, 5);
});

test("set ignores a blank or non-string folder and trims a real one", (t) => {
  const dir = tempDir(t);
  const s = new Settings(dir);
  const before = s.get().downloadDir;
  assert.equal(s.set({ downloadDir: "  " }).downloadDir, before);
  assert.equal(s.set({ downloadDir: 5 }).downloadDir, before);
  assert.equal(s.set({ downloadDir: "  D:\\Videos  " }).downloadDir, "D:\\Videos");
});

test("set saves to disk and tells listeners", (t) => {
  const dir = tempDir(t);
  const s = new Settings(dir);
  let seen = null;
  s.on("change", (v) => (seen = v));
  s.set({ maxActive: 5 });
  assert.equal(seen.maxActive, 5);
  assert.equal(new Settings(dir).get().maxActive, 5);
});
