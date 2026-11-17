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
  filter: "all",
  folder: null,
  picker: null, // { url, info }
  rows: new Map(), // row parts by download id
  secs: new Map(), // list sections by id
  speed: 0, // smoothed total download speed in bytes per second
  refocus: null, // the element to focus again after a keyboard move
  run: null, // { ids, started, result }: the files that ran since the line was last empty
};

const LIVE = new Set(["downloading", "merging", "converting"]);
const FAILED = new Set(["error", "cancelled"]);
const FILTERS = [
  { id: "all", label: "All downloads", icon: "layers", test: () => true },
  { id: "active", label: "Active", icon: "activity", test: (d) => LIVE.has(d.status) },
  { id: "waiting", label: "Waiting", icon: "hourglass", test: (d) => d.status === "queued" },
  { id: "paused", label: "Paused", icon: "pauseCircle", test: (d) => d.status === "paused" },
  { id: "done", label: "Finished", icon: "check", test: (d) => d.status === "done" },
  { id: "failed", label: "Failed", icon: "alert", test: (d) => FAILED.has(d.status) },
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
    const tone = !counts[f.id] ? "" : f.id === "active" ? " live" : f.id === "failed" ? " bad" : "";
    const c = el("span", "count" + tone, counts[f.id] ? String(counts[f.id]) : "");
    b.append(c);
    if (!state.folder && state.filter === f.id) b.setAttribute("aria-current", "true");
    b.onclick = () => {
      state.filter = f.id;
      state.folder = null;
      render();
    };
    return b;
  }));

  // Folders mirror the disk: Downloads for files, then YouTube and Videos with one folder per format.
  const fc = {};
  for (const d of state.downloads) {
    if (d.status !== "done") continue;
    const dir = folderOf(d);
    fc[dir] = (fc[dir] || 0) + 1;
    const top = dir.split("/")[0];
    if (top !== dir) fc[top] = (fc[top] || 0) + 1;
  }
  // Folders the user picked in the confirm window: inside the download folder by name, the rest as Other.
  const known = new Set(["Downloads", "Other", ...VIDEO_GROUPS]);
  const picked = Object.keys(fc).filter((k) => !k.includes("/") && !known.has(k)).sort((a, b) => a.localeCompare(b));
  const order = (name) => {
    const m = /^(\d+)p$/.exec(name);
    return m ? -Number(m[1]) : name === "MP3" ? 1 : 2;
  };
  const formatsIn = (group) => Object.keys(fc).filter((k) => k.startsWith(group + "/")).map((k) => k.slice(group.length + 1))
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
  if (!fc.Downloads && !fc.Other && !picked.length && !VIDEO_GROUPS.some((g) => fc[g])) {
    box.replaceChildren(el("p", "nav-note", "Finished files show up here. Files from Chrome go in Downloads, videos are sorted by format."));
  } else {
    const items = [];
    if (fc.Downloads) items.push(item("Downloads", "Downloads", "folder", fc.Downloads));
    for (const g of VIDEO_GROUPS) {
      if (!fc[g]) continue;
      items.push(item(g, g, "video", fc[g]));
      for (const f of formatsIn(g)) items.push(item(`${g}/${f}`, f, /^\d+p$|^Best$/.test(f) ? "video" : "music", fc[`${g}/${f}`], true));
    }
    for (const k of picked) items.push(item(k, k, "folder", fc[k]));
    if (fc.Other) items.push(item("Other", "Other places", "folder", fc.Other));
    box.replaceChildren(...items);
  }
  if (state.settings) {
    $("wherePath").textContent = state.settings.downloadDir;
    $("whereBtn").title = `Saving to ${state.settings.downloadDir}. Click to change.`;
  }
}

// ------------------------------------------------------------------- list

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

const isToday = (ts) => !!ts && new Date(ts).toDateString() === new Date().toDateString();
const byOrder = (a, b) => (a.order ?? a.created) - (b.order ?? b.created) || a.created - b.created;
const newest = (a, b) => (b.finished || b.created) - (a.finished || a.created);
// Running and paused files keep the full row with the segment bar. Everything else gets a 44px row.
const isFull = (d) => LIVE.has(d.status) || d.status === "paused";

