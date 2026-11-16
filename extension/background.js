// Relays requests from the YouTube page to the Downy helper on this PC.
// Requests go from here (not the page) so the helper sees the extension origin.
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
    const err = new Error("The Downy helper is not running. Double click start-downy.bat to start it.");
    err.offline = true;
    throw err;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Helper error ${res.status}`);
  return data;
}

async function handle(msg) {
  switch (msg.type) {
    case "status": return call("/api/status");
    case "formats": return call("/api/formats", { url: msg.url });
    case "download": return call("/api/download", { url: msg.url, option: msg.option });
    case "list": return call("/api/downloads");
    case "cancel": return call("/api/cancel", { id: msg.id });
    case "open": return call("/api/open", { id: msg.id, select: msg.select !== false });
    case "manager": return chrome.tabs.create({ url: BASE + "/" }).then(() => ({ ok: true }));
  }
  throw new Error("Unknown request");
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  handle(msg).then(
    (data) => reply({ ok: true, data }),
    (err) => reply({ ok: false, error: err.message, offline: !!err.offline }),
  );
  return true;
});
