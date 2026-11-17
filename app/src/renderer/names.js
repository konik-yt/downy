// Names for batches, shared by the main window and the confirm window.

window.stripExt = (t) => t.replace(/\.[a-z0-9]{1,8}$/i, "");

// A batch is named after its files when they share a name and differ only in a short
// numbered tail, like "Game.part01.rar" and "Game.part02.rar". Otherwise "Batch of 3".
// Returns the name and where each file's own part of its name starts.
window.batchName = (list) => {
  const n = list.length;
  const fallback = { label: `Batch of ${n}`, cut: 0, named: false };
  if (n < 2) return n ? { label: window.stripExt(list[0].title), cut: 0, named: true } : fallback;
  const names = list.map((d) => window.stripExt(d.title));
  let p = names[0];
  for (const x of names) {
    let k = 0;
    while (k < p.length && k < x.length && p[k] === x[k]) k++;
    p = p.slice(0, k);
  }
  if (!names.every((x) => x.length - p.length <= 12 && /\d/.test(x.slice(Math.max(0, p.length - 4))))) return fallback;
  const label = p
    .replace(/[\s._-]*(part|pt|vol|volume|disc|disk|cd|episode|ep)?[\s._-]*\d*$/i, "")
    .replace(/[_.]+/g, " ")
    .split(/\s+-{2,}\s+|\s+\|\s+/)[0]
    .replace(/^[\s\-–_.,:(]+|[\s\-–_.,:(]+$/g, "")
    .replace(/\s{2,}/g, " ");
  if (label.length < 3) return fallback;
  // The file's own part starts after the last separator before the names differ: "part01.rar".
  const m = /^.*[\s._-]/.exec(p);
  return { label, cut: m ? m[0].length : 0, named: true };
};
