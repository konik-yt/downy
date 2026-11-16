// Relays requests from the YouTube page to the Downy desktop app on this PC, and
// hands normal Chrome downloads to Downy. Requests go from here (not the page)
// so the app sees the extension origin.
const BASE = "http://127.0.0.1:9614";

async function call(path, body) {
  let res;
  try {
    res = await fetch(BASE + path, body === undefined ? {} : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    const err = new Error("Downy is not running. Open the Downy app from the Start menu, then try again.");
    err.offline = true;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Downy error ${res.status}`);
  return data;
}

async function handle(msg) {
  switch (msg.type) {
    case "status": return call("/api/status");
    case "formats": return call("/api/formats", { url: msg.url });
    case "download": return call("/api/download", { url: msg.url, option: msg.option });
    case "list": return call("/api/downloads");
    case "cancel": return call("/api/cancel", { id: msg.id });
    case "pause": return call("/api/pause", { id: msg.id });
    case "resume": return call("/api/resume", { id: msg.id });
    case "open": return call("/api/open", { id: msg.id, select: msg.select !== false });
    case "manager": return call("/api/show", { id: msg.id || "" });
  }
  throw new Error("Unknown request");
}

// ------------------------------------------------------- Chrome downloads

const SMALL = 1024 * 1024; // files under 1 MB stay in Chrome; they finish before Downy could help

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

// Returns true when Downy took the download. Chrome keeps it otherwise, for
// example when Downy is closed or the link only works inside the browser.
async function takeOver(item) {
  const url = item.finalUrl || item.url;
  if (!/^https?:/i.test(url)) return false; // blob:, data: and file: links stay in Chrome
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
  takeOver(item).then(
    (taken) => {
      if (!taken) suggest();
    },
    () => suggest(),
  );
  return true;
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  handle(msg).then(
    (data) => reply({ ok: true, data }),
    (err) => reply({ ok: false, error: err.message, offline: !!err.offline }),
  );
  return true;
});
