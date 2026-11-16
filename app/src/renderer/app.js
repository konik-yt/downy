/* global downy, icon, paintIcons */
const $ = (id) => document.getElementById(id);
const state = {
  downloads: [],
  settings: null,
  tools: {},
  filter: "all",
  folder: null,
  picker: null, // { url, info }
  rows: new Map(),
};

const RUNNING = new Set(["downloading", "merging", "converting", "queued"]);
const FILTERS = [
  { id: "all", label: "All downloads", icon: "layers", test: () => true },
  { id: "running", label: "Running", icon: "activity", test: (d) => RUNNING.has(d.status) },
  { id: "paused", label: "Paused", icon: "pauseCircle", test: (d) => d.status === "paused" },
  { id: "done", label: "Finished", icon: "check", test: (d) => d.status === "done" },
  { id: "failed", label: "Failed", icon: "alert", test: (d) => d.status === "error" || d.status === "cancelled" },
];

// ---------------------------------------------------------------- helpers

function size(n) {
  if (!n) return "0 MB";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < 3) {
    n /= 1024;
    i++;
  }
  return (i < 2 ? n.toFixed(0) : n.toFixed(1)) + " " + u[i];
}

function eta(s) {
  if (s == null || !isFinite(s)) return "";
  s = Math.round(s);
  if (s < 60) return `${s} s left`;
  const m = Math.round(s / 60); // round once, so 59.6 min becomes 1 h, not 60 min
  if (m < 60) return `${m} min left`;
  return `${Math.floor(m / 60)} h ${m % 60} min left`;
}

