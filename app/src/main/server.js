// Local HTTP API on 127.0.0.1:9614 for the Chrome extension.
const http = require("http");
const { isYoutubeUrl, buildOptions, publicOptions } = require("./formats");

const HOST = "127.0.0.1";
const PORT = Number(process.env.DOWNY_PORT || 9614);
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

function startServer({ manager, cache, settings, tools, actions }) {
  // Only the extension may call the API. Checking Host blocks DNS rebinding;
  // checking Origin blocks other websites.
  const allowed = (req) => {
    if (!ALLOWED_HOSTS.has(req.headers.host)) return false;
    const origin = req.headers.origin;
    if (!origin) return req.method === "GET";
    return origin.startsWith("chrome-extension://");
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

  const readBody = (req) => new Promise((resolve) => {
    let raw = "";
    req.on("data", (d) => {
      raw += d;
      if (raw.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try {
        const v = JSON.parse(raw || "{}");
        resolve(v && typeof v === "object" ? v : {});
      } catch {
        resolve({});
      }
    });
  });

  const server = http.createServer(async (req, res) => {
    if (!allowed(req)) {
      res.writeHead(403);
      return res.end();
    }
    const path = new URL(req.url, "http://x").pathname;
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": req.headers.origin,
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      return res.end();
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
      const id = String(data.id || "");
      switch (path) {
        case "/api/formats": {
          const url = String(data.url || "");
          if (!isYoutubeUrl(url)) throw new Error("Only YouTube links are supported");
          const { info } = await cache.get(url);
          return send(req, res, 200, {
            title: info.title, thumbnail: info.thumbnail, duration: info.duration,
            options: publicOptions(buildOptions(info)),
          });
        }
        case "/api/download": {
          const url = String(data.url || "");
          if (!isYoutubeUrl(url)) throw new Error("Only YouTube links are supported");
          const d = await manager.add(url, String(data.option || ""));
          if (settings.get().showOnStart) actions.show(d.id);
          return send(req, res, 200, d);
        }
        case "/api/file": {
          const d = await manager.addFile({
            url: String(data.url || ""), filename: String(data.filename || ""), referrer: String(data.referrer || ""),
            cookies: String(data.cookies || ""), userAgent: String(data.userAgent || ""), mime: String(data.mime || ""),
          });
          if (settings.get().showOnStart) actions.show(d.id);
          return send(req, res, 200, d);
        }
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
