#!/usr/bin/env node
// Drives a real Downy (Electron, run from source) for verification.
// Every run lives in <repo>/.verify/<run-id>/ with data/, downloads/ and evidence/.
// Cleanup deletes data/ and downloads/ and keeps evidence/.
//
//   node downy-verify.mjs launch [--fresh]     start Downy + the local file server, wait until usable
//   node downy-verify.mjs doctor               read-only health check of the current run
//   node downy-verify.mjs click <css> [--text "Button text"] [--target prompt]
//   node downy-verify.mjs type <css> <text> [--replace] [--target prompt]   --replace presses Ctrl+A first
//   node downy-verify.mjs key <Enter|Escape|Tab|ArrowLeft|...|Shift+ArrowRight> [--target prompt]
//   node downy-verify.mjs drag <css> <dx> [--dy n] [--steps n] [--shot name] [--target prompt]   --shot captures mid-drag
//   node downy-verify.mjs eval <js> [--target prompt]
//   node downy-verify.mjs wait <js> [--timeout ms] [--target prompt]
//   node downy-verify.mjs shot <name> [--target prompt]
//   node downy-verify.mjs state [--save name]  downloads as the window sees them (downy.state())
//   node downy-verify.mjs files [--save name]  files in downloads/ with sha256, checked against served.json
//   node downy-verify.mjs api <GET|POST> api/<name> [json]   call the local API like the Chrome extension does
//   node downy-verify.mjs serverlog [file-name]   requests the file server got, one per line
//   node downy-verify.mjs cleanup              quit Downy and the file server, delete data/ and downloads/
//
// The current run is the one named in <repo>/.verify/current, or DOWNY_VERIFY_RUN.

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..", "..");
const APP = path.join(REPO, "app");
const VERIFY = path.join(REPO, ".verify");
const CURRENT = path.join(VERIFY, "current");

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, v === undefined || v.startsWith("--") ? 1 : 2);
  return v === undefined || v.startsWith("--") ? true : v;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (msg) => {
  console.error(`FAIL ${msg}`);
  process.exit(1);
};

// ------------------------------------------------------------------ run state

function runDir() {
  const dir = process.env.DOWNY_VERIFY_RUN || (fs.existsSync(CURRENT) ? fs.readFileSync(CURRENT, "utf8").trim() : "");
  if (!dir || !fs.existsSync(path.join(dir, "run.json"))) die("no current run. Start one with: node downy-verify.mjs launch");
  return dir;
}
const readRun = (dir = runDir()) => ({ dir, ...JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8")) });
const writeRun = (dir, run) => fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify(run, null, 2));

function log(run, line) {
  const text = `${new Date().toISOString()} ${line}\n`;
  fs.appendFileSync(path.join(run.dir, "evidence", "actions.log"), text);
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function get(url, { headers = {}, method = "GET", body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers, timeout: 5000 }, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ------------------------------------------------------------------ CDP

async function target(run, kind = "main") {
  const res = await get(`http://127.0.0.1:${run.cdpPort}/json/list`);
  const pages = JSON.parse(res.body).filter((t) => t.type === "page");
  const want = kind === "prompt" ? "/renderer/prompt.html" : "/renderer/index.html";
  const t = pages.find((p) => p.url.endsWith(want));
  if (!t) throw new Error(`no ${kind} window. Open pages: ${pages.map((p) => p.url).join(", ") || "none"}`);
  return t;
}

async function cdp(run, kind = "main") {
  const t = await target(run, kind);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("could not open the DevTools socket"));
  });
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    const w = waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id);
    if (msg.error) w.reject(new Error(msg.error.message));
    else w.resolve(msg.result);
  };
  // A window that closes (quitting, or the confirm window after Enter) drops the socket.
  // Calls still waiting fail instead of hanging, which would let Node exit silently.
  ws.onclose = () => {
    for (const w of waiting.values()) w.reject(new Error("the window closed (DevTools socket dropped)"));
    waiting.clear();
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    waiting.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

async function withPage(run, kind, fn) {
  const c = await cdp(run, kind);
  try {
    return await fn(c);
  } finally {
    c.close();
  }
}

// Clicks the centre of the element with real mouse events, like a user.
// With text, the element is the first match of sel whose trimmed text equals it, for buttons
// that have no id or aria-label, such as "Clear from list".
async function click(run, sel, kind, text) {
  await withPage(run, kind, async (c) => {
    const box = await c.evaluate(`(() => {
      const text = ${JSON.stringify(text ?? null)};
      const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => text === null || e.textContent.trim() === text);
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      const hidden = r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden";
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, hidden, disabled: !!el.disabled };
    })()`);
    if (!box) throw new Error(`nothing matches ${sel}${text ? ` with text "${text}"` : ""}`);
    if (box.hidden) throw new Error(`${sel} is not visible`);
    if (box.disabled) throw new Error(`${sel} is disabled`);
    const at = { x: box.x, y: box.y, button: "left", clickCount: 1 };
    await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
    await c.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at });
    await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at });
  });
}

