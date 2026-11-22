const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const cache = new Map();
const MISS_TTL = 60 * 1000;

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

// --ignore-config keeps a yt-dlp.conf in the save folder or the profile from changing what
// runs. After "--" yt-dlp reads the page as a URL even if it starts with "-".
function ytdlpCommand(options, { url, infoFile }) {
  const bin = find("yt-dlp");
  if (!bin) throw new Error("yt-dlp was not found. Open Settings in Downy and click Install tools.");
  let target;
  if (infoFile) target = ["--load-info-json", infoFile];
  else if (/^https?:$/.test(URL.parse(String(url))?.protocol)) target = ["--", url];
  else throw new Error("Downy can only read http and https pages");
  return { bin, args: ["--ignore-config", ...options, ...jsRuntimeArgs(), ...target] };
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

module.exports = { find, resetCache, ytdlpCommand, status, ytdlpVersion };
