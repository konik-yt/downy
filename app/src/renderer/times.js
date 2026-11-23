// Times for trimming a video, shared by the main window and the confirm window.

// "75", "1:15" and "1:02:05" become seconds. Anything else, like "1:75" or "1.5", becomes null.
window.parseTime = (text) => {
  const parts = String(text).trim().split(":");
  if (parts.length > 3 || !parts.every((p) => /^\d{1,6}$/.test(p))) return null;
  const n = parts.map(Number);
  if (n.slice(1).some((x) => x >= 60)) return null;
  return n.reduce((total, x) => total * 60 + x, 0);
};

// 1458 -> "24:18", 3725 -> "1:02:05"
window.formatTime = (s) => {
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
};

// 90 -> "1 minute 30 seconds"
window.timeInWords = (s) => {
  const unit = (n, name) => (n ? `${n} ${name}${n === 1 ? "" : "s"}` : "");
  return [unit(Math.floor(s / 3600), "hour"), unit(Math.floor((s % 3600) / 60), "minute"), unit(s % 60, "second")].filter(Boolean).join(" ") || "0 seconds";
};
