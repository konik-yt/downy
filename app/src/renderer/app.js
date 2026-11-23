const $ = (id) => document.getElementById(id);
const state = {
  downloads: [],
  settings: null,
  tools: {},
  extension: null, // { dir, version, seen, seenVersion, current }
  update: null, // { status, current, version, percent, error }
  install: null, // { running, tool, label, received, total, error, done }
  steps: 2, // steps on the first-run welcome screen: 3 when tools need installing
  toolsMode: "first", // "first" run, "missing" at a later start, or "settings"
  tab: "downloads", // "downloads", "done" or "failed"
  folder: null, // a folder picked on the Finished tab, such as "YouTube/1080p"
  picker: null, // { url, info, trim, from, to, clip, error, run }
  rows: new Map(), // row parts by download id
  secs: new Map(), // list sections by id
  speed: 0, // smoothed total download speed in bytes per second
  refocus: null, // the element to focus again after a keyboard move
  run: null, // { ids, started, result }: the files that ran since the line was last empty
  batchList: [], // batches built from the downloads, newest first
  batchPos: new Map(), // download id -> { k, n, next }: its place in its batch
  batchStates: new Map(), // batch id -> its state at the last render, to notice when one finishes
  select: null, // { ids, anchor } while picking files
};

const LIVE = new Set(["downloading", "merging", "converting"]);
const FAILED = new Set(["error", "cancelled"]);
// Files that can be picked for a batch: waiting, paused and failed ones.
const PICKABLE = new Set(["queued", "paused", "error"]);
const isActive = (d) => LIVE.has(d.status) || d.status === "queued" || d.status === "paused";
const TABS = [
  { id: "downloads", label: "Downloads", tone: "live", test: isActive },
  { id: "done", label: "Finished", tone: "", test: (d) => d.status === "done" },
  { id: "failed", label: "Failed", tone: "bad", test: (d) => FAILED.has(d.status) },
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

// "126.7 of 500.0 MB": the unit once when both sides share it.
function sizeOf(a, b) {
  const [x, ux] = size(a).split(" ");
  const [y, uy] = size(b).split(" ");
  return ux === uy ? `${x} of ${y} ${uy}` : `${x} ${ux} of ${y} ${uy}`;
}

function eta(s) {
  if (s == null || !isFinite(s)) return "";
  s = Math.round(s);
  if (s < 60) return `${s} s left`;
  const m = Math.round(s / 60); // round once, so 59.6 min becomes 1 h, not 60 min
  if (m < 60) return `${m} min left`;
  return `${Math.floor(m / 60)} h ${m % 60} min left`;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const files = (n) => `${n} ${n === 1 ? "file" : "files"}`;
const sum = (list, fn) => list.reduce((t, d) => t + (fn(d) || 0), 0);

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

// ------------------------------------------------------------------- tabs

function makeTabs() {
  $("tabs").replaceChildren(...TABS.map((t) => {
    const b = el("button", "tab");
    b.type = "button";
    b.dataset.tab = t.id;
    b.append(t.label, el("span", "n"));
    b.onclick = () => openTab(t.id);
    return b;
  }));
  // A count that rolls or a narrower window changes a tab's width, so the highlight follows.
  const resized = new ResizeObserver(() => placePill($("tabs"), $("tabs").querySelector('.tab[aria-current="page"]')));
  for (const b of $("tabs").querySelectorAll(".tab")) resized.observe(b);
}

function renderTabs() {
  const bar = $("tabs");
  for (const b of bar.querySelectorAll(".tab")) {
    const t = TABS.find((x) => x.id === b.dataset.tab);
    const n = state.downloads.filter(t.test).length;
    const count = b.lastChild;
    roll(count, n ? String(n) : "");
    count.className = "n" + (n && t.tone ? " " + t.tone : "");
    if (state.tab === t.id) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  }
  placePill(bar, bar.querySelector('.tab[aria-current="page"]'));
}

function openTab(id, folder = null) {
  const moved = state.tab !== id;
  state.tab = id;
  state.folder = folder;
  render();
  if (moved) $("main").scrollTop = 0;
}

// ------------------------------------------------------------------ folders

const VIDEO_GROUPS = ["YouTube", "Videos"];

// The folder name for "Saved to": a folder outside the download folder goes by its own name.
function savedIn(d) {
  const dir = folderOf(d);
  if (dir !== "Other" || !d.filepath) return dir.replace(/\//g, " / ");
  return d.filepath.split(/[\\/]/).slice(-2, -1)[0] || dir;
}

// Where a finished file sits inside the download folder, such as "Downloads", "YouTube/1080p" or "Videos/720p".
// "Other" is a folder the user picked outside the download folder.
function folderOf(d) {
  const dir = d.dir || "";
  if (d.source === "web" && (!dir || dir === "Downloads")) return "Downloads";
  if (VIDEO_GROUPS.some((g) => dir === g || dir.startsWith(g + "/"))) return dir;
  // Older versions saved only the format folder, like "1080p".
  if (dir && dir !== d.folder) return dir;
  return `${d.source === "video" ? "Videos" : "YouTube"}/${d.folder}`;
}

const folderLabel = (key) => {
  if (key === "Other") return "Other places";
  const g = VIDEO_GROUPS.find((x) => key.startsWith(x + "/"));
  return g ? `${g} ${key.slice(g.length + 1)}` : key;
};

const inFolder = (d, key) => folderOf(d) === key || folderOf(d).startsWith(key + "/");

// The folders finished files are in, as the disk has them: Downloads, then YouTube and
// Videos with one folder per format, then folders picked in the confirm window.
function folderKeys(done) {
  const fc = {};
  for (const d of done) {
    const dir = folderOf(d);
    fc[dir] = (fc[dir] || 0) + 1;
  }
  const known = new Set(["Downloads", "Other"]);
  const order = (name) => {
    const m = /^(\d+)p$/.exec(name);
    return m ? -Number(m[1]) : name === "MP3" ? 1 : 2;
  };
  const keys = [];
  if (fc.Downloads) keys.push("Downloads");
  for (const g of VIDEO_GROUPS) {
    const subs = Object.keys(fc).filter((k) => k.startsWith(g + "/")).map((k) => k.slice(g.length + 1))
      .sort((a, b) => order(a) - order(b) || a.localeCompare(b));
    keys.push(...subs.map((f) => `${g}/${f}`));
    if (fc[g]) keys.push(g);
  }
  keys.push(...Object.keys(fc).filter((k) => !k.includes("/") && !known.has(k) && !VIDEO_GROUPS.includes(k)).sort((a, b) => a.localeCompare(b)));
  if (fc.Other) keys.push("Other");
  return keys.map((k) => ({ key: k, count: done.filter((d) => inFolder(d, k)).length }));
}

// ------------------------------------------------------------------- list

const isToday = (ts) => !!ts && new Date(ts).toDateString() === new Date().toDateString();
const byOrder = (a, b) => (a.order ?? a.created) - (b.order ?? b.created) || a.created - b.created;
const newest = (a, b) => (b.finished || b.created) - (a.finished || a.created);
// Running and paused files get a row with the segment bar. Waiting, finished and failed ones a 46px row.
// Files in a batch are short lines inside their batch.
const isFull = (d) => LIVE.has(d.status) || d.status === "paused";

// A section with more than CAP_OVER rows shows CAP_SHOW of them until the user asks for the rest.
const CAP_OVER = 12;
const CAP_SHOW = 8;
// The Downloads tab shows this many of today's finished files when nothing runs.
const TODAY_SHOW = 5;

// Opened "Show more" rows stay that way across restarts.
const prefs = (() => {
  try {
    const p = JSON.parse(localStorage.getItem("downy.list") || "{}");
    return { expanded: new Set(p.expanded || []) };
  } catch {
    return { expanded: new Set() };
  }
})();

function savePrefs() {
  try {
    localStorage.setItem("downy.list", JSON.stringify({ expanded: [...prefs.expanded] }));
  } catch {}
}

// "Today", "Yesterday", then "Monday 9 November".
function dayLabel(ts) {
  const d = new Date(ts);
  if (isToday(ts)) return "Today";
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

const batchGroup = (b) => ({ id: `batch-${b.id}`, key: "batch", batch: b, label: b.label, items: b.files });
// Batches that are over but have failed files stay in Downloads until they are retried or dismissed.
const batchShown = (b) => b.state !== "finished" || b.failed > 0;
// Failed files of the current or last run, outside batches, stay in Downloads too.
const runFailed = () => state.downloads.filter((d) => d.status === "error" && !d.batch && state.run?.ids.has(d.id)).sort(newest);

// The view of the main column: "busy" and "idle" are the Downloads tab with or without files to run.
function viewOf() {
  if (state.tab !== "downloads") return state.tab;
  return state.downloads.some(isActive) ? "busy" : "idle";
}

function groups(view) {
  if (view === "done") {
    const items = state.downloads.filter((d) => d.status === "done" && (!state.folder || inFolder(d, state.folder))).sort(newest);
    const days = new Map();
    for (const d of items) {
      const k = new Date(d.finished || d.created).toDateString();
      if (!days.has(k)) days.set(k, []);
      days.get(k).push(d);
    }
    return [...days.values()].map((list) => ({ id: `day-${list[0].finished || list[0].created}`, key: "day", label: dayLabel(list[0].finished || list[0].created), items: list }));
  }
  if (view === "failed") {
    const items = state.downloads.filter((d) => FAILED.has(d.status)).sort(newest);
    return items.length ? [{ id: "failed", key: "failed", label: "Failed", plain: true, items }] : [];
  }
  const loose = (test, sort) => state.downloads.filter((d) => !d.batch && test(d)).sort(sort);
  const shown = state.batchList.filter(batchShown);
  if (view === "busy") {
    // One list, no headings: running batches, running and paused files, waiting files, then what failed.
    return [
      ...shown.filter((b) => b.state === "running").map(batchGroup),
      { id: "live", key: "live", items: loose(isFull, byOrder) },
      { id: "waiting", key: "waiting", items: loose((d) => d.status === "queued", byOrder) },
      ...shown.filter((b) => b.state !== "running").map(batchGroup),
      { id: "run-failed", key: "run-failed", items: runFailed() },
    ].filter((g) => g.items.length);
  }
  // A file shows once: files of a batch still on screen stay in the batch.
  const inShown = new Set(shown.map((b) => b.id));
  const today = state.downloads.filter((d) => d.status === "done" && isToday(d.finished) && !inShown.has(d.batch)).sort(newest);
  return [
    ...shown.map(batchGroup),
    { id: "run-failed", key: "run-failed", label: "Didn't finish", items: runFailed() },
    { id: "today", key: "today", label: "Finished today", items: today.slice(0, TODAY_SHOW), all: today },
  ].filter((g) => g.items.length);
}

// ---------------------------------------------------------------- batches

const clock = (ts) => new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
// Batches come from the batch fields on each file, newest first.
function buildBatches() {
  const map = new Map();
  for (const d of state.downloads) {
    if (!d.batch) continue;
    if (!map.has(d.batch)) map.set(d.batch, { id: d.batch, at: d.batchAt, files: [] });
    map.get(d.batch).files.push(d);
  }
  state.batchPos = new Map();
  state.batchList = [...map.values()].map((b) => {
    b.files.sort((x, y) => x.batchIndex - y.batchIndex);
    const count = (test) => b.files.filter(test).length;
    b.saved = count((d) => d.status === "done");
    b.failed = count((d) => d.status === "error");
    b.cancelled = count((d) => d.status === "cancelled");
    b.waiting = count((d) => d.status === "queued");
    b.paused = count((d) => d.status === "paused");
    b.live = b.files.filter((d) => LIVE.has(d.status));
    b.mode = b.files[0].batchMode === "all" ? "all" : "one";
    b.state = b.live.length || b.waiting ? "running" : b.paused ? "paused" : "finished";
    const { label, cut } = batchName(b.files);
    b.label = label;
    b.short = (d) => (cut ? d.title.slice(cut) : d.title);
    const next = b.mode === "one" && b.files.find((d) => d.status === "queued");
    b.files.forEach((d, k) => state.batchPos.set(d.id, { k: k + 1, n: b.files.length, next: d === next }));
    return b;
  }).sort((x, y) => y.at - x.at);

  // A batch that just ended says so once. Batches that were already over at startup don't.
  for (const b of state.batchList) {
    const was = state.batchStates.get(b.id);
    if (was && was !== "finished" && b.state === "finished" && (b.saved || b.failed)) {
      toast(`${b.label} finished. ${b.saved} saved${b.failed ? `, ${b.failed} failed` : ""}`, false);
    }
  }
  state.batchStates = new Map(state.batchList.map((b) => [b.id, b.state]));
}

// Opens the folder the batch saved into, or the download folder when its files went to several places.
function openBatchFolder(b) {
  const dirs = new Set(b.files.filter((d) => d.status === "done").map(folderOf));
  const [dir] = dirs;
  if (dirs.size === 1 && dir !== "Other") call(downy.openFolder, dir);
  else if (dirs.size === 1) call(downy.reveal, b.files.find((d) => d.status === "done").id);
  else call(downy.openFolder);
}

// Brings a new batch into view once its files show up in the list.
function showBatch(id) {
  const tryShow = (n) => {
    const s = state.secs.get(`batch-${id}`);
    if (!s) return n > 0 && setTimeout(() => tryShow(n - 1), 150);
    s.el.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };
  tryShow(10);
}

// ------------------------------------------------------------- picking files

// Files of a batch that is still going stay in it.
const canPick = (d) => PICKABLE.has(d.status) && !(d.batch && state.batchList.find((b) => b.id === d.batch)?.state !== "finished");

// Pickable files in the order the list shows them, for shift click ranges.
function pickOrder() {
  return groups(viewOf()).flatMap((g) => g.items).filter(canPick).map((d) => d.id);
}

function startSelect(ids = []) {
  state.select = { ids: new Set(ids), anchor: null };
  render();
}

function endSelect() {
  state.select = null;
  render();
}

function togglePick(id, range) {
  const sel = state.select;
  if (!sel) return;
  const order = pickOrder();
  const a = order.indexOf(sel.anchor);
  const b = order.indexOf(id);
  if (range && a >= 0 && b >= 0) for (const x of order.slice(Math.min(a, b), Math.max(a, b) + 1)) sel.ids.add(x);
  else if (sel.ids.has(id)) sel.ids.delete(id);
  else sel.ids.add(id);
  sel.anchor = id;
  render();
}

function pickedFiles() {
  return state.select ? state.downloads.filter((d) => state.select.ids.has(d.id) && canPick(d)) : [];
}

function renderSelbar() {
  const bar = $("selbar");
  $("main").classList.toggle("selecting", !!state.select);
  bar.hidden = !state.select;
  if (!state.select) return;
  const picked = pickedFiles();
  const n = picked.length;
  $("selCount").textContent = n ? `${files(n)} picked` : "Pick files";
  const sizes = picked.map((d) => d.expected || 0);
  const total = sizes.every(Boolean) && n ? `${size(sizes.reduce((a, b) => a + b, 0))} in all. ` : "";
  $("selSub").textContent = n
    ? `${total}They run as a batch in the order they were added. A file that fails is skipped.`
    : "Click the files to download one by one. Shift click picks a range.";
  $("selBatch").disabled = !n;
  $("selResume").disabled = !n;
}

// mode "one" runs the picked files one at a time, "all" as many at once as the setting allows.
async function batchPicked(mode) {
  const ids = pickedFiles().map((d) => d.id);
  if (!ids.length) return;
  try {
    const id = await call(downy.startBatch, ids, mode);
    state.select = null;
    openTab("downloads");
    showBatch(id);
  } catch {}
}

// The tick box at the start of a row while picking. Clicks on it reach the row's own click handler.
function checkBox() {
  const b = el("button", "check");
  b.type = "button";
  b.setAttribute("role", "checkbox");
  b.innerHTML = icon("tick");
  return b;
}

function wirePick(r) {
  r.el.addEventListener("click", (e) => {
    if (!r.el.classList.contains("picking") || e.target.closest("button:not(.check)")) return;
    togglePick(r.el.dataset.id, e.shiftKey);
  });
}

function paintPick(r, d) {
  const picking = !!state.select && canPick(d);
  const on = picking && state.select.ids.has(d.id);
  r.el.classList.toggle("picking", picking);
  r.el.classList.toggle("checked", on);
  if (r.check) {
    r.check.setAttribute("aria-checked", String(on));
    r.check.setAttribute("aria-label", `Pick ${d.title}`);
    r.check.tabIndex = picking ? 0 : -1;
  }
}

// ------------------------------------------------------------ estimates

const left = (d) => Math.max(0, (d.expected || 0) - (d.downloaded || 0));

// The total download speed, smoothed so the time estimates don't jump with every update.
function trackSpeed() {
  const running = state.downloads.filter((d) => d.status === "downloading");
  const now = running.reduce((n, d) => n + (d.speed || 0), 0);
  state.speed = !running.length ? 0 : state.speed ? state.speed * 0.8 + now * 0.2 : now;
}

// When each waiting file should start and when the whole line should be done. Each running
// file gets an even share of the current speed, and a waiting file takes the first slot to
// free up. A file with no known size stops the estimate there. A batch keeps to one slot,
// so its files queue up behind each other there.
function estimate() {
  const live = state.downloads.filter((d) => LIVE.has(d.status));
  const running = live.filter((d) => d.status === "downloading");
  const starts = new Map();
  const batches = new Map(); // batch id -> seconds until its last file is done
  if (!state.speed || !running.length) return { starts, batches, done: null };
  const share = state.speed / running.length;
  const free = live.map((d) => (d.status !== "downloading" ? 0 : d.expected ? left(d) / share : Infinity));
  while (free.length < (state.settings?.maxActive || 1)) free.push(0);
  // A one-at-a-time batch keeps to one slot. An all-together batch runs like any other files.
  const serial = (d) => d.batch && d.batchMode !== "all";
  const slotOf = new Map(); // batch id -> the slot its files run in
  live.forEach((d, k) => serial(d) && slotOf.set(d.batch, k));
  const until = (id, s) => batches.set(id, Math.max(batches.get(id) ?? 0, s));
  const earliest = () => free.reduce((best, t, k) => (t < free[best] ? k : best), 0);
  const queued = state.downloads.filter((x) => x.status === "queued")
    .sort((a, b) => (a.batch && a.batch === b.batch ? a.batchIndex - b.batchIndex : byOrder(a, b)));
  for (const d of queued) {
    const k = serial(d) && slotOf.has(d.batch) ? slotOf.get(d.batch) : earliest();
    if (!isFinite(free[k])) {
      if (!d.batch) break;
      batches.set(d.batch, Infinity);
      continue;
    }
    starts.set(d.id, free[k]);
    free[k] += d.expected ? d.expected / share : Infinity;
    if (serial(d)) slotOf.set(d.batch, k);
    if (d.batch) until(d.batch, free[k]);
  }
  // A batch ends when its last file does, running or waiting.
  for (const d of live) if (d.batch) until(d.batch, free[live.indexOf(d)]);
  for (const [id, s] of batches) if (!isFinite(s)) batches.delete(id);
  const done = Math.max(...free);
  return { starts, batches, done: isFinite(done) ? done : null };
}

// "11 min" or "1 h 5 min" or "40 s".
function span(s) {
  s = Math.round(s);
  if (s < 60) return `${Math.max(1, s)} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

// Rounded so it does not tick every second: "in a moment", "in 30 s", "in 4 min".
function startsIn(s) {
  if (s < 10) return "in a moment";
  if (s < 60) return `in ${Math.round(s / 10) * 10} s`;
  return `in ${span(s)}`;
}

const suffix = (n) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
const place = (n) => (n === 1 ? "Next in line" : `${n}${suffix(n)} in line`);

// The time column of a finished row: the time today, then "Yesterday", then the date.
function shortWhen(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isToday(ts)) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

// ---------------------------------------------------------------- status

// The totals over the list, written on the sky: what runs, how long it takes, one bar for all of it.
// The files of the run stay on the bar until the line empties, so the bar fills from left to right.
function renderStatus(view, est) {
  const live = state.downloads.filter((d) => LIVE.has(d.status));
  const waiting = state.downloads.filter((d) => d.status === "queued");
  const paused = state.downloads.filter((d) => d.status === "paused");
  if (live.length || waiting.length) {
    if (!state.run || state.run.result) state.run = { ids: new Set(), started: Date.now(), result: null };
    for (const d of [...live, ...waiting]) state.run.ids.add(d.id);
  } else if (state.run && !state.run.result) state.run.result = runResult(state.run);

  const box = $("status");
  box.hidden = view !== "busy";
  if (view !== "busy") return;

  // Failed files leave the bar. They have their own line in the list.
  const rank = { done: 0, downloading: 1, merging: 1, converting: 1, paused: 2, queued: 3 };
  const startOf = (d) => est.starts.get(d.id) ?? Infinity;
  const bar = state.downloads.filter((d) => d.status in rank && (isActive(d) || state.run?.ids.has(d.id)))
    .sort((a, b) => rank[a.status] - rank[b.status] || startOf(a) - startOf(b) || byOrder(a, b));
  const known = bar.filter((d) => d.expected);
  const total = sum(known, (d) => d.expected);
  const got = sum(known, (d) => (d.status === "done" ? d.expected : Math.min(d.downloaded || 0, d.expected)));
  const togo = sum(bar.filter((d) => d.status !== "done"), left);
  const some = known.length < bar.length;

  let label, big;
  if (live.length) {
    label = `Downloading ${live.length} of ${files(bar.length)}`;
    big = est.done != null ? `About ${span(est.done)} left`
      : live.every((d) => d.status !== "downloading") ? "Finishing up" : "Starting";
  } else if (waiting.length) {
    label = `${files(waiting.length)} waiting`;
    big = "Starting";
  } else {
    label = `${files(paused.length)} paused`;
    big = "Paused";
  }
  box.dataset.state = live.length || waiting.length ? "running" : "paused";
  $("statusLabel").textContent = label;
  if ($("statusBig").textContent !== big) $("statusBig").textContent = big;
  const sub = [];
  if (state.speed && live.length) sub.push(`${size(state.speed)}/s`);
  if (togo) sub.push(`${some ? "at least " : ""}${size(togo)} to go`);
  $("statusSub").textContent = sub.join(", ");

  const act = $("statusAct");
  const running = live.length || waiting.length;
  const sig = running ? "pause" : "resume";
  if (act.dataset.sig !== sig) {
    const changed = !!act.dataset.sig;
    act.dataset.sig = sig;
    if (!act.querySelector(".lbl")) act.replaceChildren(el("span", "lbl"));
    act.querySelector(":scope > svg")?.remove();
    act.insertAdjacentHTML("afterbegin", icon(running ? "pause" : "play"));
    if (changed) popIcon(act);
    morph(act.querySelector(".lbl"), running ? "Pause all" : "Resume all");
    act.onclick = () => call(running ? downy.pauseAll : downy.resumeAll);
  }

  renderStrip($("total"), bar);
  $("total").setAttribute("aria-label", `${size(got)} of ${size(total)}, ${files(bar.length)}`);
  $("legendLeft").textContent = total ? `${size(got)} of ${some ? "at least " : ""}${size(total)}` : `${size(sum(bar, (d) => d.downloaded))} so far`;
  $("legendRight").textContent = files(bar.length);
}

// How a run ended. A run the user paused or cancelled has nothing to report.
function runResult(run) {
  const list = state.downloads.filter((d) => run.ids.has(d.id));
  if (list.some((d) => d.status === "paused")) return null;
  const done = list.filter((d) => d.status === "done");
  const failed = list.filter((d) => d.status === "error").length;
  if (!done.length && !failed) return null;
  return { saved: done.length, failed };
}

// A pixel bar with one block per file, each as wide as its file is big. A running
// block fills with its file's progress.
function renderStrip(bar, list) {
  if (bar.dataset.mode !== "strip") {
    bar.dataset.mode = "strip";
    bar.className = "segbar strip" + (bar.id === "total" ? " total" : "");
    bar.replaceChildren();
  }
  while (bar.children.length > list.length) bar.lastChild.remove();
  while (bar.children.length < list.length) bar.append(el("i"));
  const sizes = list.map((d) => d.expected).filter(Boolean);
  const avg = sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 1;
  list.forEach((d, k) => {
    const block = bar.children[k];
    const cls = d.status === "done" ? "ok" : d.status === "error" ? "bad" : d.status === "cancelled" ? "off" : LIVE.has(d.status) ? "now" : d.status === "paused" ? "held" : "";
    if (block.className !== cls) {
      block.className = cls;
      block.replaceChildren(...(cls === "now" || cls === "held" ? [el("b")] : []));
    }
    block.style.flexGrow = String((d.expected || avg) / avg);
    if (cls === "now" || cls === "held") block.firstChild.style.width = `${Math.round((d.status === "downloading" || d.status === "paused" ? d.progress : 1) * 100)}%`;
    block.title = d.title;
  });
}

// --------------------------------------------------------- tops and feet

// The top of the Finished and Failed tabs: a title, the totals, buttons, and on Finished the folders.
function renderViewHead(view) {
  const head = $("viewHead");
  head.hidden = view !== "done" && view !== "failed";
  if (head.hidden) return;
  const done = state.downloads.filter((d) => d.status === "done");
  const items = view === "done" ? done.filter((d) => !state.folder || inFolder(d, state.folder)) : state.downloads.filter((d) => FAILED.has(d.status));
  $("viewTitle").textContent = view === "done" ? (state.folder ? folderLabel(state.folder) : "Finished") : "Failed";
  const bytes = view === "done" ? sum(items, (d) => d.expected) : 0;
  $("viewMeta").textContent = items.length ? [files(items.length), bytes ? size(bytes) : ""].filter(Boolean).join(", ") : "";

  const a = [];
  const ids = () => items.map((d) => d.id);
  const pickable = items.filter(canPick);
  if (state.select) {
    if (pickable.length) {
      const all = pickable.every((d) => state.select.ids.has(d.id));
      a.push([all ? "Pick none" : "Pick all", "checkSquare", () => {
        for (const d of pickable) all ? state.select.ids.delete(d.id) : state.select.ids.add(d.id);
        render();
      }]);
    }
  } else if (view === "failed") {
    const errors = items.filter((d) => d.status === "error");
    if (errors.length) a.push([errors.length > 1 ? "Retry all" : "Retry", "retry", () => errors.forEach((d) => call(downy.resume, d.id).catch(() => {}))]);
    if (pickable.length > 1) a.push(["Download one by one", "list", () => startSelect(pickable.map((d) => d.id))]);
    if (items.length) a.push(["Clear from list", "trash", () => call(downy.remove, ids())]);
  } else {
    if (state.folder !== "Other") a.push(["Open folder", "folder", () => call(downy.openFolder, state.folder || undefined)]);
    if (items.length) a.push(["Clear from list", "trash", () => call(downy.remove, ids())]);
  }
  setActs($("viewActs"), a);

  const chips = $("folderChips");
  const keys = view === "done" ? folderKeys(done) : [];
  chips.hidden = keys.length < 2;
  if (chips.hidden) return;
  const sig = keys.map((k) => `${k.key}:${k.count}`).join("|") + "@" + state.folder;
  if (chips.dataset.sig === sig) return;
  chips.dataset.sig = sig;
  const chip = (key, label, count) => {
    const b = el("button", "chip", label);
    b.type = "button";
    if (count != null) b.append(el("span", "n", String(count)));
    b.setAttribute("aria-pressed", String(state.folder === key));
    b.onclick = () => openTab("done", key);
    return b;
  };
  chips.replaceChildren(chip(null, "All folders"), ...keys.map((k) => chip(k.key, folderLabel(k.key), k.count)));
}

// Buttons in a header, rebuilt only when their labels change.
function setActs(box, a) {
  const sig = a.map((x) => x[0]).join("|");
  box._fns = a.map((x) => x[2]);
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.replaceChildren(...a.map(([label, ic], k) => {
    const b = el("button", "sec-act");
    b.type = "button";
    if (ic) b.innerHTML = icon(ic);
    b.append(label);
    b.onclick = () => box._fns[k]();
    return b;
  }));
}

// Under the list while files run: what finished today, and a way to pick files for a batch.
function renderFoot(view) {
  const foot = $("foot");
  const today = state.downloads.filter((d) => d.status === "done" && isToday(d.finished));
  const pickable = view === "busy" && !state.select ? groups(view).flatMap((g) => g.items).filter(canPick) : [];
  // With files running, Resume all is not on the status, so paused files get it here.
  const running = state.downloads.some((d) => LIVE.has(d.status) || d.status === "queued");
  const paused = running && !state.select ? state.downloads.filter((d) => d.status === "paused").length : 0;
  foot.hidden = view !== "busy" || (!today.length && pickable.length < 2 && !paused);
  if (foot.hidden) return;
  const sig = `${today.length}|${sum(today, (d) => d.expected)}|${pickable.length > 1}|${paused}`;
  foot._pick = pickable;
  if (foot.dataset.sig === sig) return;
  foot.dataset.sig = sig;
  const parts = [];
  if (today.length) {
    const tick = el("span", "foot-ic");
    tick.innerHTML = icon("check");
    const show = el("button", "link", "Show in Finished");
    show.type = "button";
    show.onclick = () => openTab("done");
    parts.push(tick, el("b", "", `${today.length} finished today`), el("span", "", size(sum(today, (d) => d.expected))), show);
  }
  parts.push(el("span", "foot-gap"));
  if (paused) {
    const b = el("button", "sec-act");
    b.type = "button";
    b.innerHTML = icon("play");
    b.append(`Resume ${paused} paused`);
    b.onclick = () => call(downy.resumeAll);
    parts.push(b);
  }
  if (pickable.length > 1) {
    const b = el("button", "sec-act");
    b.type = "button";
    b.innerHTML = icon("list");
    b.append("Download one by one");
    b.title = "Pick waiting, paused or failed files and run them as a batch";
    b.onclick = () => startSelect(foot._pick.map((d) => d.id));
    parts.push(b);
  }
  foot.replaceChildren(...parts);
}

// ------------------------------------------------------------- sections

function makeSection(g) {
  const s = { el: el("section", "sec"), group: g };
  s.el.dataset.sec = g.id;
  s.head = el("div", "sec-head");
  s.title = el("h2", "sec-title");
  s.label = el("span");
  s.count = el("span", "sec-count");
  s.title.append(s.label, " ", s.count);
  s.meta = el("span", "sec-meta");
  s.acts = el("span", "sec-acts");
  s.head.append(s.title, s.meta, s.acts);
  s.body = el("div", "sec-body");
  // A batch holds its own row, then a short line per file.
  if (g.batch) {
    s.batch = makeBatchRow();
    s.body.append(s.batch.el);
  }
  s.rows = el("div", "rows");
  s.rows.setAttribute("role", "list");
  s.body.append(s.rows);
  s.more = el("button", "more");
  s.more.type = "button";
  s.more.onclick = () => {
    const id = s.group.id;
    if (prefs.expanded.has(id)) prefs.expanded.delete(id);
    else prefs.expanded.add(id);
    savePrefs();
    render();
  };
  s.el.append(s.head, s.body);
  return s;
}

function sectionActions(s) {
  const g = s.group;
  const a = [];
  if (!state.select && g.key === "run-failed") {
    a.push([g.items.length > 1 ? "Retry all" : "Retry", "retry", () => s.group.items.forEach((d) => call(downy.resume, d.id).catch(() => {}))]);
    a.push(["Clear from list", "trash", () => call(downy.remove, s.group.items.map((d) => d.id))]);
  }
  if (g.key === "today") {
    const done = state.downloads.filter((d) => d.status === "done").length;
    a.push([done > g.items.length ? `See all ${done}` : "Show in Finished", "", () => openTab("done")]);
  }
  setActs(s.acts, a);
}

function updateSection(s, g, headless) {
  s.group = g;
  s.el.dataset.key = g.key;
  s.head.hidden = headless || g.plain || g.batch;
  if (s.head.hidden) return;
  s.label.textContent = g.label;
  const total = g.all || g.items;
  s.count.textContent = g.key === "today" ? "" : String(total.length);
  const bytes = sum(total, (d) => d.expected);
  const meta = g.key === "today" ? [files(total.length), size(bytes)].join(", ") : g.key === "day" && bytes ? size(bytes) : "";
  if (s.meta.textContent !== meta) s.meta.textContent = meta;
  s.meta.hidden = !meta;
  sectionActions(s);
}

// ------------------------------------------------------------------ render

function render() {
  buildBatches();
  if (state.select) {
    // Files that can't be picked any more, or are gone, drop out of the picked set.
    const ok = new Set(state.downloads.filter(canPick).map((d) => d.id));
    for (const id of state.select.ids) if (!ok.has(id)) state.select.ids.delete(id);
    if (!state.downloads.length) state.select = null;
  }
  const view = viewOf();
  const main = $("main");
  main.dataset.view = view;
  const est = estimate();
  renderTabs();
  renderStatus(view, est);
  renderViewHead(view);
  renderSelbar();
  renderFoot(view);

  const gs = groups(view);
  const list = $("list");
  // While files run, everything is one list. Elsewhere each section has a heading and its own panel.
  const joined = view === "busy";
  list.classList.toggle("joined", joined);
  const seenRows = new Set();
  const seenSecs = new Set();
  let prevSec = null;
  for (const g of gs) {
    let s = state.secs.get(g.id);
    if (s && !!s.batch !== !!g.batch) {
      s.el.remove();
      s = null;
    }
    if (!s) {
      s = makeSection(g);
      state.secs.set(g.id, s);
    }
    seenSecs.add(g.id);
    const want = prevSec ? prevSec.nextSibling : list.firstChild;
    if (want !== s.el) list.insertBefore(s.el, want);
    prevSec = s.el;
    updateSection(s, g, joined);
    if (g.batch) updateBatchRow(s.batch, g.batch, est);

    const items = g.items;
    const long = items.length > CAP_OVER;
    const capped = long && !prefs.expanded.has(g.id);
    const shown = capped ? items.slice(0, CAP_SHOW) : items;
    // While a row is being dragged, its section keeps the order the user is making.
    placeRows(s.rows, shown, g, est, seenRows, drag && drag.container === s.rows);
    s.rows.dataset.firstHidden = capped ? items[CAP_SHOW].id : "";
    s.rows.setAttribute("aria-label", g.label || g.batch?.label || "Downloads");
    if (long) {
      s.more.innerHTML = icon("chevron");
      s.more.classList.toggle("open", !capped);
      s.more.append(capped ? `Show ${items.length - CAP_SHOW} more` : "Show fewer");
      if (s.rows.lastChild !== s.more) s.rows.append(s.more);
    } else s.more.remove();
  }
  for (const [id, s] of state.secs) {
    if (seenSecs.has(id)) continue;
    s.el.remove();
    state.secs.delete(id);
  }
  for (const [id, r] of state.rows) {
    if (seenRows.has(id)) continue;
    r.el.remove();
    state.rows.delete(id);
  }

  const empty = $("listEmpty");
  empty.hidden = gs.length > 0 || view === "idle";
  if (!empty.hidden) {
    empty.textContent = view === "failed" ? "No failed downloads." : state.folder ? "Nothing in this folder yet." : "No finished downloads yet.";
  }
  // A row that moved in the list loses focus, so a keyboard move gives it back.
  if (state.refocus) {
    if (state.refocus.isConnected && document.activeElement !== state.refocus) state.refocus.focus({ preventScroll: true });
    state.refocus = null;
  }
}

// Puts the rows for `items` into `box` in order, making or reusing each one.
function placeRows(box, items, g, est, seen, frozen) {
  let prev = null;
  let place = 0; // a waiting file's place in line; batch files have their place in the batch instead
  for (const d of items) {
    const kind = g.batch ? "part" : isFull(d) ? "full" : "mini";
    let r = state.rows.get(d.id);
    if (r && r.kind !== kind) {
      r.el.remove();
      r = null;
    }
    if (!r) {
      r = kind === "full" ? makeRow(d) : kind === "part" ? makePart(d) : makeMini(d);
      state.rows.set(d.id, r);
    }
    if (d.status === "queued" && !d.batch) place++;
    if (kind === "full") updateRow(r, d);
    else if (kind === "part") updatePart(r, d, g.batch);
    else updateMini(r, d, { place, start: est.starts.get(d.id) });
    seen.add(d.id);
    if (!frozen || !r.el.isConnected) {
      const at = prev ? prev.nextSibling : box.firstChild;
      if (at !== r.el) box.insertBefore(r.el, at);
    }
    prev = r.el;
  }
}

// ---------------------------------------------------------------- rows

// Fills a thumbnail box: the video's picture with its format, a file tile with its
// extension, or a tile with an icon when a video has no picture.
function paintThumb(box, d) {
  box.replaceChildren();
  box.className = "thumb";
  const blank = () => {
    box.classList.add("blank");
    box.insertAdjacentHTML("afterbegin", icon(d.kind === "mp3" || d.kind === "m4a" ? "music" : "video"));
  };
  if (d.kind === "file") {
    box.classList.add("file");
    box.textContent = (d.ext || "file").toUpperCase().slice(0, 4);
    return;
  }
  if (d.thumbnail) {
    const img = el("img");
    img.alt = "";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => {
      img.remove();
      blank();
    };
    img.src = d.thumbnail;
    box.append(img);
  } else blank();
  if (d.folder) box.append(el("span", "kind", d.folder));
}

const thumbSig = (d) => [d.kind, d.thumbnail, d.ext, d.folder].join("|");

function paintThumbOnce(r, d) {
  if (r.thumbSig === thumbSig(d)) return;
  r.thumbSig = thumbSig(d);
  paintThumb(r.thumb, d);
}

function actionButton(label, ic, fn, cls = "") {
  const b = el("button", "icon-btn " + cls);
  b.type = "button";
  b.innerHTML = icon(ic);
  b.title = label;
  b.setAttribute("aria-label", label);
  b.onclick = (e) => {
    e.stopPropagation();
    fn();
  };
  return b;
}

function textButton(label, ic, fn, cls = "") {
  const b = el("button", "btn " + cls);
  b.type = "button";
  b.innerHTML = icon(ic);
  b.append(label);
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
    case "done": return ["check", `Saved to ${savedIn(d)}`];
    case "cancelled": return ["x", "Cancelled"];
    case "error": return ["alert", d.error || "Download failed"];
  }
  return ["loader", d.status];
}

// The details a running row leaves out, for its tooltip.
function rowDetails(d) {
  const parts = [statusLine(d)[1]];
  if (d.clip) parts.push(`Clip ${formatTime(d.clip.start)} to ${formatTime(d.clip.end)}`);
  if (d.status === "downloading") {
    if (d.connections) parts.push(`${d.connections} ${d.connections === 1 ? "connection" : "connections"}`);
    if (d.stream && d.stream.count > 1) parts.push(`${d.stream.role === "audio" ? "Audio" : "Video"}, part ${d.stream.index} of ${d.stream.count}`);
    parts.push(`${Math.floor(d.progress * 100)}%`);
  }
  if (d.status === "paused" && !(d.kind === "file" && d.resumable === false)) parts.push("Resumes where it stopped");
  return parts.join(", ");
}

// A running or paused file: picture, name, speed and time left, and its pixel bar.
function makeRow(d) {
  const r = { kind: "full", el: el("article", "row") };
  r.el.setAttribute("role", "listitem");
  r.el.dataset.id = d.id;
  r.check = checkBox();
  r.thumb = el("div", "thumb");
  r.lead = el("div", "lead");
  r.lead.append(r.check, r.thumb);
  r.title = el("h3", "row-title");
  r.rate = el("div", "rate");
  const top = el("div", "row-top");
  top.append(r.title, r.rate);
  r.bar = el("div", "segbar");
  const body = el("div", "row-body");
  body.append(top, r.bar);
  r.actions = el("div", "actions");
  r.el.append(r.lead, body, r.actions);
  wirePick(r);
  return r;
}

function updateRow(r, d) {
  r.el.dataset.status = d.status;
  paintPick(r, d);
  paintThumbOnce(r, d);
  const sig = [d.status, d.title].join("|");
  if (r.sig !== sig) {
    r.sig = sig;
    r.title.textContent = d.title;
    r.title.title = d.title;
    renderActions(r, d);
  }
  const rate = [];
  if (d.status === "downloading") {
    rate.push(el("b", "", d.speed ? `${size(d.speed)}/s` : d.indeterminate ? "Fetching the clip" : "Connecting"));
    if (d.speed) rate.push(el("span", "", eta(d.eta)));
  } else rate.push(el("span", "", statusLine(d)[1]));
  r.rate.replaceChildren(...rate);
  r.rate.title = rowDetails(d);
  renderBar(r, d);
}

// A waiting, finished or failed file on one short line.
function makeMini(d) {
  const r = { kind: "mini", el: el("div", "mini") };
  r.el.setAttribute("role", "listitem");
  r.el.dataset.id = d.id;
  r.check = checkBox();
  r.thumb = el("div", "thumb");
  r.grip = el("span", "grip");
  r.grip.innerHTML = icon("grip");
  r.grip.title = "Drag to change the order. With the keyboard, press Alt with the up or down arrow.";
  const wrap = el("div", "thumb-wrap");
  wrap.append(r.thumb, r.grip);
  r.lead = el("div", "lead");
  r.lead.append(r.check, wrap);
  r.title = el("p", "mini-title");
  r.state = el("div", "mini-state");
  r.size = el("span", "mini-size");
  r.end = el("div", "mini-end");
  r.when = el("span", "mini-when");
  r.actions = el("div", "actions");
  r.end.append(r.when, r.actions);
  r.el.append(r.lead, r.title, r.state, r.size, r.end);
  r.el.addEventListener("dblclick", (e) => {
    if (r.el.dataset.status === "done" && !e.target.closest("button")) call(downy.openFile, d.id);
  });
  r.el.addEventListener("keydown", (e) => queueKeys(e, r));
  wireDrag(r);
  wirePick(r);
  return r;
}

// ctx.place is the row's place in its section, ctx.start the seconds until a waiting file starts.
function updateMini(r, d, ctx) {
  r.el.dataset.status = d.status;
  const movable = d.status === "queued" && !d.batch && !state.select;
  r.el.draggable = movable;
  r.el.classList.toggle("movable", movable);
  r.el.tabIndex = movable ? 0 : -1;
  if (movable) r.el.setAttribute("aria-description", "Press Alt with the up or down arrow to change the order");
  else r.el.removeAttribute("aria-description");
  paintPick(r, d);
  paintThumbOnce(r, d);
  const sig = [d.status, d.title].join("|");
  if (r.sig !== sig) {
    r.sig = sig;
    r.title.textContent = d.title;
    r.title.title = d.title;
    renderActions(r, d);
    r.stateKey = null;
  }

  let key;
  if (d.status === "queued") key = `q|${ctx.place}`;
  else if (d.status === "done") key = `d|${savedIn(d)}`;
  else key = `${d.status}|${d.error}`;
  if (r.stateKey !== key) {
    r.stateKey = key;
    if (d.status === "queued") setPlace(r, ctx.place);
    else {
      const [ic, text] = statusLine(d);
      r.state.innerHTML = d.status === "done" ? "" : icon(ic);
      r.state.append(el("span", "", text));
      r.state.title = d.status === "error" ? text : "";
    }
  }

  const sz = FAILED.has(d.status) ? "" : d.expected ? size(d.expected) : "";
  if (r.size.textContent !== sz) r.size.textContent = sz;
  let when = "";
  if (d.status === "done") when = shortWhen(d.finished);
  else if (d.status === "queued" && ctx.start != null) when = startsIn(ctx.start);
  if (r.when.textContent !== when) {
    r.when.textContent = when;
    r.when.title = d.status === "queued" && when ? `Starts ${when.replace(/^in /, "in about ")} at the current speed` : "";
  }
}

// Shows a waiting row's place in line. Only the next file gets a chip.
function setPlace(r, n) {
  const p = el("span", "pos" + (n === 1 ? " next" : ""), place(n));
  r.state.replaceChildren(p);
  r.state.title = "";
  const top = r.actions.querySelector("[data-act=top]");
  if (top) top.hidden = n === 1;
}

function renderActions(r, d) {
  const a = [];
  const id = d.id;
  if (d.status === "queued") {
    if (!d.batch) {
      const top = actionButton("Move to top", "toTop", () => call(downy.moveToTop, id));
      top.dataset.act = "top";
      a.push(top);
    }
    a.push(actionButton("Pause", "pause", () => call(downy.pause, id)));
    a.push(actionButton("Cancel download", "x", () => call(downy.cancel, id), "danger"));
  } else if (d.status === "downloading") {
    a.push(actionButton("Pause", "pause", () => call(downy.pause, id)));
    a.push(actionButton("Cancel download", "x", () => call(downy.cancel, id), "danger"));
  } else if (d.status === "paused") {
    a.push(actionButton("Resume", "play", () => call(downy.resume, id)));
    a.push(actionButton("Cancel download", "x", () => call(downy.cancel, id), "danger"));
  } else if (d.status === "error") {
    a.push(textButton("Retry", "retry", () => call(downy.resume, id)));
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

// One block per connection: each block is that connection's part of the file.
function renderBar(r, d) {
  const bar = r.bar;
  if (bar.dataset.mode !== "segs") {
    bar.dataset.mode = "segs";
    bar.className = "segbar";
    bar.replaceChildren();
  }
  const showBar = ["downloading", "paused", "queued", "merging", "converting"].includes(d.status);
  bar.hidden = !showBar;
  if (!showBar) return;
  const post = d.status === "merging" || d.status === "converting";
  bar.classList.toggle("post", post);
  bar.classList.toggle("paused", d.status === "paused" || d.status === "queued");
  bar.classList.toggle("wait", !!d.indeterminate);
  const segs = post ? [{ s: 0, e: 1, p: d.postProgress || 0, live: true }]
    : d.segments.length ? d.segments : [{ s: 0, e: 1, p: d.progress, live: false }];
  if (bar.children.length !== segs.length) {
    bar.replaceChildren(...segs.map(() => {
      const i = el("i", "seg");
      i.append(el("b"));
      return i;
    }));
  }
  segs.forEach((s, idx) => {
    const node = bar.children[idx];
    node.style.left = `${s.s * 100}%`;
    node.style.width = `${(s.e - s.s) * 100}%`;
    const width = s.e - s.s || 1;
    const fill = Math.max(0, Math.min(1, (s.p - s.s) / width));
    node.firstChild.style.width = `${fill * 100}%`;
    node.classList.toggle("live", !!s.live && d.status === "downloading");
    node.classList.toggle("full", fill >= 1);
  });
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  bar.setAttribute("aria-valuenow", String(Math.round((post ? d.postProgress : d.progress) * 100)));
  bar.setAttribute("aria-label", `${d.title} progress`);
}

// ------------------------------------------------------------- batch rows

// A batch is one row named after its files. Its files are short lines under it.
function makeBatchRow() {
  const c = { el: el("div", "row batch-row") };
  c.thumb = el("div", "thumb");
  c.count = el("span", "count");
  const lead = el("div", "lead");
  const wrap = el("div", "thumb-wrap");
  wrap.append(c.thumb, c.count);
  lead.append(wrap);
  c.title = el("h3", "row-title");
  c.rate = el("div", "rate");
  const top = el("div", "row-top");
  top.append(c.title, c.rate);
  c.bar = el("div", "segbar");
  const body = el("div", "row-body");
  body.append(top, c.bar);
  c.actions = el("div", "actions");
  c.el.append(lead, body, c.actions);
  return c;
}

function updateBatchRow(c, b, est) {
  const n = b.files.length;
  c.el.dataset.state = b.state;
  // The picture is the running file's, else the first one's.
  const face = b.live[0] || b.files[0];
  paintThumbOnce(c, face);
  c.count.textContent = String(n);
  if (c.title.textContent !== b.label) c.title.textContent = b.label;
  c.title.title = `${files(n)}, ${b.mode === "all" ? "all together" : "one at a time"}. Started ${clock(b.at)}.`;

  const through = b.saved + b.failed + b.cancelled;
  const rate = [];
  if (b.state === "running") {
    const speed = sum(b.live, (d) => d.speed);
    const left = est.batches.get(b.id);
    rate.push(el("b", "", speed ? `${size(speed)}/s` : b.live.length ? "Connecting" : "Waiting"));
    const pos = b.mode === "one" && b.live.length === 1 ? `file ${state.batchPos.get(b.live[0].id).k} of ${n}` : `${through} of ${n} done`;
    rate.push(el("span", "", left != null ? `${span(left)} left, ${pos}` : pos));
  } else if (b.state === "paused") {
    rate.push(el("span", "held", `Paused, ${through} of ${n} through`));
  } else {
    if (b.saved) rate.push(el("span", "ok", `${b.saved} saved`));
    if (b.failed) rate.push(el("span", "bad", `${b.failed} failed`));
    if (!b.saved && !b.failed) rate.push(el("span", "", "Cancelled"));
  }
  c.rate.replaceChildren(...rate);

  // With one file in progress the bar is that file's connections, like a running row.
  // Otherwise it has a block per file.
  const going = b.files.filter((d) => LIVE.has(d.status) || (d.status === "paused" && d.progress > 0));
  if (b.state !== "finished" && going.length === 1) renderBar(c, going[0]);
  else {
    c.bar.hidden = false;
    renderStrip(c.bar, b.files);
    c.bar.setAttribute("role", "img");
    c.bar.setAttribute("aria-label", `${b.saved} of ${n} saved, ${b.failed} failed`);
  }

  const acts = [];
  if (b.state === "running") {
    acts.push(["Pause batch", "pause", "", () => call(downy.pauseBatch, b.id)]);
    acts.push(["Cancel batch", "x", "danger", () => call(downy.cancelBatch, b.id)]);
  } else if (b.state === "paused") {
    acts.push(["Resume batch", "play", "", () => call(downy.resumeBatch, b.id)]);
    acts.push(["Cancel batch", "x", "danger", () => call(downy.cancelBatch, b.id)]);
  } else {
    if (b.failed) acts.push(["Retry failed", "retry", "text", () => call(downy.retryBatch, b.id)]);
    if (b.saved) acts.push(["Open folder", "folder", "", () => openBatchFolder(b)]);
    acts.push(["Dismiss", "x", "", () => call(downy.dismissBatch, b.id)]);
  }
  const sig = acts.map((a) => a[0]).join("|");
  c.fns = acts.map((a) => a[3]);
  if (c.actsSig !== sig) {
    c.actsSig = sig;
    c.actions.replaceChildren(...acts.map(([label, ic, cls], k) => (cls === "text"
      ? textButton(label, ic, () => c.fns[k]())
      : actionButton(label, ic, () => c.fns[k](), cls))));
  }
}

// A file inside a batch: its place, the part of its name that differs, and only what differs about it.
function makePart(d) {
  const r = { kind: "part", el: el("div", "part") };
  r.el.setAttribute("role", "listitem");
  r.el.dataset.id = d.id;
  r.check = checkBox();
  r.k = el("span", "k");
  const lead = el("span", "lead");
  lead.append(r.check, r.k);
  r.title = el("p", "part-title");
  r.state = el("span", "part-state");
  r.right = el("span", "part-right");
  r.actions = el("div", "actions");
  const end = el("div", "part-end");
  end.append(r.right, r.actions);
  r.el.append(lead, r.title, r.state, end);
  r.el.addEventListener("dblclick", (e) => {
    if (r.el.dataset.status === "done" && !e.target.closest("button")) call(downy.openFile, d.id);
  });
  wirePick(r);
  return r;
}

function updatePart(r, d, b) {
  r.el.dataset.status = d.status;
  paintPick(r, d);
  const bp = state.batchPos.get(d.id);
  r.k.textContent = String(bp?.k ?? "");
  const name = b.short(d);
  if (r.title.textContent !== name) {
    r.title.textContent = name;
    r.title.title = d.title;
  }
  const pct = `${Math.floor(d.progress * 100)}%`;
  let st;
  if (d.status === "downloading") st = d.expected ? sizeOf(d.downloaded, d.expected) : `${size(d.downloaded)} so far`;
  else if (d.status === "queued") st = bp?.next ? "next" : "Waiting";
  else if (d.status === "done") st = "Saved";
  else st = statusLine(d)[1];
  const key = `${d.status}|${st}`;
  if (r.stateKey !== key) {
    r.stateKey = key;
    if (st === "next") r.state.replaceChildren(el("span", "pos next", "Next"));
    else r.state.textContent = st;
    r.state.title = d.status === "error" ? st : "";
    r.actions.replaceChildren(...(d.status === "done"
      ? [actionButton("Open file", "play", () => call(downy.openFile, d.id)), actionButton("Show in folder", "folder", () => call(downy.reveal, d.id))]
      : d.status === "error" ? [actionButton("Try again", "retry", () => call(downy.resume, d.id))] : []));
  }
  const right = d.status === "downloading" ? pct : FAILED.has(d.status) ? "" : d.expected ? size(d.expected) : "";
  if (r.right.textContent !== right) r.right.textContent = right;
}

// ------------------------------------------------------- queue reordering

// The row being dragged: { id, el, container, before } where before is the id it started in front of.
let drag = null;

const nextRow = (row) => {
  let n = row.nextElementSibling;
  while (n && !n.classList.contains("mini")) n = n.nextElementSibling;
  return n;
};
// The id a row sits in front of. After the last shown row of a long section, that is the first hidden one.
const beforeOf = (row) => nextRow(row)?.dataset.id || row.parentElement?.dataset.firstHidden || null;

function wireDrag(r) {
  r.el.addEventListener("dragstart", (e) => {
    if (r.el.dataset.status !== "queued") return e.preventDefault();
    drag = { id: r.el.dataset.id, el: r.el, container: r.el.parentElement, before: beforeOf(r.el) };
    r.el.classList.add("lifted");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-downy-row", drag.id);
  });
  r.el.addEventListener("dragover", (e) => {
    if (!drag || r.el === drag.el || r.el.parentElement !== drag.container || r.el.dataset.status !== "queued") return;
    e.preventDefault();
    const box = r.el.getBoundingClientRect();
    const target = e.clientY < box.top + box.height / 2 ? r.el : r.el.nextElementSibling;
    if (target === drag.el || target === drag.el.nextElementSibling) return;
    drag.container.insertBefore(drag.el, target);
    // Places follow the new order while the row moves.
    [...drag.container.querySelectorAll(".mini[data-status=queued]")].forEach((row, k) => {
      const rr = state.rows.get(row.dataset.id);
      if (rr) {
        setPlace(rr, k + 1);
        rr.stateKey = null;
      }
    });
  });
  r.el.addEventListener("dragend", () => {
    const d = drag;
    drag = null;
    if (!d) return;
    d.el.classList.remove("lifted");
    const before = beforeOf(d.el);
    if (before === d.before) return render();
    call(downy.move, d.id, before).catch(() => {}).finally(render);
  });
}

// Alt with the up or down arrow moves a waiting file one place.
function queueKeys(e, r) {
  if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown") || r.el.dataset.status !== "queued") return;
  e.preventDefault();
  const q = state.downloads.filter((d) => d.status === "queued" && !d.batch).sort(byOrder);
  const i = q.findIndex((d) => d.id === r.el.dataset.id);
  if (i < 0 || (e.key === "ArrowUp" && i === 0) || (e.key === "ArrowDown" && i === q.length - 1)) return;
  const before = e.key === "ArrowUp" ? q[i - 1] : q[i + 2];
  state.refocus = document.activeElement;
  call(downy.move, r.el.dataset.id, before ? before.id : null).catch(() => {});
}

// --------------------------------------------------------------- composer

// A hint with a problem or a check in progress stays visible in the one-line composer.
function setHint(text, bad = false, ic = "link") {
  const h = $("composerHint");
  h.className = "hint" + (bad ? " bad" : ic === "loader" ? " busy" : "");
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
    state.tab = "downloads";
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
  popIcon(send);
  setHint("Reading formats from YouTube", false, "loader");
  try {
    const res = await downy.formats(url);
    if (req !== formatsRequest || $("url").value.trim() !== url) return;
    if (!res.ok) {
      setHint(res.error, true, "alert");
      return;
    }
    state.picker = { url, info: res.data, trim: false, from: "0:00", to: res.data.duration ? formatTime(res.data.duration) : "", clip: null, error: "", run: Promise.resolve(), seq: 0 };
    renderPicker();
    defaultHint();
  } finally {
    // A newer request owns the button now, and an error from this stale one is dropped.
    // eslint-disable-next-line no-unsafe-finally
    if (req !== formatsRequest) return;
    send.disabled = false;
    send.classList.remove("busy");
    send.dataset.icon = "arrowUp";
    paintIcons(send.parentElement);
    popIcon(send);
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
  const trim = el("button", "link pick-trim", state.picker.trim ? "Whole video" : "Trim");
  trim.type = "button";
  trim.setAttribute("aria-expanded", String(state.picker.trim));
  trim.onclick = toggleTrim;
  head.append(img, txt, trim);

  const groups = [
    ["Video", info.options.filter((o) => o.kind === "video")],
    ["Audio only", info.options.filter((o) => o.kind !== "video")],
  ];
  const parts = [head];
  if (state.picker.trim) parts.push(clipRow());
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
  if (state.picker.trim) {
    paintClip();
    return;
  }
  p.querySelector(".pick")?.focus();
}

// The From and To boxes. The app checks the range, so there is one parser.
function clipRow() {
  const row = el("div", "pick-clip");
  for (const [label, key] of [["From", "from"], ["To", "to"]]) {
    const field = el("label", "pick-field");
    const input = el("input");
    input.value = state.picker[key];
    input.inputMode = "numeric";
    input.spellcheck = false;
    input.setAttribute("aria-label", `${label} time`);
    input.id = `pickClip${label}`;
    input.oninput = () => {
      state.picker[key] = input.value;
      checkClip();
    };
    // Enter here must not read the link again, which would close the picker.
    input.onkeydown = (e) => e.key === "Enter" && e.preventDefault();
    field.append(el("span", "", label), input);
    row.append(field);
  }
  const note = el("p", "pick-note");
  note.id = "pickClipNote";
  note.setAttribute("aria-live", "polite");
  row.append(note);
  return row;
}

function toggleTrim() {
  const p = state.picker;
  p.trim = !p.trim;
  p.seq++;
  p.clip = null;
  p.error = "";
  p.run = Promise.resolve();
  renderPicker();
  if (p.trim) {
    checkClip();
    $("pickClipFrom").focus();
    $("pickClipFrom").select();
  }
}

function checkClip() {
  const p = state.picker;
  const seq = ++p.seq;
  p.run = (async () => {
    const from = parseTime(p.from);
    const to = parseTime(p.to);
    let result;
    if (from == null || to == null) result = { error: "Type a time like 75, 1:15 or 1:02:05" };
    else {
      const res = await downy.checkClip({ start: from, end: to }, p.info.duration || 0);
      result = res.ok ? { clip: res.data } : { error: res.error };
    }
    if (state.picker !== p || seq !== p.seq) return;
    p.clip = result.clip || null;
    p.error = result.error || "";
    paintClip();
  })();
}

function paintClip() {
  const p = state.picker;
  const note = $("pickClipNote");
  if (!note) return;
  note.classList.toggle("bad", !!p.error);
  note.textContent = p.error || (p.clip ? timeInWords(p.clip.end - p.clip.start) : "That is the whole video.");
  for (const b of $("picker").querySelectorAll(".pick")) b.disabled = !!p.error;
}

function closePicker() {
  state.picker = null;
  renderPicker();
}

async function startDownload(option) {
  const p = state.picker;
  await p.run;
  if (state.picker !== p || p.error) return;
  const { url, clip } = p;
  closePicker();
  $("url").value = "";
  try {
    const d = await call(downy.download, url, option.id, clip);
    state.tab = "downloads";
    state.folder = null;
    flash(d.id);
  } catch {}
}

// The tab a download shows up in.
function tabOf(d) {
  if (d.status === "done") return "done";
  if (!FAILED.has(d.status)) return "downloads";
  // A file that failed in a batch, or in the current run, stays in Downloads.
  return d.status === "error" && (d.batch || state.run?.ids.has(d.id)) ? "downloads" : "failed";
}

// Opens the tab and the section that hold a download, so a new or focused download is never hidden.
function reveal(id) {
  const d = state.downloads.find((x) => x.id === id);
  if (!d) return;
  if (state.tab !== tabOf(d) || state.folder) openTab(tabOf(d));
  const g = groups(viewOf()).find((x) => x.items.some((y) => y.id === id));
  if (g && g.items.findIndex((y) => y.id === id) >= CAP_SHOW && g.items.length > CAP_OVER && !prefs.expanded.has(g.id)) {
    prefs.expanded.add(g.id);
    savePrefs();
    render();
  }
}

function flash(id) {
  const tryFlash = (n) => {
    reveal(id);
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

const LIMITS = { connections: [1, 32], maxActive: [1, 10] };

function renderSettings() {
  const s = state.settings;
  if (!s) return;
  const f = $("settingsForm");
  $("setDir").textContent = s.downloadDir;
  $("setDir").title = s.downloadDir;
  $("welcomeDir").textContent = s.downloadDir;
  $("openFolder").title = `Open the download folder, ${s.downloadDir}`;
  for (const name of ["organize", "confirm", "showOnStart", "closeToTray", "openAtLogin", "notify"]) f.elements[name].checked = !!s[name];
  roll(f.elements.connections, s.connections);
  roll(f.elements.maxActive, s.maxActive);
  for (const b of f.querySelectorAll("[data-step]")) {
    const [lo, hi] = LIMITS[b.dataset.step];
    b.disabled = Number(b.dataset.delta) < 0 ? s[b.dataset.step] <= lo : s[b.dataset.step] >= hi;
  }
  const t = state.tools || {};
  const runtime = t.jsRuntime && !/deno/i.test(t.jsRuntime) ? "Node.js" : "Deno";
  $("toolsList").replaceChildren(...[["yt-dlp", t.ytdlp], ["ffmpeg", t.ffmpeg], [runtime, t.jsRuntime]].map(([name, found]) => {
    const row = el("div", "field");
    const text = el("span", "field-text");
    text.append(el("span", "field-label", name), el("span", found ? "field-help path" : "field-help", found || "Not found"));
    const st = el("span", found ? "tool-state" : "tool-state missing");
    st.innerHTML = icon(found ? "tick" : "alert");
    st.append(found ? "Ready" : "Missing");
    row.append(text, st);
    return row;
  }));
  renderTools();
}

// ---------------------------------------------------------------- updates

function updateText(u) {
  switch (u.status) {
    case "off": return `Downy ${u.current}. Updates are off in a dev build.`;
    case "checking": return `Downy ${u.current}. Checking for updates`;
    case "latest": return `Downy ${u.current} is the latest version`;
    case "downloading": return `Downloading Downy ${u.version || ""}, ${u.percent}%`;
    case "ready": return `Downy ${u.version} is ready. It installs when you restart or quit Downy. Running downloads continue after the restart.`;
    case "error": return `Downy ${u.current}. ${u.error}`;
    default: return `Downy ${u.current}. Downy checks for updates in the background.`;
  }
}

function renderUpdate() {
  const u = state.update;
  if (!u) return;
  $("updateStatus").textContent = updateText(u);
  $("appVersion").textContent = u.current ? `Downy ${u.current}` : "";
  const action = $("updateAction");
  action.hidden = u.status === "off";
  action.disabled = u.status === "checking" || u.status === "downloading";
  morph(action, u.status === "ready" ? "Restart to update" : "Check now");
  const btn = $("updateBtn");
  btn.hidden = u.status !== "ready";
  $("updateBtnText").textContent = "Restart to update";
  btn.title = `Install Downy ${u.version} and start it again`;
}

async function updateAction() {
  const u = state.update;
  if (u.status === "ready") return call(downy.restartToUpdate);
  state.update = { ...u, status: "checking" };
  renderUpdate();
  const next = await call(downy.checkUpdate);
  if (next) state.update = next;
  renderUpdate();
}

// ------------------------------------------------------------------ tools

const TOOL_ROWS = [["yt-dlp", "ytdlp", "yt-dlp"], ["ffmpeg", "ffmpeg", "ffmpeg"], ["deno", "jsRuntime", "Deno"]];

function toolsMissing() {
  const t = state.tools || {};
  return !t.ytdlp || !t.ffmpeg || !t.jsRuntime;
}

function renderTools() {
  const t = state.tools || {};
  const st = state.install || {};
  $("toolRows").replaceChildren(...TOOL_ROWS.map(([name, key, label]) => {
    const found = t[key];
    const busy = !found && st.running && st.tool === name;
    const li = el("li");
    li.dataset.state = found ? "found" : busy ? "busy" : "missing";
    li.innerHTML = icon(found ? "check" : busy ? "loader" : "alert");
    li.append(el("span", "tool-name", label));
    let text = "Not found, Downy installs it";
    if (found) text = key === "jsRuntime" && !/deno/i.test(found) ? "Node.js found, Deno not needed" : "Found";
    else if (busy) text = st.total ? `${size(st.received)} of ${size(st.total)}` : "Starting";
    const stateText = el("span", "tool-state", text);
    if (found) stateText.title = found;
    li.append(stateText);
    if (busy) {
      const bar = el("span", "tool-bar");
      const fill = el("span");
      fill.style.width = st.total ? `${Math.round((st.received / st.total) * 100)}%` : "0";
      bar.append(fill);
      li.append(bar);
    }
    return li;
  }));
  const status = $("toolsStatus");
  if (st.error) {
    status.textContent = st.error;
    status.dataset.tone = "warn";
  } else if (st.running) {
    status.textContent = `Installing ${st.label}`;
    status.dataset.tone = "wait";
  } else if (!toolsMissing()) {
    status.textContent = "All tools are ready";
    status.dataset.tone = "ok";
  } else {
    status.textContent = "";
    status.dataset.tone = "";
  }
  const install = $("toolsInstall");
  install.disabled = !!st.running;
  install.textContent = st.running ? "Installing" : !toolsMissing() ? (state.toolsMode === "settings" ? "Done" : "Next") : st.error ? "Try again" : "Install";
  $("toolsSkip").hidden = !toolsMissing();
  $("toolsSkip").textContent = state.toolsMode === "settings" ? "Close" : "Skip for now";
  $("toolsInstallSettings").hidden = !toolsMissing();
}

function showWelcomeStep(id) {
  for (const s of ["stepFolder", "stepTools", "stepExtension"]) $(s).hidden = s !== id;
}

function showToolsStep(mode) {
  state.toolsMode = mode;
  const welcome = $("welcome");
  showWelcomeStep("stepTools");
  $("toolsStepCount").hidden = mode !== "first";
  $("toolsStepCount").textContent = `Step 2 of ${state.steps}`;
  $("toolsTitle").textContent = mode === "missing" ? "Downy needs a few tools" : "Install the download tools";
  welcome.setAttribute("aria-labelledby", "toolsTitle");
  renderTools();
  if (!welcome.open) welcome.showModal();
  $("toolsInstall").focus();
}

// Moves on from the tools step: to the extension step on a first run, or closes.
function leaveToolsStep() {
  if (state.toolsMode === "first") showExtensionStep("first");
  else if (state.toolsMode === "missing" && !state.settings.extensionSetup) showExtensionStep("update");
  else $("welcome").close();
}

async function installTools() {
  if (!toolsMissing()) return leaveToolsStep();
  state.install = { ...(state.install || {}), running: true, error: null };
  renderTools();
  const res = await call(downy.installTools);
  if (res) Object.assign(state, { install: res.install, tools: res.tools });
  renderTools();
  renderSettings();
}

// ------------------------------------------------------- chrome extension

function extensionStatus(x, waiting) {
  if (!x) return { text: "", tone: "" };
  if (x.current) return { text: "Connected. Open any YouTube video to try it.", tone: "ok" };
  if (x.seen && !x.seenVersion) {
    return { text: "An older Downy extension is talking to Downy. Remove it in Chrome and load the folder above instead, so it updates with Downy.", tone: "warn" };
  }
  if (x.seen) {
    return { text: `Chrome is still running version ${x.seenVersion}. Click the reload button on Downy in chrome://extensions, or restart Chrome, to use ${x.version}.`, tone: "warn" };
  }
  return waiting
    ? { text: "Waiting for Chrome to load the extension", tone: "wait" }
    : { text: "Downy hasn't heard from the extension since it started. If you haven't added it yet, click Set up.", tone: "" };
}

function renderExtension() {
  const x = state.extension;
  if (!x) return;
  $("extDir").textContent = x.dir;
  for (const [id, waiting] of [["extStatus", true], ["extStatusSettings", false]]) {
    const st = extensionStatus(x, waiting);
    const node = $(id);
    node.textContent = st.text;
    node.dataset.tone = st.tone;
  }
}

// mode: "first" for a new install, "update" for someone coming from 2.0, "settings" from the Set up button.
function showExtensionStep(mode) {
  const welcome = $("welcome");
  showWelcomeStep("stepExtension");
  $("extStepCount").hidden = mode !== "first";
  $("extStepCount").textContent = `Step ${state.steps} of ${state.steps}`;
  $("extRemoveStep").hidden = mode === "first";
  $("extSkip").textContent = mode === "settings" ? "Close" : "Skip for now";
  $("extTitle").textContent = mode === "update" ? "Downy now keeps its Chrome extension up to date" : "Add Downy to Chrome";
  $("extSub").textContent = mode === "update"
    ? "The extension now comes with Downy, and each Downy update brings the new extension along. Load it from Downy's folder once to switch over."
    : "The extension puts a Download button on YouTube videos and hands Chrome downloads to Downy. Chrome only lets you add it by hand, which takes a minute.";
  welcome.setAttribute("aria-labelledby", "extTitle");
  renderExtension();
  if (!welcome.open) welcome.showModal();
  $("extOpenChrome").focus();
}

async function finishExtensionStep() {
  if (!state.settings.extensionSetup) await saveSetting({ extensionSetup: true });
  $("welcome").close();
  $("url").focus();
}

async function saveSetting(patch) {
  state.settings = await call(downy.setSettings, patch);
  renderSettings();
  defaultHint();
}

// ------------------------------------------------------------------ setup

function wire() {
  addEventListener("resize", fitSky);
  fitSky();
  makeTabs();
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
  $("openFolder").onclick = () => call(downy.openFolder);

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
  const takeLink = (text) => {
    $("url").value = text;
    if (isYoutube(text)) getFormats(text);
    else {
      $("url").focus();
      setHint("Press Enter to download this file into Downloads", false, "arrowDown");
    }
  };
  document.addEventListener("paste", (e) => {
    if (e.target.closest("input") && e.target.id !== "url") return;
    const text = (e.clipboardData?.getData("text") || "").trim();
    if (!/^https?:\/\//i.test(text)) return;
    e.preventDefault();
    takeLink(text);
  });
  // A dropped link or file must not open in the window. A dropped web link works like a pasted one.
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    const data = e.dataTransfer;
    const listed = (data?.getData("text/uri-list") || "").split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#"));
    const text = (listed || data?.getData("text/plain") || "").trim();
    if (/^https?:\/\//i.test(text)) takeLink(text);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (state.picker) closePicker();
    else if (state.select && !document.querySelector("dialog[open]")) endSelect();
  });
  $("selDone").onclick = endSelect;
  $("selResume").onclick = () => batchPicked("all");
  $("selBatch").onclick = () => batchPicked("one");

  const dialog = $("settings");
  const links = [...dialog.querySelectorAll(".set-link")];
  const showPage = (page) => {
    for (const l of links) {
      const on = l.dataset.page === page;
      if (on) {
        l.setAttribute("aria-current", "page");
        $("setCrumb").textContent = l.textContent;
      } else l.removeAttribute("aria-current");
    }
    for (const p of dialog.querySelectorAll(".set-page")) p.hidden = p.dataset.page !== page;
    $("setBody").scrollTop = 0;
  };
  for (const l of links) l.onclick = () => showPage(l.dataset.page);
  $("setNav").addEventListener("keydown", (e) => {
    const i = links.indexOf(document.activeElement);
    if (i < 0) return;
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: links.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const l = links[(to + links.length) % links.length];
    l.focus();
    showPage(l.dataset.page);
  });
  showPage("saving");
  const openSettings = async () => {
    const res = await downy.recheckTools();
    if (res.ok) state.tools = res.data;
    renderSettings();
    dialog.showModal();
    // Start with focus on the window itself, so no link shows a focus ring until the keyboard is used.
    dialog.focus();
    $("openSettings").setAttribute("aria-pressed", "true");
  };
  dialog.addEventListener("close", () => $("openSettings").setAttribute("aria-pressed", "false"));
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  $("openSettings").onclick = openSettings;
  const chooseFolder = async () => {
    state.settings = await call(downy.chooseFolder);
    renderSettings();
  };
  $("setDirBtn").onclick = chooseFolder;
  $("welcomeDirBtn").onclick = chooseFolder;

  // First run: the welcome screen stays up until the user confirms a download folder,
  // then shows how to add the Chrome extension.
  const welcome = $("welcome");
  welcome.addEventListener("cancel", (e) => {
    e.preventDefault();
    if (!$("stepExtension").hidden) finishExtensionStep();
    else if (!$("stepTools").hidden && !state.install?.running) leaveToolsStep();
  });
  $("welcomeNext").onclick = async () => {
    await saveSetting({ onboarded: true });
    if (toolsMissing()) showToolsStep("first");
    else showExtensionStep("first");
  };
  $("toolsInstall").onclick = installTools;
  $("toolsSkip").onclick = leaveToolsStep;
  $("toolsInstallSettings").onclick = () => {
    $("settings").close();
    showToolsStep("settings");
  };
  $("extOpenChrome").onclick = async () => {
    const opened = await call(downy.openChrome);
    toast(opened
      ? "Chrome is opening. chrome://extensions is copied, so paste it into the address bar."
      : "Chrome wasn't found. chrome://extensions is copied, so paste it into your browser's address bar.", !opened);
  };
  $("extCopyPath").onclick = async () => {
    await call(downy.copyExtensionPath);
    toast("Folder copied. Paste it into the Folder box after you click Load unpacked.");
  };
  $("extShowFolder").onclick = () => call(downy.showExtensionFolder);
  $("updateAction").onclick = updateAction;
  $("updateBtn").onclick = updateAction;
  $("extSkip").onclick = finishExtensionStep;
  $("extDone").onclick = finishExtensionStep;
  $("extSetupBtn").onclick = () => {
    $("settings").close();
    showExtensionStep("settings");
  };
  const form = $("settingsForm");
  for (const name of ["organize", "confirm", "showOnStart", "closeToTray", "openAtLogin", "notify"]) {
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
    trackSpeed();
    render();
  });
  downy.onSettings((s) => {
    state.settings = s;
    renderSettings();
  });
  downy.onInstall((st) => {
    state.install = st;
    renderTools();
  });
  downy.onUpdate((u) => {
    const wasReady = state.update?.status === "ready";
    state.update = u;
    renderUpdate();
    if (u.status === "ready" && !wasReady) toast(`Downy ${u.version} is ready. Click Restart to update at the top right, or it installs when you quit.`);
  });
  downy.onExtension((x) => {
    state.extension = x;
    renderExtension();
  });
  downy.onFocus((id) => {
    state.folder = null;
    render();
    flash(id);
  });
}

(async function init() {
  wire();
  const res = await downy.state();
  if (!res.ok) return toast(res.error, true);
  Object.assign(state, { downloads: res.data.downloads, settings: res.data.settings, tools: res.data.tools, extension: res.data.extension, update: res.data.update, install: res.data.install });
  state.steps = toolsMissing() ? 3 : 2;
  $("folderStepCount").textContent = `Step 1 of ${state.steps}`;
  if (res.data.maximized) {
    $("maxBtn").dataset.icon = "restore";
    paintIcons($("maxBtn").parentElement);
  }
  trackSpeed();
  render();
  renderSettings();
  renderExtension();
  renderUpdate();
  renderTools();
  defaultHint();
  // With nothing to run, the box waits under the heading. Pasting works anywhere in the window.
  if (!state.downloads.some(isActive)) $("url").focus();
  if (!state.settings.onboarded) {
    $("welcome").showModal();
    $("welcomeNext").focus();
  } else if (toolsMissing()) {
    showToolsStep("missing");
  } else if (!state.settings.extensionSetup) {
    showExtensionStep("update");
  }
})();
