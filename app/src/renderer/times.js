// Times for trimming a video, shared by the main window and the confirm window.

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
