// Finds yt-dlp, ffmpeg and a JavaScript runtime on this PC.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const cache = new Map(); // name -> { path, at }
const MISS_TTL = 60 * 1000; // a missing tool is looked for again after a minute

function onPath(name) {
  // Only .exe on Windows: spawn without a shell cannot run .cmd or .bat files (EINVAL).
  const exts = process.platform === "win32" ? [".exe"] : [""];
  for (const dir of (process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, name + ext);
      try {
        if (fs.statSync(full).isFile()) return full;
      } catch {}
    }
  }
  return null;
}

// winget installs portable tools under Packages without always adding them to PATH.
function inWinget(name) {
  const root = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet");
  const links = path.join(root, "Links", name + ".exe");
  if (fs.existsSync(links)) return links;
  const pkgs = path.join(root, "Packages");
  let dirs = [];
  try {
    dirs = fs.readdirSync(pkgs);
  } catch {
    return null;
  }
  const hits = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase() === name + ".exe") hits.push(full);
      else if (e.isDirectory()) walk(full, depth + 1);
    }
  };
  for (const d of dirs) {
    if (d.toLowerCase().includes(name.replace("-", "").toLowerCase()) || d.toLowerCase().includes(name)) {
      walk(path.join(pkgs, d), 0);
    }
  }
  if (!hits.length) for (const d of dirs) walk(path.join(pkgs, d), 0);
  // Prefer a "full_build" ffmpeg, then the shortest path.
  hits.sort((a, b) => (b.includes("full_build") - a.includes("full_build")) || a.length - b.length);
  return hits[0] || null;
}

function find(name) {
  const hit = cache.get(name);
  if (hit && (hit.path || Date.now() - hit.at < MISS_TTL)) return hit.path;
  const found = onPath(name) || (process.platform === "win32" ? inWinget(name) : null);
  cache.set(name, { path: found, at: Date.now() });
  return found;
}

function resetCache() {
  cache.clear();
}

function jsRuntimeArgs() {
  // YouTube needs a JavaScript runtime to solve its player challenges. yt-dlp uses deno by default.
  if (find("deno")) return [];
  if (find("node")) return ["--js-runtimes", "node"];
  return [];
}

function status() {
  return {
    ytdlp: find("yt-dlp"),
    ffmpeg: find("ffmpeg"),
    jsRuntime: find("deno") || find("node"),
  };
}

function ytdlpVersion() {
  const bin = find("yt-dlp");
  if (!bin) return null;
  try {
    return execFileSync(bin, ["--version"], { windowsHide: true, encoding: "utf8", timeout: 15000 }).trim();
  } catch {
    return null;
  }
}

module.exports = { find, resetCache, jsRuntimeArgs, status, ytdlpVersion };
