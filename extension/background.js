// Requests go from here, not the page, so the app sees the extension origin.
const BASE = "http://127.0.0.1:9614";
const VERSION = chrome.runtime.getManifest().version;

let token = null;
async function readToken() {
  try {
    const res = await fetch(chrome.runtime.getURL("token.json"), { cache: "no-store" });
    return (await res.json()).token || "";
  } catch {
    return "";
  }
}

async function call(path, body, retry = true) {
  if (token === null) token = await readToken();
  let res;
  try {
    const headers = { "X-Downy-Token": token };
    res = await fetch(`${BASE}${path}?ext=${encodeURIComponent(VERSION)}`, body === undefined ? { headers } : {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    const err = new Error("Downy is not running. Open the Downy app from the Start menu, then try again.");
    err.offline = true;
    throw err;
  }
  noteBundled(res.headers.get("X-Downy-Extension"));
  if (res.status === 401 && retry) {
    token = null;
    return call(path, body, false);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Downy error ${res.status}`);
  return data;
}

// Chrome keeps running the old code after Downy copies a new version into the folder
// it loads from, until the extension reloads.
let bundled = null;
let busy = 0;
let reloadTimer = null;

function noteBundled(v) {
  if (!v || !/^\d+(\.\d+){0,3}$/.test(v)) return;
  bundled = v;
  maybeReload();
}

function maybeReload() {
  if (!bundled || bundled === VERSION || busy || reloadTimer) return;
  // The wait lets the answer that brought the version reach the page first.
  reloadTimer = setTimeout(async () => {
    reloadTimer = null;
    if (busy || bundled === VERSION) return;
    const { reloadedFor } = await chrome.storage.local.get("reloadedFor");
    if (reloadedFor === bundled) return;
    await chrome.storage.local.set({ reloadedFor: bundled });
    chrome.runtime.reload();
  }, 1000);
}

async function track(promise) {
  busy++;
  try {
    return await promise;
  } finally {
    busy--;
    maybeReload();
  }
}

async function handle(msg) {
  switch (msg.type) {
    case "status": return call("/api/status");
    case "formats": return call("/api/formats", { url: msg.url, cookies: await pageCookies(msg.url) });
    case "download": return call("/api/download", { url: msg.url, option: msg.option });
    case "list": return call("/api/downloads");
    case "prompt": return call("/api/prompt", { id: msg.id });
    case "cancel": return call("/api/cancel", { id: msg.id });
    case "pause": return call("/api/pause", { id: msg.id });
    case "resume": return call("/api/resume", { id: msg.id });
    case "open": return call("/api/open", { id: msg.id, select: msg.select !== false });
    case "manager": return call("/api/show", { id: msg.id || "" });
  }
  throw new Error("Unknown request");
}

// No cookies for YouTube, where yt-dlp warns that cookies can get an account flagged.
async function pageCookies(url) {
  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return [];
  }
  if (/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(host)) return [];
  const labels = host.split(".");
  const parent = labels.slice(1).join(".");
  // Skip short second-level labels like the "co" in bbc.co.uk, so it never asks for all of co.uk,
  // and hosting where each subdomain belongs to someone else.
  const shared = SHARED_HOSTS.some((s) => parent === s || parent.endsWith("." + s));
  const withParent = labels.length >= 3 && labels[1].length > 3 && !shared;
  try {
    const lists = await Promise.all([
      chrome.cookies.getAll({ url }),
      withParent ? chrome.cookies.getAll({ domain: parent }) : [],
    ]);
    const seen = new Set();
    const out = [];
    for (const { domain, hostOnly, path, secure, expirationDate, name, value } of lists.flat()) {
      const key = `${domain}\t${path}\t${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ domain, hostOnly, path, secure, expirationDate, name, value });
    }
    return out;
  } catch {
    return [];
  }
}

// Sites where anyone can get a subdomain, so a page there never gets the cookies of the whole site.
const SHARED_HOSTS = [
  "github.io", "gitlab.io", "pages.dev", "vercel.app", "netlify.app", "herokuapp.com", "web.app",
  "firebaseapp.com", "blogspot.com", "wordpress.com", "amazonaws.com", "cloudfront.net",
  "azurewebsites.net", "workers.dev", "glitch.me", "repl.co", "onrender.com", "fly.dev", "appspot.com",
];

const SMALL = 1024 * 1024;

async function catching() {
  const { catchDownloads = true } = await chrome.storage.local.get("catchDownloads");
  return catchDownloads;
}

async function cookieHeader(url) {
  try {
    const list = await chrome.cookies.getAll({ url });
    return list.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch {
    return "";
  }
}

async function takeOver(item) {
  const url = item.finalUrl || item.url;
  if (!/^https?:/i.test(url)) return false;
  if (item.byExtensionId === chrome.runtime.id) return false;
  if (item.totalBytes > 0 && item.totalBytes < SMALL) return false;
  if (!(await catching())) return false;
  try {
    await call("/api/status");
  } catch {
    return false;
  }
  await chrome.downloads.pause(item.id).catch(() => {});
  const [now] = await chrome.downloads.search({ id: item.id });
  if (!now || now.state === "complete") return false;
  try {
    await call("/api/file", {
      url,
      filename: (item.filename || "").split(/[\\/]/).pop(),
      referrer: item.referrer || "",
      mime: item.mime || "",
      cookies: await cookieHeader(url),
      userAgent: navigator.userAgent,
    });
  } catch {
    await chrome.downloads.resume(item.id).catch(() => {});
    return false;
  }
  await chrome.downloads.cancel(item.id).catch(() => {});
  await chrome.downloads.erase({ id: item.id }).catch(() => {});
  return true;
}

// This event comes with Chrome's file name for the download (including names set
// by a page's download attribute), which Downy then uses too.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  track(takeOver(item)).then(
    (taken) => {
      if (!taken) suggest();
    },
    () => suggest(),
  );
  return true;
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  track(handle(msg)).then(
    (data) => reply({ ok: true, data }),
    (err) => reply({ ok: false, error: err.message, offline: !!err.offline }),
  );
  return true;
});

const hello = () => call("/api/status").catch(() => {});
chrome.runtime.onInstalled.addListener(hello);
chrome.runtime.onStartup.addListener(hello);
