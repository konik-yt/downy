// Local HTTP API on 127.0.0.1:9614 for the Chrome extension.
const http = require("http");
const crypto = require("crypto");
const { isHttpUrl, buildOptions, publicOptions } = require("./formats");

const HOST = "127.0.0.1";
const PORT = Number(process.env.DOWNY_PORT || 9614);
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

function startServer({ manager, cache, settings, tools, prompts, actions, token, extensionVersion }) {
  // Checking Host blocks DNS rebinding, and checking Origin blocks other websites.
  // A request with no Origin can only be a GET, and every /api/ call also needs the token.
  const allowed = (req) => {
    if (!ALLOWED_HOSTS.has(req.headers.host)) return false;
    const origin = req.headers.origin;
    if (!origin) return req.method === "GET";
    return origin.startsWith("chrome-extension://");
  };

  // Other Chrome extensions also send a chrome-extension:// Origin. Only Downy's own copy
  // of the extension can read token.json, which ExtensionCopy writes next to its files.
  const expected = Buffer.from(token);
  const hasToken = (req) => {
    const got = Buffer.from(String(req.headers["x-downy-token"] || ""));
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  };

  const send = (req, res, status, data) => {
    const body = JSON.stringify(data);
    const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
    const origin = req.headers.origin;
    if (origin && origin.startsWith("chrome-extension://")) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers.Vary = "Origin";
    }
    res.writeHead(status, headers);
    res.end(body);
  };

  // Resolves null when the body is too big or the request breaks off.
  // Buffers are joined before decoding so a character split across chunks stays whole.
  const readBody = (req) => new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    req.on("data", (d) => {
      size += d.length;
      if (size > 1e6) {
        done(null);
        req.pause();
      } else chunks.push(d);
    });
    req.on("end", () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        done(v && typeof v === "object" ? v : {});
      } catch {
        done({});
      }
    });
    req.on("close", () => done(null));
    req.on("error", () => done(null));
  });

  const server = http.createServer(async (req, res) => {
    if (!allowed(req)) {
      res.writeHead(403);
      return res.end();
    }
    const url = new URL(req.url, "http://x");
    const path = url.pathname;
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": req.headers.origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Downy-Token",
      });
      return res.end();
    }
    if (path.startsWith("/api/")) {
      // Only a version number counts, so no request can put its own text in the window.
      const ext = url.searchParams.get("ext");
      const v = ext && /^\d+(\.\d+){0,3}$/.test(ext) ? ext : null;
      if (!hasToken(req)) {
        // An older version is Chrome still running the copy from before an update, so the
        // window says to reload it. The current version without the token was loaded from
        // a zip or from this repo, so the window says to load Downy's folder instead.
        // Any website can send a GET with an <img> tag, but only an extension sends this Origin.
        if (req.headers.origin?.startsWith("chrome-extension://")) {
          actions.extensionSeen(v && v !== extensionVersion ? v : null);
        }
        return send(req, res, 401, { error: "This copy of the Downy extension can't talk to Downy. In chrome://extensions, remove it and load the folder Downy shows in Settings, Chrome extension." });
      }
      // The extension adds its version to every request.
      actions.extensionSeen(v);
    }
    try {
      if (req.method === "GET") {
        // Any website can load this page, so it must not do anything (the extension uses POST /api/show).
        if (path === "/" || path === "/index.html") {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          return res.end("<!doctype html><meta charset=utf-8><title>Downy</title><body style='background:#000;color:#a6a3c0;font:14px system-ui;display:grid;place-items:center;height:100vh;margin:0'>Downy is running. You can close this tab.");
        }
        if (path === "/api/status") {
          const t = tools.status();
          return send(req, res, 200, {
            ok: true, version: 2, app: true, downloadDir: settings.get().downloadDir,
            ytdlp: !!t.ytdlp, ffmpeg: !!t.ffmpeg, jsRuntime: !!t.jsRuntime,
          });
        }
        if (path === "/api/downloads") return send(req, res, 200, { downloads: manager.list() });
        res.writeHead(404);
        return res.end();
      }
      if (req.method !== "POST") {
        res.writeHead(405);
        return res.end();
      }
      const data = await readBody(req);
      if (!data) {
        res.writeHead(413, { Connection: "close" });
        return res.end();
      }
      const id = String(data.id || "");
      switch (path) {
        case "/api/formats": {
          const url = String(data.url || "");
          if (!isHttpUrl(url)) throw new Error("Downy can only read http and https pages");
          const { info } = await cache.get(url, { cookies: data.cookies });
          return send(req, res, 200, {
            title: info.title, thumbnail: info.thumbnail, duration: info.duration,
            options: publicOptions(buildOptions(info)),
          });
        }
        case "/api/download": {
          const url = String(data.url || "");
          if (!isHttpUrl(url)) throw new Error("Downy can only read http and https pages");
          // With "Ask before each download" on, the answer is a request id the extension follows with /api/prompt.
          if (settings.get().confirm) return send(req, res, 200, { prompt: (await prompts.openVideo(url, String(data.option || ""))).id });
          const d = await manager.add(url, String(data.option || ""));
          if (settings.get().showOnStart) actions.show(d.id);
          return send(req, res, 200, d);
        }
        case "/api/file": {
          const spec = {
            url: String(data.url || ""), filename: String(data.filename || ""), referrer: String(data.referrer || ""),
            cookies: String(data.cookies || ""), userAgent: String(data.userAgent || ""), mime: String(data.mime || ""),
          };
          if (settings.get().confirm) return send(req, res, 200, { prompt: (await prompts.openFile(spec)).id });
          const d = await manager.addFile(spec);
          if (settings.get().showOnStart) actions.show(d.id);
          return send(req, res, 200, d);
        }
        case "/api/prompt": return send(req, res, 200, prompts.status(id));
        case "/api/pause": manager.pause(id); break;
        case "/api/resume": manager.resume(id); break;
        case "/api/cancel": manager.cancel(id); break;
        case "/api/remove": manager.remove(id); break;
        case "/api/clear": manager.clearFinished(); break;
        case "/api/open": actions.reveal(id, data.select !== false); break;
        case "/api/show": actions.show(id || null); break;
        default:
          res.writeHead(404);
          return res.end();
      }
      return send(req, res, 200, { ok: true });
    } catch (e) {
      return send(req, res, 400, { error: e.message || String(e) });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, HOST, () => resolve(server));
  });
}

module.exports = { startServer, PORT };