// Presses the left button on the centre of the element, moves the mouse by dx and dy in steps
// with real mouse events, and lets go, like a user dragging a handle. With mid, a screenshot named
// mid is taken while the button is still down, to catch what shows only during a drag.
async function drag(run, sel, kind, { dx, dy = 0, steps = 12, mid } = {}) {
  let file = null;
  await withPage(run, kind, async (c) => {
    const box = await c.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, hidden: r.width === 0 || r.height === 0 || getComputedStyle(el).visibility === "hidden" };
    })()`);
    if (!box) throw new Error(`nothing matches ${sel}`);
    if (box.hidden) throw new Error(`${sel} is not visible`);
    const pause = () => new Promise((r) => setTimeout(r, 16));
    await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y });
    await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", buttons: 1, clickCount: 1 });
    let at = { x: box.x, y: box.y };
    for (let i = 1; i <= steps; i++) {
      at = { x: box.x + (dx * i) / steps, y: box.y + (dy * i) / steps };
      await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at, button: "left", buttons: 1 });
      await pause();
    }
    if (mid) {
      await new Promise((r) => setTimeout(r, 300)); // storyboard frames load while the button is down
      const dir = path.join(run.dir, "evidence");
      const n = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).length + 1;
      file = path.join(dir, `${String(n).padStart(2, "0")}-${mid.replace(/[^\w.-]+/g, "_")}.png`);
      const r = await c.send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(file, Buffer.from(r.data, "base64"));
    }
    await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", buttons: 0, clickCount: 1 });
  });
  return file;
}

const KEYS = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  Home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
  End: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 },
};
const MODIFIERS = { Alt: 1, Ctrl: 2, Shift: 8 };

// name is a key from KEYS, optionally after modifiers, such as Shift+ArrowRight. The key goes to
// whatever has the focus, so focus the element first, for example by clicking it.
async function key(run, name, kind) {
  const parts = name.split("+");
  const k = KEYS[parts.pop()];
  if (!k || !parts.every((m) => MODIFIERS[m])) throw new Error(`unknown key ${name}. Known: ${Object.keys(KEYS).join(", ")}, after ${Object.keys(MODIFIERS).join("+, ")}+`);
  const modifiers = parts.reduce((n, m) => n | MODIFIERS[m], 0);
  await withPage(run, kind, async (c) => {
    await c.send("Input.dispatchKeyEvent", { type: "keyDown", ...k, modifiers });
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: k.key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode, modifiers });
  });
}

async function shot(run, name, kind) {
  const dir = path.join(run.dir, "evidence");
  const n = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).length + 1;
  const file = path.join(dir, `${String(n).padStart(2, "0")}-${name.replace(/[^\w.-]+/g, "_")}.png`);
  await withPage(run, kind, async (c) => {
    const r = await c.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(file, Buffer.from(r.data, "base64"));
  });
  return file;
}

// ------------------------------------------------------------------ file server

// Deterministic bytes, so served.json can name each file's sha256 before any download.
function bytesFor(name, size) {
  const out = Buffer.alloc(size);
  let off = 0;
  let block = 0;
  while (off < size) {
    const h = crypto.createHash("sha256").update(`${name}:${block++}`).digest();
    off += h.copy(out, off);
  }
  return out;
}

// A small ZIP archive for picking files out of it: deflated and stored entries in nested folders,
// all under one folder named like the archive, and a 4 MB entry that a pick of the others must
// never fetch. Built the same way every run, so served.json can name each entry's sha256.
const ZIP_ENTRIES = [
  ["Sample/readme.txt", Buffer.from("Hello from the sample archive.\n".repeat(60)), 8],
  ["Sample/docs/guide.md", Buffer.from("# Guide\n" + "A line of the guide.\n".repeat(300)), 8],
  ["Sample/docs/notes.txt", Buffer.from("notes\n".repeat(500)), 0],
  ["Sample/big.bin", null, 0],
  ["Sample/data.json", Buffer.from(JSON.stringify({ n: [...Array(1500).keys()] })), 8],
];

function zipOf(entries) {
  const locals = [];
  const central = [];
  let off = 0;
  for (const [name, data, method] of entries) {
    const n = Buffer.from(name);
    const packed = method === 8 ? zlib.deflateRawSync(data, { level: 9 }) : data;
    const crc = zlib.crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(method, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(n.length, 26);
    locals.push(head, n, packed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(method, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(packed.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(off, 42);
    central.push(c, n);
    off += 30 + n.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

const SERVED = {
  "/file/small.bin": { size: 3 * 1024 * 1024, ranges: true, note: "3 MB, Range support, full speed" },
  "/file/slow.bin": { size: 48 * 1024 * 1024, ranges: true, rate: 128 * 1024, note: "48 MB, Range support, 128 KB/s per connection (about 1 MB/s with 8 connections)" },
  "/file/norange.bin": { size: 2 * 1024 * 1024, ranges: false, note: "2 MB, ignores Range like a simple server" },
  // A link that answers with HTML, like a sign-in page. The name must not end in .html:
  // Downy downloads an .html link on purpose, since the user asked for that page.
  "/login": { body: "<!doctype html><title>Sign in</title><p>A web page, not a file.", type: "text/html", note: "a web page with no .html name, which Downy must refuse" },
  "/file/Sample.zip": { zip: true, ranges: true, type: "application/zip", note: "a ZIP of 5 files in Sample/ (one is 4 MB), Range support, for Choose files" },
  "/page.html": { body: "<!doctype html><title>Saved page</title><p>An .html file.", type: "text/html", note: "an .html link, which Downy downloads as a file" },
};

async function serve(dir) {
  const files = {};
  const manifest = [];
  for (const [p, f] of Object.entries(SERVED)) {
    const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
    let body;
    if (f.zip) {
      const entries = ZIP_ENTRIES.map(([name, data, method]) => [name, data || bytesFor(name, 4 * 1024 * 1024), method]);
      body = zipOf(entries);
      for (const [name, data] of entries) manifest.push({ path: `${p}!/${name}`, name: path.basename(name), size: data.length, sha256: sha(data), note: `entry of ${path.basename(p)}` });
    } else body = f.body ? Buffer.from(f.body) : bytesFor(p, f.size);
    files[p] = { ...f, body };
    manifest.push({ path: p, name: path.basename(p), size: body.length, sha256: sha(body), note: f.note });
  }
  const logFile = path.join(dir, "evidence", "server-log.jsonl");
  const server = http.createServer((req, res) => {
    const p = req.url.split("?")[0];
    const file = files[p];
    const entry = { at: new Date().toISOString(), method: req.method, path: p, range: req.headers.range || null, ua: req.headers["user-agent"] || null };
    const done = (status, extra = {}) => fs.appendFileSync(logFile, JSON.stringify({ ...entry, status, ...extra }) + "\n");
    if (!file) {
      res.writeHead(404);
      res.end();
      return done(404);
    }
    const headers = { "Content-Type": file.type || "application/octet-stream", "Accept-Ranges": file.ranges ? "bytes" : "none" };
    let start = 0;
    let end = file.body.length - 1;
    let status = 200;
    const m = file.ranges && /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
    if (m) {
      start = Number(m[1]);
      end = Math.min(m[2] ? Number(m[2]) : end, end);
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${file.body.length}`;
    }
    headers["Content-Length"] = end - start + 1;
    res.writeHead(status, headers);
    done(status, { bytes: end - start + 1 });
    if (req.method === "HEAD") return res.end();
    const slice = file.body.subarray(start, end + 1);
    if (!file.rate) return res.end(slice);
    // Throttled: 16 KB every (16 KB / rate) seconds, so a download stays running long enough to pause.
    const CHUNK = 16 * 1024;
    let off = 0;
    const timer = setInterval(() => {
      if (res.destroyed) return clearInterval(timer);
      res.write(slice.subarray(off, off + CHUNK));
      off += CHUNK;
      if (off >= slice.length) {
        clearInterval(timer);
        res.end();
      }
    }, (CHUNK / file.rate) * 1000);
    res.on("close", () => clearInterval(timer));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  fs.writeFileSync(path.join(dir, "evidence", "served.json"), JSON.stringify({ base: `http://127.0.0.1:${port}`, files: manifest }, null, 2));
  fs.writeFileSync(path.join(dir, "server.port"), String(port));
}