// The sections of All downloads, top to bottom. Empty ones are left out.
const SECTIONS = [
  { key: "live", label: "Downloading", test: (d) => LIVE.has(d.status), sort: byOrder },
  { key: "failed", label: "Failed", tone: "bad", test: (d) => FAILED.has(d.status), sort: newest },
  { key: "paused", label: "Paused", test: (d) => d.status === "paused", sort: newest },
  { key: "waiting", label: "Waiting", test: (d) => d.status === "queued", sort: byOrder },
  { key: "today", label: "Finished today", test: (d) => d.status === "done" && isToday(d.finished), sort: newest },
  { key: "earlier", label: "Earlier", test: (d) => d.status === "done" && !isToday(d.finished), sort: newest },
];
// What a filter in the sidebar shows as its one flat section.
const FILTER_KEYS = { all: null, active: "live", waiting: "waiting", paused: "paused", done: "done", failed: "failed" };

// A section with more than CAP_OVER rows shows CAP_SHOW of them until the user asks for the rest.
const CAP_OVER = 12;
const CAP_SHOW = 8;

// Collapsed sections and opened "Show more" rows stay that way across restarts.
const prefs = (() => {
  try {
    const p = JSON.parse(localStorage.getItem("downy.list") || "{}");
    return { collapsed: new Set(p.collapsed || []), expanded: new Set(p.expanded || []) };
  } catch {
    return { collapsed: new Set(), expanded: new Set() };
  }
})();

function savePrefs() {
  try {
    localStorage.setItem("downy.list", JSON.stringify({ collapsed: [...prefs.collapsed], expanded: [...prefs.expanded] }));
  } catch {}
}

