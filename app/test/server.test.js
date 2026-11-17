const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const net = require("net");

const TOKEN = "t".repeat(32);
const EXT = "chrome-extension://abcdefghijklmnop";

// server.js reads its port once when loaded, so a free one goes into the environment first.
async function freePort() {
  const s = net.createServer();
  await new Promise((resolve) => s.listen(0, "127.0.0.1", resolve));
  const { port } = s.address();
  await new Promise((resolve) => s.close(resolve));
  return port;
}

// http.request, because fetch does not let a test set Host or leave out Origin.
function request(port, { method = "GET", path = "/", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    // A fresh socket each time, since every test closes its server.
    const req = http.request({ host: "127.0.0.1", port, method, path, agent: false, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

let server;
test.before(async () => {
  process.env.DOWNY_PORT = String(await freePort());
  server = require("../src/main/server");
});

async function start(t, overrides = {}) {
  const { startServer, PORT } = server;
  const calls = [];
  const record = (name) => (...args) => {
    calls.push([name, ...args]);
  };
  const values = { confirm: false, showOnStart: true, downloadDir: "D:\\Downy", ...overrides.settings };
  const deps = {
    token: TOKEN,
    extensionVersion: "2.2.1",
    settings: { get: () => values },
    tools: { status: () => ({ ytdlp: "C:\\yt-dlp.exe", ffmpeg: null, jsRuntime: "C:\\node.exe" }) },
    cache: {
      get: async (url, opts) => {
        calls.push(["cache.get", url, opts]);
        return { info: { title: "Clip", formats: [{ format_id: "18", height: 360, vcodec: "avc1", acodec: "mp4a", ext: "mp4", url: "https://secret/stream" }] } };
      },
    },
    manager: {
      list: () => [{ id: "a" }],
      add: async (url, option) => (calls.push(["manager.add", url, option]), { id: "new" }),
      addFile: async (spec) => (calls.push(["manager.addFile", spec]), { id: "file" }),
      pause: record("manager.pause"),
      resume: record("manager.resume"),
      cancel: record("manager.cancel"),
      remove: record("manager.remove"),
      clearFinished: record("manager.clearFinished"),
    },
    prompts: {
      openVideo: async (url, option) => (calls.push(["prompts.openVideo", url, option]), { id: "p1" }),
      openFile: async (spec) => (calls.push(["prompts.openFile", spec]), { id: "p2" }),
      status: (id) => ({ id, state: "open" }),
    },
    actions: { show: record("show"), reveal: record("reveal"), extensionSeen: record("extensionSeen") },
  };
  const running = await startServer(deps);
  t.after(() => new Promise((resolve) => {
    running.closeAllConnections();
    running.close(resolve);
  }));
  const ext = (path, { method = "GET", body, token = TOKEN } = {}) => request(PORT, {
    method, path, body, headers: { Origin: EXT, "X-Downy-Token": token, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
  });
  return { port: PORT, calls, values, ext };
}

test("the status page answers plain GETs and does nothing else", async (t) => {
  const { port, calls } = await start(t);
  const res = await request(port, { path: "/" });
  assert.equal(res.status, 200);
  assert.match(res.text, /Downy is running/);
  assert.deepEqual(calls, []);
});

test("requests with another Host are refused, which blocks DNS rebinding", async (t) => {
  const { port } = await start(t);
  for (const host of ["evil.example", `evil.example:${port}`, "127.0.0.1"]) {
    assert.equal((await request(port, { headers: { Host: host } })).status, 403, host);
  }
  assert.equal((await request(port, { headers: { Host: `localhost:${port}` } })).status, 200);
});

test("websites cannot call the API", async (t) => {
  const { port, calls } = await start(t);
  const evil = { Origin: "https://evil.example", "X-Downy-Token": TOKEN };
  assert.equal((await request(port, { path: "/api/status", headers: evil })).status, 403);
  assert.equal((await request(port, { method: "POST", path: "/api/download", headers: evil, body: { url: "https://x.com" } })).status, 403);
  // A form post or sendBeacon without an Origin is still not a GET.
  assert.equal((await request(port, { method: "POST", path: "/api/download", body: { url: "https://x.com" } })).status, 403);
  // An <img> GET has no Origin, but the API also needs the token.
  assert.equal((await request(port, { path: "/api/downloads" })).status, 401);
  assert.deepEqual(calls, []);
});

test("an extension without the right token gets 401 and the version it sent", async (t) => {
  const { port, calls } = await start(t);
  const res = await request(port, { path: "/api/status?ext=2.1.0", headers: { Origin: EXT, "X-Downy-Token": "wrong" } });
  assert.equal(res.status, 401);
  assert.match(res.json.error, /chrome:\/\/extensions/);
  await request(port, { path: "/api/status?ext=2.2.1", headers: { Origin: EXT } });
  await request(port, { path: "/api/status?ext=<b>hi</b>", headers: { Origin: EXT } });
  // An older version means a stale copy; the current one or junk text means no version.
  assert.deepEqual(calls, [["extensionSeen", "2.1.0"], ["extensionSeen", null], ["extensionSeen", null]]);
});

test("the extension can read status and downloads", async (t) => {
  const { ext, calls } = await start(t);
  const res = await ext("/api/status?ext=2.2.1");
  assert.equal(res.status, 200);
  assert.equal(res.headers["access-control-allow-origin"], EXT);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.deepEqual(res.json, { ok: true, version: 2, app: true, downloadDir: "D:\\Downy", ytdlp: true, ffmpeg: false, jsRuntime: true });
  assert.deepEqual((await ext("/api/downloads")).json, { downloads: [{ id: "a" }] });
  assert.deepEqual(calls[0], ["extensionSeen", "2.2.1"]);
  assert.equal((await ext("/api/nothing")).status, 404);
});

test("formats come back without stream links", async (t) => {
  const { ext, calls } = await start(t);
  const res = await ext("/api/formats", { method: "POST", body: { url: "https://vimeo.com/1", cookies: [{ name: "a", value: "b", domain: "vimeo.com" }] } });
  assert.equal(res.status, 200);
  assert.equal(res.json.title, "Clip");
  assert.deepEqual(res.json.options.map((o) => o.id), ["v360"]);
  assert.doesNotMatch(res.text, /secret/);
  assert.equal(calls.find((c) => c[0] === "cache.get")[2].cookies.length, 1);
});

test("only http and https pages are read or downloaded", async (t) => {
  const { ext, calls } = await start(t);
  for (const path of ["/api/formats", "/api/download"]) {
    const res = await ext(path, { method: "POST", body: { url: "file:///C:/Windows/win.ini" } });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /http and https/);
  }
  assert.equal(calls.filter((c) => c[0] !== "extensionSeen").length, 0);
});

test("a download starts at once, or opens the confirm window when asked to", async (t) => {
  const { ext, calls, values } = await start(t);
  let res = await ext("/api/download", { method: "POST", body: { url: "https://youtu.be/x", option: "v360" } });
  assert.deepEqual(res.json, { id: "new" });
  assert.ok(calls.some((c) => c[0] === "manager.add" && c[1] === "https://youtu.be/x" && c[2] === "v360"));
  assert.ok(calls.some((c) => c[0] === "show" && c[1] === "new"));

  values.confirm = true;
  res = await ext("/api/download", { method: "POST", body: { url: "https://youtu.be/x", option: "m4a" } });
  assert.deepEqual(res.json, { prompt: "p1" });
  res = await ext("/api/file", { method: "POST", body: { url: "https://x.com/a.zip", filename: 42, cookies: "sid=1" } });
  assert.deepEqual(res.json, { prompt: "p2" });
  const spec = calls.find((c) => c[0] === "prompts.openFile")[1];
  assert.deepEqual(spec, { url: "https://x.com/a.zip", filename: "42", referrer: "", cookies: "sid=1", userAgent: "", mime: "" });
  // A field that cannot become text is an error answer, not a crash.
  res = await ext("/api/file", { method: "POST", body: { url: "https://x.com/a.zip", filename: { toString: null } } });
  assert.equal(res.status, 400);
  assert.deepEqual((await ext("/api/prompt", { method: "POST", body: { id: "p2" } })).json, { id: "p2", state: "open" });
});

test("control calls reach the manager with a string id", async (t) => {
  const { ext, calls } = await start(t);
  for (const [path, name] of [["/api/pause", "manager.pause"], ["/api/resume", "manager.resume"], ["/api/cancel", "manager.cancel"], ["/api/remove", "manager.remove"]]) {
    const res = await ext(path, { method: "POST", body: { id: 7 } });
    assert.deepEqual(res.json, { ok: true });
    assert.deepEqual(calls.at(-1), [name, "7"]);
  }
  await ext("/api/open", { method: "POST", body: { id: "a", select: false } });
  assert.deepEqual(calls.at(-1), ["reveal", "a", false]);
});

test("a body over 1 MB is refused and bad JSON counts as empty", async (t) => {
  const { ext } = await start(t);
  const big = await ext("/api/pause", { method: "POST", body: JSON.stringify({ id: "x".repeat(1.2e6) }) });
  assert.equal(big.status, 413);
  const bad = await ext("/api/formats", { method: "POST", body: "{nope" });
  assert.equal(bad.status, 400);
  assert.equal((await ext("/api/pause", { method: "PUT", body: {} })).status, 405);
});

test("a CORS preflight from the extension is answered", async (t) => {
  const { port } = await start(t);
  const res = await request(port, { method: "OPTIONS", path: "/api/download", headers: { Origin: EXT } });
  assert.equal(res.status, 204);
  assert.equal(res.headers["access-control-allow-origin"], EXT);
  assert.match(res.headers["access-control-allow-headers"], /X-Downy-Token/);
});