// ------------------------------------------------------------------ launch / doctor / cleanup

async function launch() {
  const fresh = !!flag("--fresh");
  const id = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  const dir = path.join(VERIFY, `run-${id}`);
  for (const sub of ["data", "downloads", "evidence"]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
  fs.writeFileSync(CURRENT, dir);
  const data = path.join(dir, "data");
  const downloads = path.join(dir, "downloads");

  // Seed: skip the welcome screen and point downloads into this run. --fresh leaves the
  // data folder empty so the welcome flow can be driven, and sets nothing.
  if (!fresh) {
    fs.writeFileSync(path.join(data, "settings.json"), JSON.stringify({
      downloadDir: downloads, onboarded: true, extensionSetup: true,
      notify: false, // no Windows toasts on the user's desktop
      closeToTray: false, // closing the window quits, so cleanup can quit gracefully
    }, null, 2));
  }

  // The file server outlives this command, so it runs as its own detached process.
  const srv = spawn(process.execPath, [fileURLToPath(import.meta.url), "__serve", dir], { detached: true, stdio: "ignore", windowsHide: true });
  srv.unref();
  for (let i = 0; i < 100 && !fs.existsSync(path.join(dir, "server.port")); i++) await sleep(100);
  if (!fs.existsSync(path.join(dir, "server.port"))) die("the file server did not start");
  const serverPort = Number(fs.readFileSync(path.join(dir, "server.port"), "utf8"));

  const apiPort = await freePort();
  const cdpPort = await freePort();
  const electron = createRequire(path.join(APP, "package.json"))("electron");
  const out = fs.openSync(path.join(dir, "evidence", "app.log"), "a");
  const env = { ...process.env, DOWNY_USER_DATA: data, DOWNY_PORT: String(apiPort) };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [".", `--remote-debugging-port=${cdpPort}`], { cwd: APP, env, detached: true, stdio: ["ignore", out, out] });
  child.unref();

  const run = { id, fresh, pid: child.pid, serverPid: srv.pid, apiPort, cdpPort, serverPort, data, downloads, started: new Date().toISOString() };
  writeRun(dir, run);
  const r = { dir, ...run };
  log(r, `launch pid=${child.pid} api=${apiPort} cdp=${cdpPort} files=http://127.0.0.1:${serverPort}${fresh ? " fresh" : ""}`);

  // Ready means usable: the window ran init() (downy.state() answers and the tabs exist)
  // and the local API answers. A DevTools port alone is not enough.
  const deadline = Date.now() + 60000;
  let last = "";
  while (Date.now() < deadline) {
    if (!alive(child.pid)) die(`Downy exited during start. See ${path.join(dir, "evidence", "app.log")}`);
    try {
      const ok = await withPage(r, "main", (c) => c.evaluate(`(async () => {
        if (!window.downy || document.querySelectorAll("#tabs .tab").length !== 3) return false;
        const s = await downy.state();
        return s.ok;
      })()`));
      const api = await get(`http://127.0.0.1:${apiPort}/`);
      if (ok && api.status === 200 && api.body.includes("Downy is running")) {
        console.log(`READY run=${dir}`);
        console.log(`  pid ${child.pid}, API http://127.0.0.1:${apiPort}, DevTools ${cdpPort}, files http://127.0.0.1:${serverPort}`);
        console.log(`  evidence ${path.join(dir, "evidence")}`);
        return;
      }
      last = `window ready=${ok}, API status=${api.status}`;
    } catch (e) {
      last = e.message;
    }
    await sleep(500);
  }
  die(`Downy did not become usable in 60 s (${last}). Run cleanup.`);
}

