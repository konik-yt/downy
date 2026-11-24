// The confirm window. With one download it shows the picture, the name, the format and
// where it goes. With several, or after "Start a batch", it lists them: they can be
// reordered, left out, and started one at a time or all together.
const $ = (id) => document.getElementById(id);

let view = null;
let optionId = null; // the format of a single video
let dir = "";
let nameEdited = false; // a typed name or folder stays when the format changes
let dirEdited = false;
let mode = "one"; // how several downloads run: "one" at a time or "all" together
let order = []; // request ids, top to bottom
const formats = {}; // request id -> the format picked on a video's row
const seen = new Set(); // rows already shown, so only new arrivals light up
let newest = null; // the request that arrived last while the window was open
let drag = null;
let clip = null; // the time range of a single video, once the app has accepted it
let clipTargets = null; // where the clip would be saved and what it would be called, per format
let clipSizes = null; // the estimated size of the clip, per format
let clipRun = Promise.resolve(); // the latest check of the range
let clipSeq = 0;

function size(n) {
  if (!n) return "";
  const u = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < 3) {
    n /= 1024;
    i++;
  }
  return (i < 2 ? n.toFixed(0) : n.toFixed(1)) + " " + u[i];
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// "Clip (1080p).mp4" -> ["Clip (1080p)", ".mp4"]
function splitExt(name) {
  const m = /^(.*?)(\.[a-z0-9]{1,8})?$/i.exec(name);
  return [m[1], m[2] || ""];
}

// Keeps the start and the end of a long name, where files in a batch differ: "Detroit_Become…part01.rar".
function middle(text, max = 34) {
  if (text.length <= max) return text;
  const tail = Math.min(14, Math.floor(max / 2.5));
  return text.slice(0, max - tail - 1) + "…" + text.slice(-tail);
}

// A folder inside the download folder goes by its short name, like YouTube\1080p.
function shortDir(path) {
  const root = (view.root || "").replace(/[\\/]+$/, "");
  if (root && path.toLowerCase().startsWith(root.toLowerCase() + "\\")) return path.slice(root.length + 1);
  if (root && path.toLowerCase() === root.toLowerCase()) return root.split(/[\\/]/).slice(-2).join("\\");
  return path;
}

const isGroup = () => view.collecting || view.entries.length > 1;
const single = () => view.entries[0];
const optionOf = (e, id) => e.options?.find((o) => o.id === id) || null;
const entrySize = (e) => (e.kind === "file" ? e.size || 0 : optionOf(e, formats[e.id] || e.optionId)?.size || 0);
const sorted = () => order.map((id) => view.entries.find((e) => e.id === id)).filter(Boolean);
// The short name of a format on its tile: 1080p, 4K, MP3.
const tileName = (o) => (o.kind !== "video" ? o.folder || o.kind.toUpperCase() : o.folder === "2160p" ? "4K" : o.folder);

// ------------------------------------------------------------ one download

function applySingle() {
  const e = single();
  const t = (clipTargets || e.targets)[optionId];
  if (!dirEdited) dir = t.dir;
  if (e.kind === "file") {
    // Files keep their extension in the box, so it can be changed too.
    if (!nameEdited) $("name").value = t.name;
    $("ext").textContent = "";
  } else {
    const [base, ext] = splitExt(t.name);
    if (!nameEdited) $("name").value = base;
    $("ext").textContent = ext;
  }
  $("sub").textContent = [e.site, e.kind === "file" ? size(e.size) : ""].filter(Boolean).join(", ");
  for (const b of $("tiles").children) {
    b.setAttribute("aria-checked", String(b.dataset.id === optionId));
    b.lastChild.textContent = clipSizes ? size(clipSizes[b.dataset.id]) : optionOf(e, b.dataset.id)?.sizeText || "";
  }
  showDir();
}

function renderSingle() {
  const e = single();
  optionId ??= e.optionId;
  document.title = `Download ${e.title}`;
  $("title").textContent = e.title;
  $("title").title = e.title;
  $("thumb").src = e.thumbnail || "";
  $("pic").classList.toggle("file", e.kind === "file");
  $("tile").hidden = !!e.thumbnail;
  const tileIcon = $("tileIcon");
  tileIcon.dataset.icon = e.kind === "video" ? "video" : "file";
  paintIcons(tileIcon.parentElement);
  $("tileText").textContent = e.kind === "file" ? (e.ext || "").toUpperCase().slice(0, 5) : "";
  $("dur").hidden = !e.duration;
  $("dur").textContent = e.duration ? formatTime(e.duration) : "";
  $("trim").hidden = e.kind !== "video";
  const tiles = $("tiles");
  tiles.hidden = e.kind !== "video";
  if (e.kind === "video" && !tiles.children.length) {
    // Audio first, then the videos from small to big, so the row reads left to right.
    const opts = [...e.options.filter((o) => o.kind !== "video"), ...e.options.filter((o) => o.kind === "video").reverse()];
    tiles.replaceChildren(...opts.map((o) => {
      const b = el("button", "pick");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.dataset.id = o.id;
      b.title = o.label;
      b.append(el("b", "", tileName(o)), el("span", "", o.sizeText || ""));
      b.onclick = () => {
        optionId = o.id;
        applySingle();
      };
      b.onkeydown = (ev) => moveTile(ev, b);
      return b;
    }));
  }
  applySingle();
  $("choose").hidden = !e.zip;
  showPicked();
}

