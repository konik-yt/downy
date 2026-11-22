// Checks that the pieces of Downy that only meet at run time still fit together:
// the extension's manifest and files, the port both sides use, the version the
// release writes into both, the pages' scripts, and the IPC channel names.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const APP = path.join(__dirname, "..");
const EXTENSION = path.join(APP, "..", "extension");
const MAIN = path.join(APP, "src", "main");
const RENDERER = path.join(APP, "src", "renderer");

const read = (...parts) => fs.readFileSync(path.join(...parts), "utf8");
const manifest = JSON.parse(read(EXTENSION, "manifest.json"));
const pkg = JSON.parse(read(APP, "package.json"));
const all = (re, text) => [...text.matchAll(re)].map((m) => m[1]);

test("the extension and the app have the same version", () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
});

test("every file the extension manifest names exists", () => {
  const files = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap((c) => c.js),
  ];
  for (const file of files) assert.ok(fs.existsSync(path.join(EXTENSION, file)), file);
  // overlay.js sets up the button that content.js and video.js use, so it loads first.
  for (const c of manifest.content_scripts) assert.equal(c.js[0], "overlay.js");
});

test("the extension talks to the port the app listens on", () => {
  const port = Number(/testVar\("DOWNY_PORT"\) \|\| (\d+)/.exec(read(MAIN, "server.js"))[1]);
  assert.equal(/const BASE = "http:\/\/127\.0\.0\.1:(\d+)"/.exec(read(EXTENSION, "background.js"))?.[1], String(port));
  assert.ok(manifest.host_permissions.includes(`http://127.0.0.1:${port}/*`));
});

test("pages load only local scripts and styles that exist", () => {
  const pages = [[RENDERER, "index.html"], [RENDERER, "prompt.html"], [EXTENSION, "popup.html"]];
  for (const [dir, name] of pages) {
    const html = read(dir, name);
    // The Content-Security-Policy allows no inline script.
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, `${name} has an inline script`);
    for (const ref of [...all(/<script[^>]*\bsrc="([^"]+)"/gi, html), ...all(/<link[^>]*\bhref="([^"]+)"/gi, html)]) {
      assert.doesNotMatch(ref, /^[a-z]+:|^\/\//i, `${name} loads ${ref} from outside`);
      assert.ok(fs.existsSync(path.join(dir, ref)), `${name} loads ${ref}, which is missing`);
    }
  }
});

test("every call in preload.js has a handler in the main process", () => {
  const preload = read(MAIN, "preload.js");
  const main = read(MAIN, "main.js") + read(MAIN, "prompt.js");
  const handled = new Set(all(/\bhandle\("([^"]+)"/g, main));
  const listened = new Set(all(/\blisten\("([^"]+)"/g, main));
  const sent = new Set(all(/webContents\.send\("([^"]+)"/g, main));

  const invoked = all(/\bcall\("([^"]+)"\)/g, preload);
  assert.ok(invoked.length > 20);
  for (const name of invoked) assert.ok(handled.has(name), `no handler for "${name}"`);
  for (const name of all(/ipcRenderer\.send\("([^"]+)"/g, preload)) assert.ok(listened.has(name), `no listener for "${name}"`);
  for (const name of all(/\bon\("([^"]+)"\)/g, preload)) assert.ok(sent.has(name), `main never sends "${name}"`);
});

test("the installer build takes its icon and extension from files that exist", () => {
  assert.ok(fs.existsSync(path.join(APP, pkg.build.win.icon)));
  assert.ok(fs.existsSync(path.join(APP, pkg.main)));
  for (const r of pkg.build.extraResources) assert.ok(fs.existsSync(path.join(APP, r.from)), r.from);
});
