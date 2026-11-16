// The confirm window: name, format and folder for one download, then Download or Cancel.
const $ = (id) => document.getElementById(id);

let view = null;
let optionId = null;
let dir = "";
let nameEdited = false; // a typed name or folder stays when the format changes
let dirEdited = false;

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

// "Clip (1080p).mp4" -> ["Clip (1080p)", ".mp4"]
function splitExt(name) {
  const m = /^(.*?)(\.[a-z0-9]{1,8})?$/i.exec(name);
  return [m[1], m[2] || ""];
}

function option() {
  return view.options?.find((o) => o.id === optionId) || null;
}

function apply() {
  const t = view.targets[optionId];
  if (!dirEdited) dir = t.dir;
  $("dir").textContent = dir;
  $("dir").title = dir;
  if (view.kind === "file") {
    // Files keep their extension in the box, so it can be changed too.
    if (!nameEdited) $("name").value = t.name;
    $("ext").textContent = "";
  } else {
    const [base, ext] = splitExt(t.name);
    if (!nameEdited) $("name").value = base;
    $("ext").textContent = ext;
  }
  const o = option();
  const sizeText = view.kind === "file" ? size(view.size) : o?.sizeText || "";
  $("sub").textContent = [view.site, o?.label, sizeText].filter(Boolean).join("  ·  ");
}

function showError(text) {
  $("error").textContent = text;
  $("error").hidden = !text;
}

async function submit() {
  const go = $("go");
  go.disabled = true;
  showError("");
  const name = $("name").value.trim();
  const res = await downy.promptSubmit({ optionId, dir: dirEdited ? dir : "", name: nameEdited && name ? name : "" });
  if (!res.ok) {
    go.disabled = false;
    showError(res.error);
  }
}

function fit() {
  downy.promptSize(Math.ceil(document.body.getBoundingClientRect().height));
}

(async function init() {
  paintIcons();
  new ResizeObserver(fit).observe(document.body);
  const res = await downy.promptGet();
  if (!res.ok) return showError(res.error);
  view = res.data;
  optionId = view.optionId;
  document.title = `Download ${view.title}`;
  $("title").textContent = view.title;
  $("title").title = view.title;
  if (view.thumbnail) $("thumb").src = view.thumbnail;
  $("thumbBox").querySelector(".thumb-icon").hidden = !!view.thumbnail;
  if (view.kind === "video") {
    const select = $("format");
    let lastKind = null;
    for (const o of view.options) {
      // A blank, disabled line between the video and the audio formats.
      if (lastKind === "video" && o.kind !== "video") select.append(Object.assign(new Option("", ""), { disabled: true }));
      lastKind = o.kind;
      select.append(new Option(o.sizeText ? `${o.label}  (${o.sizeText})` : o.label, o.id, false, o.id === optionId));
    }
    select.onchange = () => {
      optionId = select.value;
      apply();
    };
    $("formatRow").hidden = false;
  }
  apply();

  $("name").addEventListener("input", () => (nameEdited = true));
  $("change").onclick = async () => {
    const r = await downy.promptChooseFolder(dir);
    if (r.ok && r.data) {
      dir = r.data;
      dirEdited = true;
      apply();
    }
  };
  $("card").addEventListener("submit", (e) => {
    e.preventDefault();
    submit();
  });
  $("cancel").onclick = () => downy.promptCancel();
  $("close").onclick = () => downy.promptCancel();
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") downy.promptCancel();
  });
  // A dropped link or file must not open in the window.
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => e.preventDefault());
  const name = $("name");
  name.focus();
  name.select();
})();
