// Reads video info with yt-dlp and turns it into the list of formats Downy offers.
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const tools = require("./tools");

const TTL = 60 * 60 * 1000; // stream URLs stay valid for several hours; one hour is safe.
const YOUTUBE_HOSTS = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;

function isYoutubeUrl(url) {
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") && YOUTUBE_HOSTS.test(u.hostname);
  } catch {
    return false;
  }
}

function humanSize(n) {
  if (!n) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return (i < 2 ? n.toFixed(0) : n.toFixed(1)) + " " + units[i];
}

const fmtSize = (f) => Math.round(f.filesize || f.filesize_approx || 0);
const isHttp = (f) => /^https?$/.test(f.protocol || "https");

function pickAudio(formats) {
  const audio = formats.filter(
    (f) => f.vcodec === "none" && f.acodec && f.acodec !== "none" && f.ext === "m4a" && isHttp(f),
  );
  const fallback = formats.filter((f) => f.vcodec === "none" && f.acodec && f.acodec !== "none");
  const pool = audio.length ? audio : fallback;
  if (!pool.length) return null;
  const key = (f) => {
    const note = (f.format_note || "").toLowerCase();
    return [
      !String(f.format_id).includes("drc"),
      note.includes("original") || note.includes("default"),
      f.language_preference || 0,
      isHttp(f),
      f.abr || 0,
    ];
  };
  return pool.reduce((best, f) => (cmp(key(f), key(best)) > 0 ? f : best));
}

function cmp(a, b) {
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]), y = Number(b[i]);
    if (x !== y) return x - y;
  }
  return 0;
}

function pickVideo(formats, height) {
  const video = formats.filter(
    (f) => f.height === height && f.vcodec && f.vcodec !== "none" && (!f.acodec || f.acodec === "none") && f.ext !== "mhtml",
  );
  if (!video.length) return null;
  const key = (f) => [isHttp(f), String(f.vcodec || "").startsWith("avc1"), f.ext === "mp4", f.fps || 0, f.tbr || 0];
  return video.reduce((best, f) => (cmp(key(f), key(best)) > 0 ? f : best));
}

function stream(role, f) {
  return {
    role,
    formatId: String(f.format_id),
    ext: f.ext,
    protocol: f.protocol || "https",
    url: f.url,
    headers: f.http_headers || {},
    size: fmtSize(f),
  };
}

function buildOptions(info) {
  const formats = info.formats || [];
  const audio = pickAudio(formats);
  const options = [];
  const heights = [...new Set(
    formats.filter((f) => f.height && f.vcodec && f.vcodec !== "none" && f.ext !== "mhtml").map((f) => f.height),
  )].sort((a, b) => b - a);

  for (const h of heights) {
    let video = pickVideo(formats, h);
    let streams;
    if (video && audio) {
      streams = [stream("video", video), stream("audio", audio)];
    } else {
      // Old videos may only have a combined stream at this height.
      const combined = formats.filter((f) => f.height === h && f.acodec && f.acodec !== "none" && f.vcodec && f.vcodec !== "none");
      if (!combined.length) continue;
      video = combined.reduce((best, f) => ((f.tbr || 0) > (best.tbr || 0) ? f : best));
      streams = [stream("combined", video)];
    }
    const size = streams.reduce((s, x) => s + x.size, 0);
    const fps = video.fps || 0;
    let tag = "";
    if (h >= 2160) tag = " 4K";
    else if (h >= 1440) tag = " 2K";
    else if (h >= 720) tag = " HD";
    options.push({
      id: `v${h}`,
      kind: "video",
      label: `MP4 file, quality ${h}p${fps > 30 ? ` ${Math.round(fps)}fps` : ""}${tag}`,
      folder: `${h}p`,
      height: h,
      size,
      sizeText: humanSize(size),
      streams,
    });
  }

  if (audio) {
    const size = fmtSize(audio);
    options.push({ id: "m4a", kind: "audio", label: "M4A audio only", folder: "M4A", size, sizeText: humanSize(size), streams: [stream("audio", audio)] });
    options.push({ id: "mp3", kind: "mp3", label: "MP3 audio only", folder: "MP3", size, sizeText: humanSize(size), streams: [stream("audio", audio)] });
  }
  return options;
}

function publicOptions(options) {
  return options.map(({ id, kind, label, size, sizeText, folder }) => ({ id, kind, label, size, sizeText, folder }));
}

class InfoCache {
  constructor(dir) {
    this.dir = dir;
    this.entries = new Map();
    this.pending = new Map();
    fs.mkdirSync(dir, { recursive: true });
  }

  async get(url, { fresh = false } = {}) {
    const hit = this.entries.get(url);
    if (!fresh && hit && Date.now() - hit.at < TTL) return hit;
    if (this.pending.has(url)) return this.pending.get(url);
    const job = this.extract(url).then((info) => {
      const file = path.join(this.dir, `${info.id}.info.json`);
      fs.writeFileSync(file, JSON.stringify(info));
      const entry = { at: Date.now(), info, file };
      this.entries.set(url, entry);
      return entry;
    }).finally(() => this.pending.delete(url));
    this.pending.set(url, job);
    return job;
  }

  extract(url) {
    const bin = tools.find("yt-dlp");
    if (!bin) return Promise.reject(new Error("yt-dlp was not found. Install it with: winget install yt-dlp.yt-dlp"));
    const args = ["-J", "--no-playlist", "--no-warnings", ...tools.jsRuntimeArgs(), url];
    return new Promise((resolve, reject) => {
      execFile(bin, args, { windowsHide: true, maxBuffer: 256 * 1024 * 1024, timeout: 120000, env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" } },
        (err, stdout, stderr) => {
          if (err) {
            const lines = String(stderr || err.message).trim().split(/\r?\n/);
            return reject(new Error(lines[lines.length - 1] || "yt-dlp failed"));
          }
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new Error("yt-dlp returned unreadable output"));
          }
        });
    });
  }
}

module.exports = { isYoutubeUrl, humanSize, buildOptions, publicOptions, InfoCache };