// Left and right arrows move along the format tiles, like a radio group.
function moveTile(ev, b) {
  if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
  ev.preventDefault();
  const next = ev.key === "ArrowRight" ? b.nextElementSibling : b.previousElementSibling;
  if (!next) return;
  next.focus();
  next.click();
}

function toggleRename() {
  const row = $("nameRow");
  row.hidden = !row.hidden;
  $("rename").setAttribute("aria-expanded", String(!row.hidden));
  $("rename").textContent = row.hidden ? "Rename" : "Keep the name";
  if (!row.hidden) {
    $("name").focus();
    $("name").select();
  } else if (nameEdited) {
    nameEdited = false;
    applySingle();
  }
}

// Opens the trimmer over the whole video. Closing it goes back to the whole video.
function toggleTrim() {
  const row = $("clipRow");
  row.hidden = !row.hidden;
  $("trim").setAttribute("aria-expanded", String(!row.hidden));
  $("trim").textContent = row.hidden ? "Trim" : "Cancel trim";
  if (!row.hidden) {
    const e = single();
    const t = trimmer({ duration: e.duration, storyboard: e.storyboard, onChange: checkClip, screen: $("screen") });
    row.replaceChildren(t.el);
    row.querySelector(".trim-handle")?.focus();
    return;
  }
  row.replaceChildren();
  clipSeq++; // an answer still on its way no longer counts
  clipRun = Promise.resolve();
  clip = clipTargets = clipSizes = null;
  $("go").disabled = false;
  showError("");
  applySingle();
}

// Asks the app whether the range is usable, and for the names and sizes it gives. The app has the one parser.
function checkClip(range) {
  const seq = ++clipSeq;
  clipRun = (async () => {
    const res = await downy.promptClip(range);
    showClip(seq, res.ok ? res.data : { error: res.error });
  })();
}

function showClip(seq, r) {
  if (seq !== clipSeq) return;
  const bad = !!r.error;
  clip = bad ? null : r.clip;
  clipTargets = bad ? null : r.targets;
  clipSizes = bad ? null : r.sizes;
  $("go").disabled = bad;
  showError(bad ? r.error : "");
  applySingle();
}

// A ZIP on a server that sends parts of files can be downloaded in part: only the files picked
// in the tree. Closing the tree goes back to the whole archive, like "Keep the name" does.
let tree = null;

function toggleFiles() {
  const box = $("zipBox");
  box.hidden = !box.hidden;
  if (!box.hidden && !tree) {
    tree = fileTree(single().zip, { size, onChange: showPicked });
    box.append(tree.el);
  }
  $("choose").textContent = box.hidden ? "Choose files" : "Keep all files";
  $("choose").setAttribute("aria-expanded", String(!box.hidden));
  if (!box.hidden && !$("nameRow").hidden) toggleRename();
  $("rename").hidden = !box.hidden;
  showPicked();
}

// The entries picked in the tree, or null for the whole file.
const pickedFiles = () => (tree && !isGroup() && !$("zipBox").hidden && !tree.all() ? tree.picked() : null);

function showPicked() {
  const n = pickedFiles()?.length;
  $("goText").textContent = n == null ? "Download" : n ? `Download ${n} ${n === 1 ? "file" : "files"}` : "Pick files to download";
}

// ------------------------------------------------- several downloads, or a batch