function groups() {
  if (state.folder) {
    const items = state.downloads.filter((d) => d.status === "done" && (folderOf(d) === state.folder || folderOf(d).startsWith(state.folder + "/")));
    return items.length ? [{ id: "folder", key: "folder", flat: true, compact: true, label: folderLabel(state.folder), items: items.sort(newest) }] : [];
  }
  if (state.filter !== "all") {
    const f = FILTERS.find((x) => x.id === state.filter);
    const key = FILTER_KEYS[f.id];
    const items = state.downloads.filter(f.test).sort(key === "live" || key === "waiting" ? byOrder : newest);
    return items.length ? [{ id: `filter-${f.id}`, key, flat: true, compact: key !== "live" && key !== "paused", label: f.label, items }] : [];
  }
  return SECTIONS.map((s) => ({ ...s, id: s.key, compact: s.key !== "live" && s.key !== "paused", items: state.downloads.filter(s.test).sort(s.sort) }))
    .filter((g) => g.items.length);
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
// free up. A file with no known size stops the estimate there.
function estimate() {
  const live = state.downloads.filter((d) => LIVE.has(d.status));
  const running = live.filter((d) => d.status === "downloading");
  const starts = new Map();
  if (!state.speed || !running.length) return { starts, done: null };
  const share = state.speed / running.length;
  const free = live.map((d) => (d.status !== "downloading" ? 0 : d.expected ? left(d) / share : Infinity));
  while (free.length < (state.settings?.maxActive || 1)) free.push(0);
  for (const d of state.downloads.filter((x) => x.status === "queued").sort(byOrder)) {
    free.sort((a, b) => a - b);
    if (!isFinite(free[0])) break;
    starts.set(d.id, free[0]);
    free[0] += d.expected ? d.expected / share : Infinity;
  }
  const done = Math.max(...free);
  return { starts, done: isFinite(done) ? done : null };
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

// ------------------------------------------------------------- sections

function toggleSection(id) {
  if (prefs.collapsed.has(id)) prefs.collapsed.delete(id);
  else prefs.collapsed.add(id);
  savePrefs();
  render();
}

function makeSection(g) {
  const s = { el: el("section", "sec"), group: g, actsSig: null };
  s.el.dataset.sec = g.id;
  const head = el("div", "sec-head");
  s.title = el(g.flat ? "h2" : "button", g.flat ? "sec-title" : "sec-toggle");
  if (!g.flat) {
    s.title.type = "button";
    s.title.innerHTML = icon("chevron");
    s.title.onclick = () => toggleSection(s.group.id);
  }
  s.label = el("span");
  s.count = el("span", "sec-count");
  s.title.append(s.label, " ", s.count);
  s.meta = el("span", "sec-meta");
  s.acts = el("span", "sec-acts");
  head.append(s.title, el("span", "sec-line"), s.meta, s.acts);
  s.body = el("div", "sec-body");
  s.rows = g.compact ? el("div", "stack") : s.body;
  if (g.compact) s.body.append(s.rows);
  s.rows.setAttribute("role", "list");
  s.rows.setAttribute("aria-label", g.label);
  s.more = el("button", "more");
  s.more.type = "button";
  s.more.onclick = () => {
    const id = s.group.id;
    if (prefs.expanded.has(id)) prefs.expanded.delete(id);
    else prefs.expanded.add(id);
    savePrefs();
    render();
  };
  s.el.append(head, s.body);
  return s;
}

function sectionMeta(g, est) {
  const sizes = g.items.map((d) => d.expected || 0);
  const known = sizes.every(Boolean);
  const total = sizes.reduce((a, b) => a + b, 0);
  if (g.key === "waiting") {
    const parts = [];
    if (known && total) parts.push(size(total));
    if (est.done != null) parts.push(`all done in about ${span(est.done)}`);
    return parts.join(", ");
  }
  if (g.key === "today" || g.key === "earlier" || g.key === "done" || g.key === "folder") return total ? size(total) : "";
  return "";
}

// Buttons in a section header. They read the section's current items when clicked.
function sectionActions(s) {
  const g = s.group;
  const a = [];
  const ids = () => s.group.items.map((d) => d.id);
  const anyRunning = state.downloads.some((d) => d.status === "downloading" || d.status === "queued");
  const errors = g.items.filter((d) => d.status === "error").length;
  if (g.key === "live" && anyRunning) a.push(["Pause all", "pause", () => call(downy.pauseAll)]);
  if (g.key === "paused" && g.items.length > 1) a.push(["Resume all", "play", () => call(downy.resumeAll)]);
  if (g.key === "waiting" && g.flat) a.push(["Pause all waiting", "pause", () => ids().forEach((id) => call(downy.pause, id).catch(() => {}))]);
  if (g.key === "failed" && errors) {
    a.push([errors > 1 ? "Retry all" : "Retry", "retry", () => s.group.items.filter((d) => d.status === "error").forEach((d) => call(downy.resume, d.id).catch(() => {}))]);
  }
  if (g.key === "folder" && state.folder !== "Other") a.push(["Open folder", "folder", () => call(downy.openFolder, state.folder)]);
  if (["failed", "today", "earlier", "done", "folder"].includes(g.key)) a.push(["Clear from list", "trash", () => call(downy.remove, ids())]);
  const sig = a.map((x) => x[0]).join("|");
  if (sig === s.actsSig) return;
  s.actsSig = sig;
  s.acts.replaceChildren(...a.map(([label, ic, fn]) => {
    const b = el("button", "sec-act");
    b.type = "button";
    b.innerHTML = icon(ic);
    b.append(label);
    b.onclick = fn;
    return b;
  }));
}

function updateSection(s, g, est) {
  s.group = g;
  if (g.tone) s.el.dataset.tone = g.tone;
  s.label.textContent = g.label;
  s.count.textContent = String(g.items.length);
  const collapsed = !g.flat && prefs.collapsed.has(g.id);
  s.el.classList.toggle("collapsed", collapsed);
  if (!g.flat) s.title.setAttribute("aria-expanded", String(!collapsed));
  const meta = sectionMeta(g, est);
  if (s.meta.textContent !== meta) s.meta.textContent = meta;
  s.meta.hidden = !meta;
  sectionActions(s);
  return collapsed;
}

// ------------------------------------------------------------------ render

function render() {
  const has = state.downloads.length > 0;
  $("main").classList.toggle("has-list", has);
  $("listWrap").hidden = !has;
  renderSidebar();
  renderSummary();
  if (!has) return;
  const f = FILTERS.find((x) => x.id === state.filter);
  $("crumbPage").textContent = state.folder ? folderLabel(state.folder) : f.label;

  const est = estimate();
  const gs = groups();
  const list = $("list");
  const seenRows = new Set();
  const seenSecs = new Set();
  let prevSec = null;
  for (const g of gs) {
    let s = state.secs.get(g.id);
    if (!s) {
      s = makeSection(g);
      state.secs.set(g.id, s);
    }
    seenSecs.add(g.id);
    const want = prevSec ? prevSec.nextSibling : list.firstChild;
    if (want !== s.el) list.insertBefore(s.el, want);
    prevSec = s.el;
    if (updateSection(s, g, est)) continue;

    // A filter is where you go to see every row, so only the sections of All downloads get cut short.
    const long = !g.flat && g.items.length > CAP_OVER;
    const capped = long && !prefs.expanded.has(g.id);
    const shown = capped ? g.items.slice(0, CAP_SHOW) : g.items;
    // While a row is being dragged, its section keeps the order the user is making.
    const frozen = drag && drag.container === s.rows;
    let prev = null;
    shown.forEach((d, k) => {
      const kind = isFull(d) ? "full" : "mini";
      let r = state.rows.get(d.id);
      if (r && r.kind !== kind) {
        r.el.remove();
        r = null;
      }
      if (!r) {
        r = kind === "full" ? makeRow(d) : makeMini(d);
        state.rows.set(d.id, r);
      }
      if (kind === "full") updateRow(r, d);
      else updateMini(r, d, { place: k + 1, start: est.starts.get(d.id) });
      seenRows.add(d.id);
      if (!frozen || !r.el.isConnected) {
        const at = prev ? prev.nextSibling : s.rows.firstChild;
        if (at !== r.el) s.rows.insertBefore(r.el, at);
      }
      prev = r.el;
    });
    s.rows.dataset.firstHidden = capped ? g.items[CAP_SHOW].id : "";
    if (long) {
      s.more.innerHTML = icon("chevron");
      s.more.classList.toggle("open", !capped);
      s.more.append(capped ? `Show ${g.items.length - CAP_SHOW} more` : "Show fewer");
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
  empty.hidden = gs.length > 0;
  if (!gs.length) {
    empty.textContent = state.folder
      ? "Nothing in this folder yet."
      : { active: "Nothing is downloading right now.", waiting: "Nothing is waiting in line.", paused: "No paused downloads.", done: "No finished downloads yet.", failed: "No failed downloads." }[state.filter] || "No downloads yet.";
  }
  // A row that moved in the list loses focus, so a keyboard move gives it back.
  if (state.refocus) {
    if (state.refocus.isConnected && document.activeElement !== state.refocus) state.refocus.focus({ preventScroll: true });
    state.refocus = null;
  }
}

// ------------------------------------------------------- title bar summary

// While files run or wait, one line sums them up. When the line empties, it says how the
// run went, and keeps saying it until the next download starts.
function renderSummary() {
  const box = $("tbSummary");
  const live = state.downloads.filter((d) => LIVE.has(d.status));
  const waiting = state.downloads.filter((d) => d.status === "queued");
  if (live.length || waiting.length) {
    if (!state.run || state.run.result) state.run = { ids: new Set(), started: Date.now(), result: null };
    for (const d of [...live, ...waiting]) state.run.ids.add(d.id);
    const files = state.downloads.filter((d) => state.run.ids.has(d.id) && d.expected);
    const total = files.reduce((n, d) => n + d.expected, 0);
    const got = files.reduce((n, d) => n + (d.status === "done" ? d.expected : Math.min(d.downloaded || 0, d.expected)), 0);
    const parts = [];
    const est = estimate();
    if (waiting.length) parts.push(`${waiting.length} waiting`);
    if (state.speed) parts.push(`${size(state.speed)}/s`);
    if (est.done != null) parts.push(`about ${span(est.done)} left`);
    const bar = el("span", "tb-mini");
    const fill = el("b");
    fill.style.width = `${total ? Math.round((got / total) * 100) : 0}%`;
    bar.append(fill);
    const text = el("span");
    if (live.length) {
      text.append(el("b", "", `${live.length} downloading`));
      if (parts.length) text.append(", " + parts.join(", "));
    } else text.append(parts.join(", "));
    box.className = "tb-summary";
    box.replaceChildren(bar, text);
    box.title = live.length ? "Show active downloads" : "Show waiting downloads";
    box.onclick = () => openFilter(live.length ? "active" : "waiting");
    box.hidden = false;
    return;
  }
  if (state.run && !state.run.result) state.run.result = runResult(state.run);
  const res = state.run?.result;
  if (!res) {
    box.hidden = true;
    return;
  }
  box.className = "tb-summary" + (res.saved ? "" : " failed");
  box.innerHTML = icon(res.saved ? "check" : "alert");
  const text = el("span", "", res.saved ? "All done. " : "");
  if (res.saved) text.append(el("span", "ok", `${res.saved} saved`));
  if (res.failed) {
    if (res.saved) text.append(", ");
    text.append(el("span", "bad", `${res.failed} failed`));
  }
  if (res.bytes) text.append(`, ${size(res.bytes)} in ${span(res.took / 1000)}`);
  box.append(text);
  box.title = res.failed ? "Show failed downloads" : "Show finished downloads";
  box.onclick = () => openFilter(res.failed ? "failed" : "done");
  box.hidden = false;
}

// How a run ended. A run the user paused or cancelled has nothing to report.
function runResult(run) {
  const files = state.downloads.filter((d) => run.ids.has(d.id));
  if (files.some((d) => d.status === "paused")) return null;
  const done = files.filter((d) => d.status === "done");
  const failed = files.filter((d) => d.status === "error").length;
  if (!done.length && !failed) return null;
  return { saved: done.length, failed, bytes: done.reduce((n, d) => n + (d.expected || 0), 0), took: Date.now() - run.started };
}

function openFilter(id) {
  state.filter = id;
  state.folder = null;
  render();
}

// ---------------------------------------------------------------- rows

// Fills a thumbnail box: the video's picture, a file tile with its extension,
// or a tile with an icon when a video has no picture.
function paintThumb(box, d, mini) {
  box.replaceChildren();
  box.className = mini ? "mini-thumb" : "thumb";
  const ext = (d.ext || "file").toUpperCase().slice(0, mini ? 4 : 6);
  const blank = () => {
    box.classList.add("blank");
    box.insertAdjacentHTML("afterbegin", icon(d.kind === "mp3" || d.kind === "m4a" ? "music" : "video"));
  };
  if (d.kind === "file") {
    box.classList.add("file");
    if (mini) box.textContent = ext;
    else {
      const fi = el("span", "file-icon");
      fi.innerHTML = icon("file");
      box.append(fi);
    }
  } else if (d.thumbnail) {
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
  if (!mini) box.append(el("span", "kind", d.kind === "file" ? ext : d.folder || ""));
}

function makeRow(d) {
  const r = { kind: "full", el: el("article", "row") };
  r.el.setAttribute("role", "listitem");
  r.el.dataset.id = d.id;
  r.thumb = el("div", "thumb");
  r.body = el("div", "row-body");
  r.title = el("h3", "row-title");
  r.meta = el("div", "row-meta");
  r.bar = el("div", "segbar");
  r.body.append(r.title, r.meta, r.bar);
  r.side = el("div", "row-side");
  r.rate = el("div", "rate");
  r.actions = el("div", "actions");
  r.side.append(r.rate, r.actions);
  r.el.append(r.thumb, r.body, r.side);
  return r;
}

function makeMini(d) {
  const r = { kind: "mini", el: el("div", "mini") };
  r.el.setAttribute("role", "listitem");
  r.el.dataset.id = d.id;
  r.lead = el("span", "lead");
  r.thumb = el("div", "mini-thumb");
  r.title = el("p", "mini-title");
  r.state = el("div", "mini-state");
  r.size = el("span", "mini-size");
  r.end = el("div", "mini-end");
  r.when = el("span", "mini-when");
  r.actions = el("div", "actions");
  r.end.append(r.when, r.actions);
  r.el.append(r.lead, r.thumb, r.title, r.state, r.size, r.end);
  r.el.addEventListener("dblclick", (e) => {
    if (r.el.dataset.status === "done" && !e.target.closest("button")) call(downy.openFile, d.id);
  });
  r.el.addEventListener("keydown", (e) => queueKeys(e, r));
  wireDrag(r);
  return r;
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

const thumbSig = (d) => [d.kind, d.thumbnail, d.ext, d.folder].join("|");

function updateRow(r, d) {
  r.el.dataset.status = d.status;
  if (r.thumbSig !== thumbSig(d)) {
    r.thumbSig = thumbSig(d);
    paintThumb(r.thumb, d, false);
  }
  const sig = [d.status, d.title].join("|");
  if (r.sig !== sig) {
    r.sig = sig;
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
  const soft = (t) => meta.push(el("span", "soft", t));
  if (d.status === "paused" && d.expected) meta.push(el("span", "", `${size(d.downloaded)} of ${size(d.expected)}`));
  if (d.status === "paused" && !(d.kind === "file" && d.resumable === false)) soft("Resumes where it stopped");
  if (d.status === "downloading") {
    if (d.connections) soft(`${d.connections} ${d.connections === 1 ? "connection" : "connections"}`);
    if (d.stream && d.stream.count > 1) soft(d.stream.role === "audio" ? `Audio, part ${d.stream.index} of ${d.stream.count}` : `Video, part ${d.stream.index} of ${d.stream.count}`);
    soft(`${Math.floor(d.progress * 100)}%`);
  }
  r.meta.replaceChildren(...meta);
  renderBar(r, d);

  const rate = [];
  if (d.status === "downloading") {
    rate.push(el("b", "", d.speed ? `${size(d.speed)}/s` : "Connecting"));
    rate.push(el("span", "", eta(d.eta)));
  }
  r.rate.replaceChildren(...rate);
  r.rate.hidden = !rate.length;
}

// ctx.place is the row's place in its section, ctx.start the seconds until a waiting file starts.
function updateMini(r, d, ctx) {
  r.el.dataset.status = d.status;
  r.el.draggable = d.status === "queued";
  if (r.thumbSig !== thumbSig(d)) {
    r.thumbSig = thumbSig(d);
    paintThumb(r.thumb, d, true);
  }
  const sig = [d.status, d.title].join("|");
  if (r.sig !== sig) {
    r.sig = sig;
    r.title.textContent = d.title;
    r.title.title = d.title;
    r.lead.replaceChildren();
    if (d.status === "queued") {
      const grip = el("button", "grip");
      grip.type = "button";
      grip.innerHTML = icon("grip");
      grip.title = "Drag to change the order. With the keyboard, press Alt with the up or down arrow.";
      grip.setAttribute("aria-label", "Change the order");
      r.lead.append(grip);
    }
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
      r.state.innerHTML = icon(ic);
      r.state.append(el("span", "", text));
      r.state.title = d.status === "error" ? text : "";
    }
  }

  const sz = d.status === "error" || d.status === "cancelled" ? "" : d.expected ? size(d.expected) : "";
  if (r.size.textContent !== sz) r.size.textContent = sz;
  r.size.hidden = d.status === "error" || d.status === "cancelled";
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
    const top = actionButton("Move to top", "toTop", () => call(downy.moveToTop, id));
    top.dataset.act = "top";
    a.push(top);
    a.push(actionButton("Pause", "pause", () => call(downy.pause, id)));
    a.push(actionButton("Cancel download", "x", () => call(downy.cancel, id), "danger"));
  } else if (d.status === "downloading") {
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

function renderBar(r, d) {
  const showBar = ["downloading", "paused", "queued", "merging", "converting"].includes(d.status);
  r.bar.hidden = !showBar;
  if (!showBar) return;
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
    const width = s.e - s.s || 1;
    const fill = Math.max(0, Math.min(1, (s.p - s.s) / width));
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
  const q = state.downloads.filter((d) => d.status === "queued").sort(byOrder);
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
    // A newer request owns the button now, and an error from this stale one is dropped.
    // eslint-disable-next-line no-unsafe-finally
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

// Opens the section that holds a download, so a new or focused download is never hidden.
function reveal(id) {
  const g = groups().find((x) => x.items.some((d) => d.id === id));
  if (!g) return;
  let changed = prefs.collapsed.delete(g.id);
  if (!g.flat && g.items.findIndex((d) => d.id === id) >= CAP_SHOW && g.items.length > CAP_OVER && !prefs.expanded.has(g.id)) {
    prefs.expanded.add(g.id);
    changed = true;
  }
  if (changed) {
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

function renderSettings() {
  const s = state.settings;
  if (!s) return;
  const f = $("settingsForm");
  $("setDir").textContent = s.downloadDir;
  $("welcomeDir").textContent = s.downloadDir;
  for (const name of ["organize", "confirm", "showOnStart", "closeToTray", "openAtLogin", "notify"]) f.elements[name].checked = !!s[name];
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
  const action = $("updateAction");
  action.hidden = u.status === "off";
  action.disabled = u.status === "checking" || u.status === "downloading";
  action.textContent = u.status === "ready" ? "Restart to update" : "Check now";
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
    renderSidebar();
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
  $("url").focus();
  if (!state.settings.onboarded) {
    $("welcome").showModal();
    $("welcomeNext").focus();
  } else if (toolsMissing()) {
    showToolsStep("missing");
  } else if (!state.settings.extensionSetup) {
    showExtensionStep("update");
  }
})();
