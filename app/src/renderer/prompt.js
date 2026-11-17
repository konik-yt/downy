// The confirm window. With one download it asks for the name, the folder and, for a
// video, the format. With several, or after "Start a batch", it lists them: they can be
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
let drag = null;

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

const isGroup = () => view.collecting || view.entries.length > 1;
const single = () => view.entries[0];
const optionOf = (e, id) => e.options?.find((o) => o.id === id) || null;
const entrySize = (e) => (e.kind === "file" ? e.size || 0 : optionOf(e, formats[e.id] || e.optionId)?.size || 0);
const sorted = () => order.map((id) => view.entries.find((e) => e.id === id)).filter(Boolean);

// ------------------------------------------------------------ one download

function applySingle() {
  const e = single();
  const t = e.targets[optionId];
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
  const o = optionOf(e, optionId);
  const sizeText = e.kind === "file" ? size(e.size) : o?.sizeText || "";
  $("sub").textContent = [e.site, o?.label || (e.ext ? e.ext.toUpperCase() : ""), sizeText].filter(Boolean).join("  ·  ");
  showDir();
}

function renderSingle() {
  const e = single();
  optionId ??= e.optionId;
  document.title = `Download ${e.title}`;
  $("title").textContent = e.title;
  $("title").title = e.title;
  $("thumb").src = e.thumbnail || "";
  $("thumbIcon").hidden = !!e.thumbnail;
  setThumbIcon(e.kind === "video" ? "video" : "file");
  if (e.kind === "video" && !$("format").options.length) {
    const select = $("format");
    let lastKind = null;
    for (const o of e.options) {
      // A blank, disabled line between the video and the audio formats.
      if (lastKind === "video" && o.kind !== "video") select.append(Object.assign(new Option("", ""), { disabled: true }));
      lastKind = o.kind;
      select.append(new Option(o.sizeText ? `${o.label}  (${o.sizeText})` : o.label, o.id, false, o.id === optionId));
    }
    select.onchange = () => {
      optionId = select.value;
      applySingle();
    };
  }
  $("formatRow").hidden = e.kind !== "video";
  applySingle();
}

// ------------------------------------------------- several downloads, or a batch

function setThumbIcon(name) {
  const icon = $("thumbIcon");
  if (icon.dataset.icon === name) return;
  icon.dataset.icon = name;
  paintIcons(icon.parentElement);
}

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
  else title = `Batch of ${n} from ${sites.size === 1 ? entries[0].site : `${sites.size} sites`}`;
  document.title = title;
  $("title").textContent = title;
  $("title").title = title;
  $("thumb").src = "";
  $("thumbIcon").hidden = false;
  setThumbIcon(view.collecting ? "list" : "layers");
  $("count").hidden = false;
  $("count").textContent = String(n);
  const sizes = entries.map(entrySize);
  const total = sizes.reduce((a, b) => a + b, 0);
  $("sub").textContent = total ? `${sizes.every(Boolean) ? "" : "About "}${size(total)} in all` : "";
  $("live").hidden = !view.collecting;
  document.querySelector(".card").classList.toggle("collecting", view.collecting);

  if (!drag) renderRows(entries);
  $("drop").hidden = !view.collecting;
  $("allSub").textContent = `${view.maxActive} at once, the rest wait in line.`;
  for (const b of document.querySelectorAll(".opt")) b.setAttribute("aria-checked", String(b.dataset.mode === mode));
  $("goText").textContent = n === 1 ? "Download 1 file" : `Download ${n} ${mode === "one" ? "one by one" : "all together"}`;
  $("go").dataset.icon = mode === "one" ? "list" : "zap";
  paintIcons($("go").parentElement);
  $("cancel").textContent = view.collecting ? "Cancel batch" : "Cancel all";
  $("close").title = $("cancel").textContent;
  $("hint").textContent = "Drag to change the order, Esc cancels all";
  showDir();
}

function tileText(e) {
  if (e.kind === "file") return (e.ext || "file").toUpperCase().slice(0, 4);
  const o = optionOf(e, formats[e.id] || e.optionId);
  return o?.kind === "video" ? "MP4" : o?.kind === "mp3" ? "MP3" : "M4A";
}