function renderGroup() {
  // Rows keep the order the user made. New arrivals go to the end.
  order = order.filter((id) => view.entries.some((e) => e.id === id));
  for (const e of view.entries) if (!order.includes(e.id)) order.push(e.id);
  const entries = sorted();
  const n = entries.length;
  const sites = new Set(entries.map((e) => e.site));
  let title;
  if (!view.collecting) title = `${n} files from ${entries[0].site}`;
  else if (n === 1) title = "New batch";
  else title = batchName(entries).label;
  document.title = title;
  $("gTitle").textContent = title;
  $("gTitle").title = title;
  const sizes = entries.map(entrySize);
  const total = sizes.reduce((a, b) => a + b, 0);
  const from = sites.size === 1 ? `From ${entries[0].site}` : `From ${sites.size} sites`;
  $("gSub").textContent = total ? `${from}, ${sizes.every(Boolean) ? "" : "about "}${size(total)} in all` : from;
  $("live").hidden = !view.collecting;
  $("card").classList.toggle("collecting", view.collecting);

  if (!drag) renderRows(entries);
  $("drop").hidden = !view.collecting;
  $("allSub").textContent = `${view.maxActive} at once, the rest wait in line.`;
  for (const b of document.querySelectorAll(".opt")) b.setAttribute("aria-checked", String(b.dataset.mode === mode));
  $("goText").textContent = n === 1 ? "Download 1 file" : `Download ${n} ${mode === "one" ? "one by one" : "all together"}`;
  $("go").dataset.icon = mode === "one" ? "list" : "zap";
  paintIcons($("go").parentElement);
  $("cancel").textContent = view.collecting ? "Cancel batch" : "Cancel all";
  $("gClose").title = $("cancel").textContent;
  $("gClose").setAttribute("aria-label", $("cancel").textContent);
  showDir();
}

function thumbOf(e) {
  const th = el("span", "th");
  if (e.kind === "video" && e.thumbnail) {
    const img = el("img");
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => {
      img.remove();
      th.textContent = "MP4";
    };
    img.src = e.thumbnail;
    th.append(img);
  } else if (e.kind === "file") th.textContent = (e.ext || "file").toUpperCase().slice(0, 4);
  else {
    const o = optionOf(e, formats[e.id] || e.optionId);
    th.textContent = o?.kind === "video" ? "MP4" : o?.kind === "mp3" ? "MP3" : "M4A";
  }
  return th;
}

function renderRows(entries) {
  const list = $("list");
  for (const e of entries) {
    if (!seen.has(e.id) && seen.size) newest = e.id;
    seen.add(e.id);
  }
  const rows = entries.map((e, k) => {
    const row = el("div", "f" + (e.id === newest ? " new" : ""));
    row.setAttribute("role", "listitem");
    row.dataset.id = e.id;
    row.draggable = true;
    const grip = el("button", "grip");
    grip.type = "button";
    grip.dataset.icon = "grip";
    grip.title = "Drag to change the order. With the keyboard, press Alt with the up or down arrow.";
    grip.setAttribute("aria-label", `Move ${e.title}`);
    grip.onkeydown = (ev) => moveByKey(ev, e.id);
    const nm = el("span", "nm");
    const where = el("span");
    if (e.id === newest) where.append(el("span", "just", "Just added"), ", ");
    where.append(e.site);
    nm.append(el("b", "", e.kind === "file" ? middle(e.title) : e.title), where);
    nm.title = e.title;
    let side;
    if (e.kind === "video") {
      side = el("span", "fmt");
      const select = el("select");
      select.setAttribute("aria-label", `Format for ${e.title}`);
      for (const o of e.options) select.append(new Option(o.sizeText ? `${tileName(o)}, ${o.sizeText}` : tileName(o), o.id, false, o.id === (formats[e.id] || e.optionId)));
      select.onchange = () => {
        formats[e.id] = select.value;
        renderGroup();
      };
      side.append(select);
      side.insertAdjacentHTML("beforeend", icon("chevron"));
    } else side = el("span", "sz", size(e.size));
    const rm = el("button", "rm");
    rm.type = "button";
    rm.dataset.icon = "x";
    rm.title = "Leave this one out";
    rm.setAttribute("aria-label", `Leave out ${e.title}`);
    rm.onclick = () => leaveOut(e.id);
    row.append(grip, el("span", "idx", String(k + 1)), thumbOf(e), nm, side, rm);
    wireDrag(row);
    return row;
  });
  list.replaceChildren(...rows);
  paintIcons(list);
}

async function leaveOut(id) {
  const res = await downy.promptRemove(id);
  if (res.ok && res.data) update(res.data);
}

