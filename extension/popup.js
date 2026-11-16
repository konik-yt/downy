const send = (msg) => chrome.runtime.sendMessage(msg);
const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function size(n) {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB"]; let i = 0;
  while (n >= 1024 && i < 3) { n /= 1024; i++; }
  return (i < 2 ? n.toFixed(0) : n.toFixed(1)) + " " + u[i];
}

const STATUS = {
  queued: "Waiting", paused: "Paused", merging: "Joining video and audio", converting: "Converting to MP3",
  done: "Saved", cancelled: "Cancelled", error: "Failed",
};

async function refresh() {
  const res = await send({ type: "list" });
  const list = $("list"), status = $("status");
  if (!res?.ok) {
    status.className = "bad"; status.textContent = "Not running";
    list.replaceChildren(el("li", "note bad", res?.error || "Downy is not running. Open the Downy app."));
    return setTimeout(refresh, 2000);
  }
  status.className = "ok"; status.textContent = "Running";
  const items = res.data.downloads.slice(0, 6);
  if (!items.length) {
    list.replaceChildren(el("li", "note", "Open a YouTube video and use the Download this video button."));
  } else {
    list.replaceChildren(...items.map((d) => {
      const li = el("li");
      const pct = Math.round(d.progress * 100);
      const meta = d.status === "downloading"
        ? `${pct}%  ${size(d.downloaded)} of ${size(d.expected)}  ${size(d.speed)}/s`
        : `${STATUS[d.status] || d.status}  ${d.label}`;
      li.append(el("div", "t", d.title), el("div", "m", d.status === "error" ? d.error : meta));
      if (["queued", "downloading", "merging", "converting"].includes(d.status)) {
        const track = el("div", "track"), fill = el("div", "fill");
        fill.style.width = pct + "%";
        track.append(fill); li.append(track);
      }
      return li;
    }));
  }
  setTimeout(refresh, 1000);
}

$("manager").onclick = () => send({ type: "manager" });
chrome.storage.local.get("catchDownloads").then(({ catchDownloads = true }) => ($("catch").checked = catchDownloads));
$("catch").onchange = (e) => chrome.storage.local.set({ catchDownloads: e.target.checked });
refresh();