function renderRows(entries) {
  const list = $("list");
  const rows = entries.map((e, k) => {
    const row = el("div", "f");
    row.setAttribute("role", "listitem");
    row.dataset.id = e.id;
    row.draggable = true;
    if (!seen.has(e.id) && seen.size) row.classList.add("new");
    seen.add(e.id);
    const grip = el("button", "grip");
    grip.type = "button";
    grip.dataset.icon = "grip";
    grip.title = "Drag to change the order. With the keyboard, press Alt with the up or down arrow.";
    grip.setAttribute("aria-label", `Move ${e.title}`);
    grip.onkeydown = (ev) => moveByKey(ev, e.id);
    const tile = el("span", "tile" + (e.kind === "video" ? " vid" : ""), tileText(e));
    const nm = el("span", "nm");
    nm.append(el("b", "", e.title), el("span", "", e.site));
    nm.title = e.title;
    let side;
    if (e.kind === "video") {
      side = el("span", "fmt");
      const select = el("select");
      select.setAttribute("aria-label", `Format for ${e.title}`);
      for (const o of e.options) select.append(new Option(o.sizeText ? `${o.label}, ${o.sizeText}` : o.label, o.id, false, o.id === (formats[e.id] || e.optionId)));
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
    row.append(grip, el("span", "idx", String(k + 1)), tile, nm, side, rm);
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
  const soft = isGroup() && !dirEdited && !view.dir;
  const text = soft ? "Sorted as usual: files in Downloads, videos by format" : dirEdited || !isGroup() ? dir : view.dir;
  box.textContent = text;
  box.title = soft ? "" : text;
  box.classList.toggle("soft", soft);
}

function showError(text) {
  $("error").textContent = text;
  $("error").hidden = !text;
}

function update(next) {
  const wasGroup = view && isGroup();
  view = next;
  const group = isGroup();
  $("nameRow").hidden = group;
  $("formatRow").hidden = true;
  $("files").hidden = !group;
  $("howRow").hidden = !group;
  $("more").hidden = group;
  $("count").hidden = !group;
  $("live").hidden = true;
  if (group) {
    if (!wasGroup) seen.add(single()?.id); // the first file was already on screen
    renderGroup();
  } else renderSingle();
}

async function submit() {
  closeMenu();
  const go = $("go");
  go.disabled = true;
  showError("");
  const choice = isGroup()
    ? { order, formats, mode, dir: dirEdited ? dir : "" }
    : { optionId, dir: dirEdited ? dir : "", name: nameEdited && $("name").value.trim() ? $("name").value.trim() : "" };
  const res = await downy.promptSubmit(choice);
  if (!res.ok) {
    go.disabled = false;
    showError(res.error);
  }
}

// ------------------------------------------------------------- the menu

function openMenu() {
  $("menu").hidden = false;
  $("more").setAttribute("aria-expanded", "true");
  $("menuGo").focus();
}

function closeMenu() {
  if ($("menu").hidden) return false;
  $("menu").hidden = true;
  $("more").setAttribute("aria-expanded", "false");
  return true;
}

async function startBatch() {
  closeMenu();
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
  $("change").onclick = async () => {
    const r = await downy.promptChooseFolder(dir || view.dir);
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
  $("more").onclick = () => ($("menu").hidden ? openMenu() : closeMenu());
  $("menuGo").onclick = submit;
  $("menuBatch").onclick = startBatch;
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".split")) closeMenu();
  });
  $("cancel").onclick = () => downy.promptCancel();
  $("close").onclick = () => downy.promptCancel();
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !closeMenu()) downy.promptCancel();
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !$("menu").hidden) {
      e.preventDefault();
      const items = [$("menuGo"), $("menuBatch")];
      items[(items.indexOf(document.activeElement) + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
    }
  });
  // A dropped link or file must not open in the window.
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => e.preventDefault());
  if (!isGroup()) {
    const name = $("name");
    name.focus();
    name.select();
  }
})();