// Alt with the up or down arrow moves a row one place.
function moveByKey(ev, id) {
  if (!ev.altKey || (ev.key !== "ArrowUp" && ev.key !== "ArrowDown")) return;
  ev.preventDefault();
  const i = order.indexOf(id);
  const j = ev.key === "ArrowUp" ? i - 1 : i + 1;
  if (j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  renderGroup();
  document.querySelector(`.f[data-id="${id}"] .grip`)?.focus();
}

function wireDrag(row) {
  row.addEventListener("dragstart", (e) => {
    if (!e.target.closest(".grip") && document.elementFromPoint(e.clientX, e.clientY)?.closest(".fmt, .rm")) return e.preventDefault();
    drag = row;
    row.classList.add("lifted");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-downy-row", row.dataset.id);
  });
  row.addEventListener("dragover", (e) => {
    if (!drag || row === drag) return;
    e.preventDefault();
    const box = row.getBoundingClientRect();
    const target = e.clientY < box.top + box.height / 2 ? row : row.nextElementSibling;
    if (target !== drag && target !== drag.nextElementSibling) row.parentElement.insertBefore(drag, target);
  });
  row.addEventListener("dragend", () => {
    if (!drag) return;
    drag.classList.remove("lifted");
    drag = null;
    order = [...$("list").children].map((r) => r.dataset.id);
    renderGroup();
  });
}

// ------------------------------------------------------------------ shared

function showDir() {
  const box = $("dir");
  box.replaceChildren();
  if (dirEdited || !isGroup()) {
    box.append("Saves to ", el("b", "", shortDir(dir)));
    box.title = dir;
    return;
  }
  // Several downloads go where Downy sorts them: files in Downloads, videos by format.
  const videos = view.entries.some((e) => e.kind === "video");
  const filesDir = view.dir || (view.root ? `${view.root.replace(/[\\/]+$/, "")}\\Downloads` : "");
  if (view.entries.every((e) => e.kind === "video")) box.append("Saves to ", el("b", "", "YouTube"), ", in a folder per format");
  else if (videos) box.append("Saves files to ", el("b", "", shortDir(filesDir) || "Downloads"), ", videos to ", el("b", "", "YouTube"));
  else box.append("Saves to ", el("b", "", shortDir(filesDir) || "Downloads"));
  box.title = filesDir;
}

function showError(text) {
  $("error").textContent = text;
  $("error").hidden = !text;
}

function update(next) {
  const wasGroup = view && isGroup();
  view = next;
  const group = isGroup();
  $("one").hidden = group;
  $("group").hidden = !group;
  $("cancel").hidden = !group;
  $("startBatch").hidden = group;
  $("tip").hidden = group;
  if (group) {
    if (!wasGroup) seen.add(single()?.id); // the first file was already on screen
    renderGroup();
  } else {
    $("goText").textContent = "Download";
    $("go").dataset.icon = "arrowDown";
    paintIcons($("go").parentElement);
    renderSingle();
  }
}

async function submit() {
  await clipRun;
  const go = $("go");
  if (go.disabled) return;
  const files = pickedFiles();
  if (files && !files.length) return showError("Pick at least one file");
  go.disabled = true;
  showError("");
  const choice = isGroup()
    ? { order, formats, mode, dir: dirEdited ? dir : "" }
    : { optionId, dir: dirEdited ? dir : "", name: nameEdited && $("name").value.trim() ? $("name").value.trim() : "", clip, files };
  const res = await downy.promptSubmit(choice);
  if (!res.ok) {
    go.disabled = false;
    showError(res.error);
  }
}

async function startBatch() {
  if (!$("clipRow").hidden) toggleTrim(); // a batch is not trimmed
  const res = await downy.promptBatch();
  if (!res.ok) return showError(res.error);
  update(res.data);
}

function fit() {
  downy.promptSize(Math.ceil(document.body.getBoundingClientRect().height));
}

(async function init() {
  paintIcons();
  new ResizeObserver(fit).observe(document.body);
  const res = await downy.promptGet();
  if (!res.ok) return showError(res.error);
  update(res.data);
  downy.onPrompt(update);

  $("name").addEventListener("input", () => (nameEdited = true));
  $("rename").onclick = toggleRename;
  $("trim").onclick = toggleTrim;
  $("choose").onclick = toggleFiles;
  $("change").onclick = async () => {
    const r = await downy.promptChooseFolder(dir || view.dir || view.root);
    if (r.ok && r.data) {
      dir = r.data;
      dirEdited = true;
      showDir();
    }
  };
  for (const b of document.querySelectorAll(".opt")) {
    b.onclick = () => {
      mode = b.dataset.mode;
      renderGroup();
    };
  }
  $("card").addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });
  $("startBatch").onclick = startBatch;
  $("cancel").onclick = () => downy.promptCancel();
  $("close").onclick = () => downy.promptCancel();
  $("gClose").onclick = () => downy.promptCancel();
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") downy.promptCancel();
    // Enter downloads when nothing else has the focus, as it did when the name box had it.
    if (e.key === "Enter" && (e.target === document.body || e.target === $("card")) && !$("go").disabled) {
      e.preventDefault();
      submit();
    }
  });
  // A dropped link or file must not open in the window.
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => e.preventDefault());
})();