function when(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today at ${time}`;
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday at ${time}`;
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function toast(text, bad = false) {
  const t = el("div", "toast" + (bad ? " bad" : ""), text);
  $("toasts").append(t);
  setTimeout(() => t.remove(), bad ? 6000 : 3200);
}

async function call(fn, ...args) {
  const res = await fn(...args);
  if (!res.ok) {
    toast(res.error, true);
    throw new Error(res.error);
  }
  return res.data;
}

// The sky is 480 x 270 cells. Size the cells to whole pixels so the grid
// stays crisp, and make the sky cover the window like T3 Code does.
function fitSky() {
  const cover = Math.max(innerWidth, (innerHeight * 16) / 9);
  const d = Math.max(2, Math.ceil(cover / 480));
  document.documentElement.style.setProperty("--d", `${d}px`);
  document.documentElement.style.setProperty("--w", `${d * 480}px`);
}

// ---------------------------------------------------------------- sidebar

function renderSidebar() {
  const counts = Object.fromEntries(FILTERS.map((f) => [f.id, state.downloads.filter(f.test).length]));
  const filters = $("filters");
  filters.replaceChildren(...FILTERS.map((f) => {
    const b = el("button", "nav-item");
    b.innerHTML = icon(f.icon);
    b.append(el("span", "", f.label));
    const c = el("span", "count" + (f.id === "running" && counts[f.id] ? " live" : ""), counts[f.id] ? String(counts[f.id]) : "");
    b.append(c);
    if (!state.folder && state.filter === f.id) b.setAttribute("aria-current", "true");
    b.onclick = () => {
      state.filter = f.id;
      state.folder = null;
      render();
    };
    return b;
  }));

  // Folders mirror the disk: Downloads for files, YouTube with one folder per format.
  const fc = {};
  for (const d of state.downloads) {
    if (d.status !== "done") continue;
    const dir = folderOf(d);
    fc[dir] = (fc[dir] || 0) + 1;
    if (dir.startsWith("YouTube/")) fc.YouTube = (fc.YouTube || 0) + 1;
  }
  const order = (name) => {
    const m = /^(\d+)p$/.exec(name);
    return m ? -Number(m[1]) : name === "MP3" ? 1 : 2;
  };
  const formats = Object.keys(fc).filter((k) => k.startsWith("YouTube/")).map((k) => k.slice(8))
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  const item = (key, label, ic, count, sub = false) => {
    const b = el("button", "nav-item" + (sub ? " sub" : ""));
    b.innerHTML = icon(ic);
    b.append(el("span", "", label), el("span", "count", count ? String(count) : ""));
    if (state.folder === key) b.setAttribute("aria-current", "true");
    b.onclick = () => {
      state.folder = key;
      render();
    };
    return b;
  };
  const box = $("folders");
  if (!fc.Downloads && !fc.YouTube) {
    box.replaceChildren(el("p", "nav-note", "Finished files show up here. Files from Chrome go in Downloads, YouTube files are sorted by format."));
  } else {
    const items = [];
    if (fc.Downloads) items.push(item("Downloads", "Downloads", "folder", fc.Downloads));
    if (fc.YouTube) {
      items.push(item("YouTube", "YouTube", "video", fc.YouTube));
      for (const f of formats) items.push(item(`YouTube/${f}`, f, /^\d+p$/.test(f) ? "video" : "music", fc[`YouTube/${f}`], true));
    }
    box.replaceChildren(...items);
  }
  if (state.settings) {
    $("wherePath").textContent = state.settings.downloadDir;
    $("whereBtn").title = `Saving to ${state.settings.downloadDir}. Click to change.`;
  }
}

// ------------------------------------------------------------------- list

// Where a finished file sits inside the download folder, such as "Downloads" or "YouTube/1080p".
function folderOf(d) {
  if (d.source === "web") return "Downloads";
  const dir = d.dir || d.folder || "";
  if (dir === "YouTube" || dir.startsWith("YouTube/")) return dir;
  return `YouTube/${d.folder}`;
}

const folderLabel = (key) => (key.startsWith("YouTube/") ? `YouTube ${key.slice(8)}` : key);

// Unfinished downloads stay on top, newest first within each group.
const rank = (d) => (d.status === "downloading" || d.status === "merging" || d.status === "converting" ? 0 : d.status === "queued" ? 1 : d.status === "paused" ? 2 : 3);

function visible() {
  let items;
  if (state.folder) {
    items = state.downloads.filter((d) => d.status === "done" && (folderOf(d) === state.folder || folderOf(d).startsWith(state.folder + "/")));
  }
  else items = state.downloads.filter(FILTERS.find((x) => x.id === state.filter).test);
  return items.sort((a, b) => rank(a) - rank(b) || b.created - a.created);
}

function renderListHead(items) {
  const f = FILTERS.find((x) => x.id === state.filter);
  const title = state.folder ? `${folderLabel(state.folder)} folder` : f.label;
  $("listTitle").textContent = title;
  $("crumbPage").textContent = state.folder ? folderLabel(state.folder) : f.label;
  $("listCount").textContent = items.length ? String(items.length) : "";
  const actions = [];
  const btn = (label, ic, fn) => {
    const b = el("button", "btn");
    b.innerHTML = icon(ic);
    b.append(label);
    b.onclick = fn;
    actions.push(b);
  };
  if (state.downloads.some((d) => d.status === "downloading" || d.status === "queued")) btn("Pause all", "pause", () => call(downy.pauseAll));
  if (state.downloads.some((d) => d.status === "paused")) btn("Resume all", "play", () => call(downy.resumeAll));
  if (state.folder) btn("Open folder", "folder", () => call(downy.openFolder, state.folder));
  if ((state.filter === "done" || state.filter === "failed") && !state.folder && items.length) {
    btn("Clear from list", "trash", () => call(downy.clear, state.filter));
  }
  $("listActions").replaceChildren(...actions);
}

function render() {
  const has = state.downloads.length > 0;
  $("main").classList.toggle("has-list", has);
  $("listWrap").hidden = !has;
  renderSidebar();
  if (!has) return;
  const items = visible();
  renderListHead(items);
  const list = $("list");
  const keep = new Set(items.map((d) => d.id));
  for (const [id, row] of state.rows) {
    if (!keep.has(id)) {
      row.el.remove();
      state.rows.delete(id);
    }
  }
  let prev = null;
  for (const d of items) {
    let row = state.rows.get(d.id);
    if (!row) {
      row = makeRow(d);
      state.rows.set(d.id, row);
    }
    updateRow(row, d);
    const want = prev ? prev.nextSibling : list.firstChild;
    if (want !== row.el) list.insertBefore(row.el, want);
    prev = row.el;
  }
  const empty = $("listEmpty");
  empty.hidden = items.length > 0;
  if (!items.length) {
    empty.textContent = state.folder
      ? "Nothing in this folder yet."
      : { running: "Nothing is downloading right now.", paused: "No paused downloads.", done: "No finished downloads yet.", failed: "No failed downloads." }[state.filter] || "No downloads yet.";
  }
}

function makeRow(d) {
  const r = { el: el("article", "row") };
  r.el.setAttribute("role", "listitem");
  r.el.dataset.id = d.id;
  r.thumb = el("div", "thumb");
  r.img = el("img");
  r.img.alt = "";
  r.img.loading = "lazy";
  r.img.referrerPolicy = "no-referrer";
  r.img.onerror = () => (r.img.style.visibility = "hidden");
  r.kind = el("span", "kind");
  r.thumb.append(r.img, r.kind);

  r.body = el("div", "row-body");
  r.title = el("h3", "row-title");
  r.meta = el("div", "row-meta");
  r.bar = el("div", "segbar");
  r.foot = el("div", "row-foot");
  r.body.append(r.title, r.meta, r.bar, r.foot);

  r.side = el("div", "row-side");
  r.rate = el("div", "rate");
  r.actions = el("div", "actions");
  r.side.append(r.rate, r.actions);
  r.el.append(r.thumb, r.body, r.side);
  r.el.addEventListener("dblclick", () => {
    const cur = state.downloads.find((x) => x.id === d.id);
    if (cur?.status === "done") call(downy.openFile, d.id);
  });
  return r;
}

function actionButton(label, ic, fn, cls = "") {
  const b = el("button", "icon-btn " + cls);
  b.innerHTML = icon(ic);
  b.title = label;
  b.setAttribute("aria-label", label);
  b.onclick = (e) => {
    e.stopPropagation();
    fn();
  };
  return b;
}

function statusLine(d) {
  const pct = Math.floor(d.progress * 100);
  switch (d.status) {
    case "queued": return ["loader", "Waiting for a free slot"];
    case "downloading": return ["arrowDown", d.expected ? `${size(d.downloaded)} of ${size(d.expected)}` : `${size(d.downloaded)} so far`];
    case "paused": return ["pause", d.kind === "file" && d.resumable === false ? "Paused. This server cannot resume, so it starts over" : `Paused at ${pct}%`];
    case "merging": return ["layers", `Joining video and audio ${Math.round(d.postProgress * 100)}%`];
    case "converting": return ["music", d.kind === "mp3" ? `Converting to MP3 ${Math.round(d.postProgress * 100)}%` : "Saving M4A file"];
    case "done": return ["check", `Saved to ${folderOf(d).replace("/", " / ")}`];
    case "cancelled": return ["x", "Cancelled"];
    case "error": return ["alert", "Download failed"];
  }
  return ["loader", d.status];
}

function updateRow(r, d) {
  const sig = [d.status, d.thumbnail, d.title, d.folder].join("|");
  r.el.dataset.status = d.status;
  if (r.sig !== sig) {
    r.sig = sig;
    if (d.thumbnail && r.img.src !== d.thumbnail) r.img.src = d.thumbnail;
    r.thumb.classList.toggle("file", d.kind === "file");
    r.img.hidden = d.kind === "file";
    if (d.kind === "file" && !r.fileIcon) {
      r.fileIcon = el("span", "file-icon");
      r.fileIcon.innerHTML = icon("file");
      r.thumb.prepend(r.fileIcon);
    }
    r.kind.textContent = d.kind === "file" ? (d.ext || "file").toUpperCase().slice(0, 6) : d.folder || "";
    r.title.textContent = d.title;
    r.title.title = d.title;
    renderActions(r, d);
  }

  const [ic, text] = statusLine(d);
  const meta = [];
  const st = el("span", "state");
  st.innerHTML = icon(ic);
  st.append(text);
  meta.push(st);
  if (d.status === "paused" && d.expected) meta.push(el("span", "", `${size(d.downloaded)} of ${size(d.expected)}`));
  if (d.status === "done" && d.expected) meta.push(el("span", "", size(d.expected)));
  if (d.status === "done") meta.push(el("span", "", when(d.finished)));
  if (d.status === "error") meta.push(el("span", "bad", d.error));
  r.meta.replaceChildren(...meta);

  // segment bar
  const showBar = ["downloading", "paused", "queued", "merging", "converting"].includes(d.status);
  r.bar.hidden = !showBar;
  if (showBar) renderBar(r, d);

  const foot = [];
  if (d.status === "downloading") {
    if (d.connections) foot.push(el("span", "", `${d.connections} ${d.connections === 1 ? "connection" : "connections"}`));
    if (d.stream && d.stream.count > 1) foot.push(el("span", "", d.stream.role === "audio" ? `Audio, part ${d.stream.index} of ${d.stream.count}` : `Video, part ${d.stream.index} of ${d.stream.count}`));
    foot.push(el("span", "", `${Math.floor(d.progress * 100)}%`));
  } else if (d.status === "paused") {
    foot.push(el("span", "", d.kind === "file" && d.resumable === false
      ? "Resume downloads the file again from the start"
      : "Resume continues from here, even after a restart"));
  } else if (d.status === "done" && d.filename) {
    foot.push(el("span", "", d.filename));
  }
  r.foot.replaceChildren(...foot);
  r.foot.hidden = !foot.length;

  const rate = [];
  if (d.status === "downloading") {
    rate.push(el("b", "", d.speed ? `${size(d.speed)}/s` : "Connecting"));
    rate.push(el("span", "", eta(d.eta)));
  }
  r.rate.replaceChildren(...rate);
  r.rate.hidden = !rate.length;
}

function renderBar(r, d) {
  const post = d.status === "merging" || d.status === "converting";
  r.bar.classList.toggle("post", post);
  r.bar.classList.toggle("paused", d.status === "paused" || d.status === "queued");
  const segs = post ? [{ s: 0, e: 1, p: d.postProgress || 0, live: true }]
    : d.segments.length ? d.segments : [{ s: 0, e: 1, p: d.progress, live: false }];
  if (r.bar.children.length !== segs.length) {
    r.bar.replaceChildren(...segs.map(() => {
      const i = el("i", "seg");
      i.append(el("b"));
      return i;
    }));
  }
  segs.forEach((s, idx) => {
    const node = r.bar.children[idx];
    node.style.left = `${s.s * 100}%`;
    node.style.width = `${(s.e - s.s) * 100}%`;
    const span = s.e - s.s || 1;
    const fill = Math.max(0, Math.min(1, (s.p - s.s) / span));
    node.firstChild.style.width = `${fill * 100}%`;
    node.classList.toggle("live", !!s.live && d.status === "downloading");
    node.classList.toggle("full", fill >= 1);
  });
  r.bar.setAttribute("role", "progressbar");
  r.bar.setAttribute("aria-valuemin", "0");
  r.bar.setAttribute("aria-valuemax", "100");
  r.bar.setAttribute("aria-valuenow", String(Math.round((post ? d.postProgress : d.progress) * 100)));
  r.bar.setAttribute("aria-label", `${d.title} progress`);
}

function renderActions(r, d) {
  const a = [];
  const id = d.id;
  if (d.status === "downloading" || d.status === "queued") {
    a.push(actionButton("Pause", "pause", () => call(downy.pause, id)));
    a.push(actionButton("Cancel download", "x", () => call(downy.cancel, id), "danger"));
  } else if (d.status === "paused") {
    a.push(actionButton("Resume", "play", () => call(downy.resume, id)));
    a.push(actionButton("Cancel download", "x", () => call(downy.cancel, id), "danger"));
  } else if (d.status === "error") {
    a.push(actionButton("Try again", "retry", () => call(downy.resume, id)));
    a.push(actionButton("Remove from list", "trash", () => call(downy.remove, id), "danger"));
  } else if (d.status === "done") {
    a.push(actionButton("Open file", "play", () => call(downy.openFile, id)));
    a.push(actionButton("Show in folder", "folder", () => call(downy.reveal, id)));
    a.push(actionButton("Remove from list", "trash", () => call(downy.remove, id), "danger"));
  } else if (d.status === "cancelled") {
    a.push(actionButton("Remove from list", "trash", () => call(downy.remove, id), "danger"));
  }
  r.actions.replaceChildren(...a);
}

// --------------------------------------------------------------- composer

function setHint(text, bad = false, ic = "link") {
  const h = $("composerHint");
  h.className = "hint" + (bad ? " bad" : "");
  h.innerHTML = icon(ic);
  h.append(text);
}

function defaultHint() {
  setHint(state.settings?.organize === false
    ? "YouTube files go into YouTube, other files into Downloads"
    : "YouTube files are sorted by format, other files go into Downloads");
}

function isYoutube(url) {
  try {
    return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function addFile(url) {
  const send = $("sendBtn");
  send.disabled = true;
  setHint("Checking the link", false, "loader");
  try {
    const res = await downy.addFile(url);
    if (!res.ok) return setHint(res.error, true, "alert");
    $("url").value = "";
    defaultHint();
    state.filter = "all";
    state.folder = null;
    flash(res.data.id);
  } finally {
    send.disabled = false;
  }
}

// Only the newest lookup may open the picker, and only while its link is still in the box.
let formatsRequest = 0;

async function getFormats(url) {
  const req = ++formatsRequest;
  const send = $("sendBtn");
  send.disabled = true;
  send.classList.add("busy");
  send.dataset.icon = "loader";
  paintIcons(send.parentElement);
  setHint("Reading formats from YouTube", false, "loader");
  try {
    const res = await downy.formats(url);
    if (req !== formatsRequest || $("url").value.trim() !== url) return;
    if (!res.ok) {
      setHint(res.error, true, "alert");
      return;
    }
    state.picker = { url, info: res.data };
    renderPicker();
    defaultHint();
  } finally {
    if (req !== formatsRequest) return;
    send.disabled = false;
    send.classList.remove("busy");
    send.dataset.icon = "arrowUp";
    paintIcons(send.parentElement);
  }
}

function renderPicker() {
  const p = $("picker");
  if (!state.picker) {
    p.hidden = true;
    p.replaceChildren();
    return;
  }
  const { info } = state.picker;
  const head = el("div", "pick-head");
  const img = el("img");
  img.src = info.thumbnail || "";
  img.alt = "";
  img.referrerPolicy = "no-referrer";
  const txt = el("div");
  txt.append(el("div", "pick-title", info.title || ""), el("div", "pick-sub", info.channel || ""));
  head.append(img, txt);

  const groups = [
    ["Video", info.options.filter((o) => o.kind === "video")],
    ["Audio only", info.options.filter((o) => o.kind !== "video")],
  ];
  const parts = [head];
  for (const [name, opts] of groups) {
    if (!opts.length) continue;
    parts.push(el("div", "pick-group", name));
    const grid = el("div", "pick-grid");
    for (const o of opts) {
      const b = el("button", "pick");
      b.type = "button";
      const label = o.kind === "video" ? o.label.replace(/^MP4 file, quality /, "") : o.kind === "mp3" ? "MP3" : "M4A";
      b.append(el("b", "", label), el("span", "", [o.kind === "video" ? "MP4" : "Audio", o.sizeText].filter(Boolean).join(", ")));
      b.title = state.settings?.organize ? `${o.label}, saved to YouTube / ${o.folder}` : o.label;
      b.onclick = () => startDownload(o);
      grid.append(b);
    }
    parts.push(grid);
  }
  if (!info.options.length) parts.push(el("p", "pick-sub", "No downloadable formats were found for this video."));
  const cancel = el("button", "btn pick-cancel", "Cancel");
  cancel.type = "button";
  cancel.onclick = closePicker;
  parts.push(cancel);
  p.replaceChildren(...parts);
  p.hidden = false;
  p.querySelector(".pick")?.focus();
}

function closePicker() {
  state.picker = null;
  renderPicker();
}

async function startDownload(option) {
  const { url } = state.picker;
  closePicker();
  $("url").value = "";
  try {
    const d = await call(downy.download, url, option.id);
    state.filter = "all";
    state.folder = null;
    flash(d.id);
  } catch {}
}

function flash(id) {
  const tryFlash = (n) => {
    const row = state.rows.get(id);
    if (!row) return n > 0 && setTimeout(() => tryFlash(n - 1), 150);
    row.el.classList.remove("flash");
    void row.el.offsetWidth;
    row.el.classList.add("flash");
    row.el.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  tryFlash(10);
}

// --------------------------------------------------------------- settings

function renderSettings() {
  const s = state.settings;
  if (!s) return;
  const f = $("settingsForm");
  $("setDir").textContent = s.downloadDir;
  $("welcomeDir").textContent = s.downloadDir;
  for (const name of ["organize", "showOnStart", "closeToTray", "openAtLogin", "notify"]) f.elements[name].checked = !!s[name];
  f.elements.connections.value = s.connections;
  f.elements.maxActive.value = s.maxActive;
  const t = state.tools || {};
  const tools = $("toolsList");
  tools.replaceChildren(...[["yt-dlp", t.ytdlp], ["ffmpeg", t.ffmpeg], ["JavaScript runtime", t.jsRuntime]].map(([name, found]) => {
    const span = el("span", found ? "ok" : "missing");
    span.innerHTML = icon(found ? "check" : "alert");
    span.append(found ? `${name} found` : `${name} missing`);
    if (found) span.title = found;
    return span;
  }));
}

async function saveSetting(patch) {
  state.settings = await call(downy.setSettings, patch);
  renderSettings();
  renderSidebar();
  defaultHint();
}

// ------------------------------------------------------------------ setup

function wire() {
  addEventListener("resize", fitSky);
  fitSky();
  paintIcons();

  for (const b of document.querySelectorAll("[data-win]")) b.onclick = () => downy.windowAction(b.dataset.win);
  downy.onWindow(({ maximized }) => {
    const b = $("maxBtn");
    b.dataset.icon = maximized ? "restore" : "square";
    b.setAttribute("aria-label", maximized ? "Restore" : "Maximize");
    paintIcons(b.parentElement);
  });
  document.querySelector(".titlebar").addEventListener("dblclick", (e) => {
    if (!e.target.closest("button")) downy.windowAction("maximize");
  });

  $("composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const url = $("url").value.trim();
    if (!url) {
      setHint("Paste a link first", true, "alert");
      $("url").focus();
      return;
    }
    if (isYoutube(url)) getFormats(url);
    else addFile(url);
  });
  $("url").addEventListener("input", () => {
    if (state.picker) closePicker();
    defaultHint();
  });

  // Pasting a YouTube link anywhere fills the box and reads its formats.
  document.addEventListener("paste", (e) => {
    if (e.target.closest("input") && e.target.id !== "url") return;
    const text = (e.clipboardData?.getData("text") || "").trim();
    if (!/^https?:\/\//i.test(text)) return;
    e.preventDefault();
    $("url").value = text;
    if (isYoutube(text)) getFormats(text);
    else {
      $("url").focus();
      setHint("Press Enter to download this file into Downloads", false, "arrowDown");
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.picker) closePicker();
  });

  const dialog = $("settings");
  const openSettings = async () => {
    const res = await downy.recheckTools();
    if (res.ok) state.tools = res.data;
    renderSettings();
    dialog.showModal();
    $("openSettings").setAttribute("aria-pressed", "true");
  };
  dialog.addEventListener("close", () => $("openSettings").setAttribute("aria-pressed", "false"));
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  $("openSettings").onclick = openSettings;
  $("whereBtn").onclick = async () => {
    state.settings = await call(downy.chooseFolder);
    renderSettings();
    renderSidebar();
  };
  $("setDirBtn").onclick = $("whereBtn").onclick;
  $("welcomeDirBtn").onclick = $("whereBtn").onclick;

  // First run: the welcome screen stays up until the user confirms a download folder.
  const welcome = $("welcome");
  welcome.addEventListener("cancel", (e) => e.preventDefault());
  $("welcomeDone").onclick = async () => {
    await saveSetting({ onboarded: true });
    welcome.close();
    $("url").focus();
  };
  const form = $("settingsForm");
  for (const name of ["organize", "showOnStart", "closeToTray", "openAtLogin", "notify"]) {
    form.elements[name].addEventListener("change", (e) => saveSetting({ [name]: e.target.checked }));
  }
  for (const b of form.querySelectorAll("[data-step]")) {
    b.onclick = () => {
      const key = b.dataset.step;
      saveSetting({ [key]: state.settings[key] + Number(b.dataset.delta) });
    };
  }

  downy.onDownloads((list) => {
    state.downloads = list;
    render();
  });
  downy.onSettings((s) => {
    state.settings = s;
    renderSettings();
    renderSidebar();
  });
  downy.onFocus((id) => {
    state.filter = "all";
    state.folder = null;
    render();
    flash(id);
  });
}

(async function init() {
  wire();
  const res = await downy.state();
  if (!res.ok) return toast(res.error, true);
  Object.assign(state, { downloads: res.data.downloads, settings: res.data.settings, tools: res.data.tools });
  if (res.data.maximized) {
    $("maxBtn").dataset.icon = "restore";
    paintIcons($("maxBtn").parentElement);
  }
  render();
  renderSettings();
  defaultHint();
  if (!res.data.tools.ytdlp || !res.data.tools.ffmpeg) {
    toast(`${!res.data.tools.ytdlp ? "yt-dlp" : "ffmpeg"} was not found. Open Settings to see what Downy needs.`, true);
  }
  $("url").focus();
  if (!state.settings.onboarded) {
    $("welcome").showModal();
    $("welcomeDone").focus();
  }
})();
