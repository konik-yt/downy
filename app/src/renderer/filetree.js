// The tree of files inside a ZIP archive, with a check box on every file and folder.
// Shared by the main window and the confirm window.
//
// files: [{ i, name, size, why }] where i is the entry's index in the archive and why, when
// set, says why the file can't be picked. opts: { size(bytes) -> text, onChange() }.
// Returns { el, picked() -> indices, all() -> true when every file is picked }.
window.fileTree = (files, { size, onChange }) => {
  const OPEN_ALL = 200; // with more files than this, folders start closed
  const FILTER_FROM = 12;
  const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;
  const picked = new Set(files.filter((f) => !f.why).map((f) => f.i));

  const folder = (name, parent) => ({ name, parent, folders: new Map(), files: [], open: false, depth: parent ? parent.depth + 1 : -1, row: null });
  const root = folder("", null);
  for (const f of files) {
    const parts = f.name.split(/[/\\]+/).filter(Boolean);
    let at = root;
    for (const p of parts.slice(0, -1)) {
      if (!at.folders.has(p)) at.folders.set(p, folder(p, at));
      at = at.folders.get(p);
    }
    at.files.push({ ...f, leaf: parts[parts.length - 1] || f.name, depth: at.depth + 1, path: f.name.toLowerCase(), row: null });
  }
  // Folders first, each list by name the way Explorer sorts it.
  (function sort(node) {
    node.folders = new Map([...node.folders].sort(([a], [b]) => byName(a, b)));
    node.files.sort((a, b) => byName(a.leaf, b.leaf));
    for (const sub of node.folders.values()) {
      // A folder that only wraps the next one, like "project-1.0/", starts open.
      sub.open = files.length <= OPEN_ALL || (node.folders.size === 1 && !node.files.length);
      sort(sub);
    }
  })(root);

  // Picked and pickable files below each folder, counted again after every change.
  const counts = new Map();
  const count = (node) => {
    let n = 0, total = 0;
    for (const sub of node.folders.values()) {
      const [a, b] = count(sub);
      n += a;
      total += b;
    }
    for (const f of node.files) if (!f.why) {
      total++;
      if (picked.has(f.i)) n++;
    }
    counts.set(node, [n, total]);
    return [n, total];
  };
  const filesBelow = (node, out = []) => {
    for (const sub of node.folders.values()) filesBelow(sub, out);
    for (const f of node.files) if (!f.why) out.push(f);
    return out;
  };

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const wrap = el("div", "ft");
  const filter = el("input", "ft-filter");
  filter.type = "search";
  filter.placeholder = `Filter ${files.length} files by name`;
  filter.setAttribute("aria-label", "Filter files by name");
  filter.spellcheck = false;
  const list = el("div", "ft-list");
  list.setAttribute("role", "tree");
  list.setAttribute("aria-label", "Files in the archive");
  const sum = el("p", "ft-sum");
  const sumText = el("span");
  const toggleAll = el("button", "link");
  toggleAll.type = "button";
  sum.append(sumText, toggleAll);
  if (files.length > FILTER_FROM) wrap.append(filter);
  wrap.append(list, sum);

  const box = (row) => {
    const b = el("span", "ft-box");
    b.setAttribute("role", "checkbox");
    b.tabIndex = 0;
    row.append(b);
    return b;
  };

  function folderRow(node) {
    const row = el("div", "ft-row dir");
    row.setAttribute("role", "treeitem");
    row.style.setProperty("--depth", node.depth);
    const b = box(row);
    const open = el("button", "ft-name");
    open.type = "button";
    open.append(el("span", "ft-arrow"), el("span", "ft-text", node.name));
    open.onclick = () => {
      node.open = !node.open;
      draw();
    };
    const n = el("span", "ft-size");
    row.append(open, n);
    const flip = () => {
      const [on, total] = counts.get(node);
      const all = on === total;
      for (const f of filesBelow(node)) all ? picked.delete(f.i) : picked.add(f.i);
      changed();
    };
    b.onclick = flip;
    b.onkeydown = (e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), flip());
    return (node.row = { el: row, box: b, n, node });
  }

  function fileRow(f) {
    const row = el("div", "ft-row" + (f.why ? " off" : ""));
    row.setAttribute("role", "treeitem");
    row.style.setProperty("--depth", f.depth);
    const b = box(row);
    const name = el("span", "ft-name", null);
    name.append(el("span", "ft-arrow none"), el("span", "ft-text", f.leaf));
    name.title = f.name;
    row.append(name, el("span", "ft-size", f.why || size(f.size)));
    if (f.why) {
      b.setAttribute("aria-disabled", "true");
      b.tabIndex = -1;
      row.title = f.why;
    } else {
      const flip = () => {
        picked.has(f.i) ? picked.delete(f.i) : picked.add(f.i);
        changed();
      };
      row.onclick = (e) => !e.target.closest(".ft-box") && flip();
      b.onclick = flip;
      b.onkeydown = (e) => (e.key === " " || e.key === "Enter") && (e.preventDefault(), flip());
    }
    return (f.row = { el: row, box: b, file: f });
  }

  // The rows on screen: every open folder's contents, or with a filter, the matching
  // files and the folders they are in.
  let shown = [];
  function draw() {
    const q = filter.value.trim().toLowerCase();
    const rows = [];
    const walk = (node) => {
      let any = false;
      for (const sub of node.folders.values()) {
        const at = rows.length;
        rows.push(sub.row || folderRow(sub));
        const open = q ? walk(sub) : sub.open && (walk(sub), true);
        if (q && !open) rows.length = at;
        any ||= !!open;
        sub.row.el.setAttribute("aria-expanded", String(!!(q ? open : sub.open)));
      }
      for (const f of node.files) {
        if (q && !f.path.includes(q)) continue;
        rows.push(f.row || fileRow(f));
        any = true;
      }
      return any;
    };
    walk(root);
    shown = rows;
    list.replaceChildren(...rows.map((r) => r.el));
    if (!rows.length) list.append(el("p", "ft-none", "No file matches"));
    paint();
  }

  function paint() {
    counts.clear();
    count(root);
    for (const r of shown) {
      let state;
      if (r.node) {
        const [on, total] = counts.get(r.node);
        state = on && on === total ? "true" : on ? "mixed" : "false";
        r.n.textContent = total ? `${on} of ${total}` : "";
        r.box.setAttribute("aria-disabled", String(!total));
      } else state = String(picked.has(r.file.i));
      r.box.setAttribute("aria-checked", state);
    }
    const chosen = files.filter((f) => picked.has(f.i));
    sumText.textContent = `${chosen.length} of ${files.length} files, ${size(chosen.reduce((n, f) => n + f.size, 0)) || "0 B"}`;
    toggleAll.textContent = chosen.length ? "Pick none" : "Pick all";
  }

  function changed() {
    paint();
    onChange?.();
  }

  toggleAll.onclick = () => {
    if (picked.size) picked.clear();
    else for (const f of files) if (!f.why) picked.add(f.i);
    changed();
  };
  let wait = 0;
  filter.oninput = () => {
    clearTimeout(wait);
    wait = setTimeout(draw, 120);
  };
  // Enter in the filter box must not start the download, and Escape clears it before it closes anything.
  filter.onkeydown = (e) => {
    if (e.key === "Enter") e.preventDefault();
    if (e.key === "Escape" && filter.value) {
      e.preventDefault();
      e.stopPropagation();
      filter.value = "";
      draw();
    }
  };
  draw();

  return {
    el: wrap,
    picked: () => files.filter((f) => picked.has(f.i)).map((f) => f.i),
    all: () => picked.size === files.length,
  };
};