async function doctor() {
  const run = readRun();
  let bad = 0;
  const check = (ok, what, detail = "") => {
    if (!ok) bad++;
    console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? `: ${detail}` : ""}`);
  };
  check(alive(run.pid), "Downy process is running", `pid ${run.pid}`);
  check(alive(run.serverPid), "file server process is running", `pid ${run.serverPid}`);
  check(run.apiPort !== 9614, "API port is not the installed Downy's 9614", String(run.apiPort));
  try {
    const t = await target(run, "main");
    const want = pathToFileURL(path.join(APP, "src", "renderer", "index.html")).href.toLowerCase();
    check(decodeURIComponent(t.url).toLowerCase() === decodeURIComponent(want), "window runs this checkout's renderer", t.url);
    const s = await withPage(run, "main", (c) => c.evaluate(`downy.state().then((r) => r.ok && { dir: r.data.settings.downloadDir, onboarded: r.data.settings.onboarded, n: r.data.downloads.length, tools: r.data.tools, version: document.getElementById("appVersion")?.textContent || "" })`));
    check(!!s, "window answers downy.state()");
    if (s) {
      check(path.resolve(s.dir) === path.resolve(run.downloads) || run.fresh, "download folder is this run's downloads folder", s.dir);
      const pkg = JSON.parse(fs.readFileSync(path.join(APP, "package.json"), "utf8"));
      check(!s.version || s.version.includes(pkg.version), "app version matches app/package.json", `${s.version || "(not shown yet)"} vs ${pkg.version}`);
      console.log(`info ${s.n} downloads in the list, tools: yt-dlp=${!!s.tools?.ytdlp} ffmpeg=${!!s.tools?.ffmpeg} js=${!!s.tools?.jsRuntime}`);
    }
  } catch (e) {
    check(false, "DevTools reaches the Downy window", e.message);
  }
  try {
    const api = await get(`http://127.0.0.1:${run.apiPort}/`);
    check(api.status === 200 && api.body.includes("Downy is running"), "local API answers on our port", String(api.status));
  } catch (e) {
    check(false, "local API answers on our port", e.message);
  }
  try {
    const f = await get(`http://127.0.0.1:${run.serverPort}/file/small.bin`, { method: "HEAD" });
    check(f.status === 200, "file server answers", String(f.status));
  } catch (e) {
    check(false, "file server answers", e.message);
  }
  console.log(bad ? `DOCTOR FAIL (${bad})` : "DOCTOR OK");
  process.exit(bad ? 1 : 0);
}

