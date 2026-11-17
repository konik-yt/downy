const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { pathToFileURL } = require("url");
const { fromApp, lockDown } = require("../src/main/guard");

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
