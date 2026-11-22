const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { pathToFileURL } = require("url");
const { fromApp, lockDown, handle, listen } = require("../src/main/guard");

const RENDERER = path.join(__dirname, "..", "src", "renderer");
const page = (...parts) => pathToFileURL(path.join(...parts)).href;

// An IPC event as Electron gives it, from the top frame unless sub is set.
function event(url, { sub = false } = {}) {
  const mainFrame = { url };
  return { sender: { mainFrame }, senderFrame: sub ? { url } : mainFrame };
}

test("fromApp accepts the top frame of Downy's own pages", () => {
  assert.equal(fromApp(event(page(RENDERER, "index.html"))), true);
  assert.equal(fromApp(event(page(RENDERER, "prompt.html") + "?id=1")), true);
});

test("fromApp refuses other pages, frames and schemes", () => {
  assert.equal(fromApp(event(page(RENDERER, "index.html"), { sub: true })), false);
  assert.equal(fromApp(event(page(RENDERER, "..", "main", "main.js"))), false);
  assert.equal(fromApp(event(pathToFileURL(RENDERER).href + "/%2e%2e/main/main.js")), false);
  assert.equal(fromApp(event(page(RENDERER + "-evil", "index.html"))), false);
  assert.equal(fromApp(event(pathToFileURL(RENDERER).href)), false);
  assert.equal(fromApp(event("https://example.com/index.html")), false);
  assert.equal(fromApp(event("not a url")), false);
  assert.equal(fromApp({ sender: { mainFrame: null }, senderFrame: null }), false);
});

test("lockDown blocks navigation, webviews and new windows", () => {
  const handlers = {};
  let openHandler = null;
  lockDown({
    on: (name, fn) => (handlers[name] = fn),
    setWindowOpenHandler: (fn) => (openHandler = fn),
  });
  for (const name of ["will-navigate", "will-attach-webview"]) {
    let prevented = false;
    handlers[name]({ preventDefault: () => (prevented = true) });
    assert.equal(prevented, true, name);
  }
  assert.deepEqual(openHandler({ url: "https://example.com" }), { action: "deny" });
});

// Registers through a stand-in for Electron's ipcMain and returns what was registered.
function registered(register) {
  const electron = require.resolve("electron");
  const saved = require.cache[electron];
  const handlers = {};
  const ipcMain = { handle: (name, fn) => (handlers[name] = fn), on: (name, fn) => (handlers[name] = fn) };
  require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { ipcMain } };
  try {
    register();
  } finally {
    if (saved) require.cache[electron] = saved;
    else delete require.cache[electron];
  }
  return handlers;
}

test("handle answers Downy's pages and refuses everyone else without running the handler", async () => {
  let runs = 0;
  const { echo } = registered(() => handle("echo", (e, x) => (runs++, x)));
  assert.deepEqual(await echo(event(page(RENDERER, "index.html")), 7), { ok: true, data: 7 });
  assert.equal((await echo(event("https://example.com/"), 7)).ok, false);
  assert.equal((await echo(event(page(RENDERER, "index.html"), { sub: true }), 7)).ok, false);
  assert.equal(runs, 1);
  const { boom } = registered(() => handle("boom", () => { throw new Error("nope"); }));
  assert.deepEqual(await boom(event(page(RENDERER, "index.html"))), { ok: false, error: "nope" });
});

test("listen drops messages from other pages", () => {
  const got = [];
  const { size } = registered(() => listen("size", (e, h) => got.push(h)));
  size(event("https://example.com/"), 1);
  size(event(page(RENDERER, "prompt.html")), 2);
  assert.deepEqual(got, [2]);
});