async function cleanup() {
  const run = readRun();
  const steps = [];
  if (alive(run.pid)) {
    // Graceful first: with closeToTray off, closing the window quits through before-quit,
    // which saves running downloads as paused.
    try {
      await withPage(run, "main", (c) => c.evaluate(`downy.setSettings({ closeToTray: false }).then(() => downy.windowAction("close"))`));
      steps.push("asked the window to close");
    } catch (e) {
      // Closing usually drops the socket before the answer arrives, which is success here.
      steps.push(/socket dropped/.test(e.message) ? "asked the window to close" : `could not close the window: ${e.message}`);
    }
    for (let i = 0; i < 40 && alive(run.pid); i++) await sleep(250);
  }
  if (alive(run.pid)) {
    // Only the process tree this run started, by PID. Never by image name: the user's own Downy may be running.
    try {
      execFileSync("taskkill", ["/PID", String(run.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {}
    steps.push(`force-killed pid ${run.pid} and its children`);
  } else steps.push(`Downy pid ${run.pid} exited`);
  if (alive(run.serverPid)) {
    try {
      process.kill(run.serverPid);
    } catch {}
    steps.push(`stopped file server pid ${run.serverPid}`);
  }
  for (let i = 0; i < 20 && (alive(run.pid) || alive(run.serverPid)); i++) await sleep(250);
  // Electron's child processes can hold files in data/ for a moment after the main one exits.
  for (const sub of ["data", "downloads"]) {
    const p = path.join(run.dir, sub);
    for (let i = 0; i < 10; i++) {
      try {
        fs.rmSync(p, { recursive: true, force: true });
        break;
      } catch {
        await sleep(500);
      }
    }
    steps.push(fs.existsSync(p) ? `could NOT delete ${p}` : `deleted ${sub}/`);
  }
  fs.rmSync(path.join(run.dir, "server.port"), { force: true });
  let portFree = true;
  try {
    await get(`http://127.0.0.1:${run.apiPort}/`);
    portFree = false;
  } catch {}
  steps.push(portFree ? `port ${run.apiPort} is free` : `port ${run.apiPort} still answers`);
  run.cleaned = new Date().toISOString();
  const { dir, ...rest } = run;
  writeRun(dir, rest);
  log(run, `cleanup: ${steps.join("; ")}`);
  if (fs.existsSync(CURRENT) && fs.readFileSync(CURRENT, "utf8").trim() === dir) fs.rmSync(CURRENT);
  for (const s of steps) console.log(s);
  console.log(`evidence kept in ${path.join(dir, "evidence")}`);
  if (alive(run.pid) || !portFree) process.exit(1);
}

// ------------------------------------------------------------------ observation

async function state(save) {
  const run = readRun();
  const rows = await withPage(run, "main", (c) => c.evaluate(`downy.state().then((r) => r.data.downloads.map((d) => ({
    id: d.id, title: d.title, status: d.status, downloaded: d.downloaded, expected: d.expected,
    folder: d.folder, filepath: d.filepath, error: d.error, segments: (d.segments || []).length,
  })))`));
  if (save) fs.writeFileSync(path.join(run.dir, "evidence", `state-${save}.json`), JSON.stringify(rows, null, 2));
  return rows;
}

function files(save) {
  const run = readRun();
  const served = JSON.parse(fs.readFileSync(path.join(run.dir, "evidence", "served.json"), "utf8")).files;
  const out = [];
  const walk = (d) => {
    for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else {
        const body = fs.readFileSync(full);
        const sha256 = crypto.createHash("sha256").update(body).digest("hex");
        const match = served.find((s) => s.sha256 === sha256);
        out.push({ path: path.relative(run.downloads, full), size: body.length, sha256, matches: match ? match.path : null });
      }
    }
  };
  walk(run.downloads);
  if (save) fs.writeFileSync(path.join(run.dir, "evidence", `files-${save}.json`), JSON.stringify(out, null, 2));
  return out;
}

async function api(method, given, json) {
  const run = readRun();
  // Written as api/file or /api/file. Git Bash may have turned /api/file into C:/Program Files/Git/api/file.
  const m = String(given).replace(/\\/g, "/").match(/(?:^|\/)(api\/.*)$/);
  if (!m) throw new Error(`${given} is not an api/... path`);
  const p = `/${m[1]}`;
  const token = fs.readFileSync(path.join(run.data, "api-token"), "utf8").trim();
  // The Origin the Chrome extension sends. Any chrome-extension:// id passes; the token is the real check.
  const headers = { "X-Downy-Token": token, Origin: "chrome-extension://downyverify", "Content-Type": "application/json" };
  const r = await get(`http://127.0.0.1:${run.apiPort}${p}`, { method, headers, body: json });
  log(run, `api ${method} ${p} ${json || ""} -> ${r.status}`);
  return r;
}

// ------------------------------------------------------------------ main

async function main() {
  const kind = flag("--target") || "main";
  switch (cmd) {
    case "launch": return launch();
    case "__serve": return serve(argv[1]);
    case "doctor": return doctor();
    case "cleanup": return cleanup();
    case "click": {
      const run = readRun();
      const text = flag("--text");
      await click(run, argv[1], kind, typeof text === "string" ? text : undefined);
      log(run, `click ${kind} ${argv[1]}${typeof text === "string" ? ` "${text}"` : ""}`);
      return console.log(`clicked ${argv[1]}`);
    }
    case "type": {
      const run = readRun();
      const replace = !!flag("--replace");
      await click(run, argv[1], kind);
      await withPage(run, kind, async (c) => {
        if (replace) {
          // Ctrl+A, as a user selects the old text before typing over it.
          const a = { key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 };
          await c.send("Input.dispatchKeyEvent", { type: "keyDown", ...a, commands: ["selectAll"] });
          await c.send("Input.dispatchKeyEvent", { type: "keyUp", ...a });
        }
        await c.send("Input.insertText", { text: argv[2] });
      });
      log(run, `type${replace ? " --replace" : ""} ${kind} ${argv[1]} ${JSON.stringify(argv[2])}`);
      return console.log(`typed into ${argv[1]}`);
    }
    case "drag": {
      const run = readRun();
      const dy = Number(flag("--dy") || 0);
      const steps = Number(flag("--steps") || 12);
      const mid = flag("--shot");
      const dx = Number(argv[2]);
      if (!argv[1] || !Number.isFinite(dx)) throw new Error("usage: drag <css> <dx> [--dy n] [--steps n] [--shot name]");
      const file = await drag(run, argv[1], kind, { dx, dy, steps, mid: typeof mid === "string" ? mid : undefined });
      log(run, `drag ${kind} ${argv[1]} by ${dx},${dy}${file ? ` shot ${file}` : ""}`);
      return console.log(`dragged ${argv[1]} by ${dx},${dy}${file ? `\n${file}` : ""}`);
    }
    case "key": {
      const run = readRun();
      await key(run, argv[1], kind);
      log(run, `key ${kind} ${argv[1]}`);
      return console.log(`pressed ${argv[1]}`);
    }
    case "eval": {
      const run = readRun();
      const v = await withPage(run, kind, (c) => c.evaluate(argv[1]));
      return console.log(JSON.stringify(v, null, 2));
    }
    case "wait": {
      const run = readRun();
      const timeout = Number(flag("--timeout") || 30000);
      const deadline = Date.now() + timeout;
      let v;
      while (Date.now() < deadline) {
        try {
          v = await withPage(run, kind, (c) => c.evaluate(argv[1]));
          if (v) {
            log(run, `wait ok ${argv[1]}`);
            return console.log(JSON.stringify(v, null, 2));
          }
        } catch (e) {
          v = e.message;
        }
        await sleep(300);
      }
      log(run, `wait TIMEOUT ${argv[1]}`);
      return die(`timed out after ${timeout} ms waiting for ${argv[1]} (last: ${JSON.stringify(v)})`);
    }
    case "shot": {
      const run = readRun();
      const file = await shot(run, argv[1] || "screen", kind);
      log(run, `shot ${file}`);
      return console.log(file);
    }
    case "state": {
      const save = flag("--save");
      return console.log(JSON.stringify(await state(save), null, 2));
    }
    case "files": {
      const save = flag("--save");
      return console.log(JSON.stringify(files(save), null, 2));
    }
    case "api": {
      const r = await api(argv[1].toUpperCase(), argv[2], argv[3]);
      return console.log(`${r.status} ${r.body}`);
    }
    case "serverlog": {
      const run = readRun();
      const f = path.join(run.dir, "evidence", "server-log.jsonl");
      const rows = fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
      // One request per line: time method path range status bytes.
      // Matched by file name: Git Bash rewrites an argument like /file/slow.bin into a Windows path.
      const name = argv[1] && path.basename(argv[1].replace(/\\/g, "/"));
      for (const r of name ? rows.filter((x) => path.posix.basename(x.path) === name) : rows) console.log(`${r.at} ${r.method} ${r.path} ${r.range || "-"} ${r.status} ${r.bytes ?? "-"}`);
      return;
    }
    default:
      {
        const lines = fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split(/\r?\n/).slice(1);
        console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
      }
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => die(e.message));
