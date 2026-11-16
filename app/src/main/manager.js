// Download queue: runs a few downloads at once, saves their state so they can
// be paused and resumed (also across restarts), and sorts finished files into
// one folder per format (MP3, M4A, 720p, 1080p and so on).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");
const { EventEmitter } = require("events");
const tools = require("./tools");
const { buildOptions, isYoutubeUrl, TTL: INFO_TTL } = require("./formats");
const { downloadStream, streamDone, streamBytes, probe, AbortError } = require("./segmented");

const ACTIVE = new Set(["downloading", "merging", "converting"]);
const FINISHED = new Set(["done", "error", "cancelled"]);
const PROGRESS_RE = /^DOWNY\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|(.*)$/;

const CHILD_ENV = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };

function cleanName(name) {
  return String(name || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
}

function safeName(name) {
  return (cleanName(name) || "video").slice(0, 150);
}

// Like safeName, but a long file name is cut before its extension so the extension stays.
function safeFileName(name) {
  const clean = cleanName(name) || "download";
  if (clean.length <= 150) return clean;
  const ext = path.extname(clean).slice(0, 20);
  return cleanName(clean.slice(0, 150 - ext.length)) + ext;
}

// Folder layout inside the download folder:
//   Downloads\          files caught from the browser or pasted links
//   YouTube\<format>\   YouTube files, one folder per format (MP3, M4A, 720p, 1080p ...)
//   Videos\<format>\    videos from every other site yt-dlp knows
const FILES_DIR = "Downloads";
const LEGACY_PARTS = ".downy-parts";
const YOUTUBE_DIR = "YouTube";
const VIDEOS_DIR = "Videos";

function nameFromUrl(url) {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(last);
  } catch {
    return "";
  }
}

function uniquePath(file) {
  if (!fs.existsSync(file)) return file;
  const { dir, name, ext } = path.parse(file);
  for (let i = 2; ; i++) {
    const next = path.join(dir, `${name} (${i})${ext}`);
    if (!fs.existsSync(next)) return next;
  }
}

// googlevideo links carry their expiry time (seconds) in the "expire" parameter.
function linkExpired(url) {
  try {
    const expire = Number(new URL(url).searchParams.get("expire"));
    return expire > 0 && Date.now() / 1000 > expire - 10 * 60;
  } catch {
    return false;
  }
}

function removeQuietly(file) {
  try {
    fs.rmSync(file, { force: true });
  } catch {}
}

function killTree(proc) {
  if (!proc || proc.exitCode !== null) return;
  if (process.platform === "win32") execFile("taskkill", ["/T", "/F", "/PID", String(proc.pid)], { windowsHide: true }, () => {});
  else proc.kill("SIGKILL");
}

class Manager extends EventEmitter {
  constructor({ dataDir, cache, settings }) {
    super();
    this.dataDir = dataDir;
    this.cache = cache;
    this.settings = settings;
    this.file = path.join(dataDir, "downloads.json");
    this.jobs = new Map();
    this.runtime = new Map(); // id -> { ctrl, proc, bytes, samples }
    this.load();
    this.sweepParts();
    this.ticker = setInterval(() => this.tick(), 500);
  }

  // ------------------------------------------------------------ persistence

  load() {
    let rows = [];
    try {
      rows = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {}
    if (!Array.isArray(rows)) rows = [];
    for (const j of rows) {
      if (!j || typeof j !== "object" || !j.id) continue;
      if (j.streams && !Array.isArray(j.streams)) j.streams = [];
      // Anything that was running when Downy closed comes back paused.
      if (ACTIVE.has(j.status) || j.status === "queued") j.status = j.status === "queued" ? "queued" : "paused";
      j.speed = 0;
      j.eta = null;
      this.jobs.set(j.id, j);
    }
  }

  save() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const rows = [...this.jobs.values()].map((j) => ({
      ...j,
      streams: j.streams?.map((s) => ({ ...s, segments: s.segments?.map(({ start, end, pos }) => ({ start, end, pos })) })),
    }));
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const tmp = this.file + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(rows));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error("Could not save downloads", e);
    }
  }

  saveSoon() {
    if (!this.saveTimer) this.saveTimer = setTimeout(() => this.save(), 1000);
  }

  // ------------------------------------------------------------------ views

  public(j) {
    const expected = j.expected || j.streams?.reduce((n, s) => n + (s.size || 0), 0) || 0;
    let progress = 0;
    if (j.status === "done") progress = 1;
    else if (expected) progress = Math.min(j.downloaded / expected, 0.999);
    const current = j.streams?.find((s) => !streamDone(s)) || j.streams?.[j.streams.length - 1];
    const rt = this.runtime.get(j.id);
    let segments = [];
    if (current?.segments && current.size) {
      segments = current.segments.map((s) => ({
        s: s.start / current.size,
        e: (s.end + 1) / current.size,
        p: Math.min(s.pos, s.end + 1) / current.size,
        live: !!s.busy,
      }));
    }
    return {
      id: j.id, url: j.url, title: j.title, thumbnail: j.thumbnail, label: j.label, folder: j.folder,
      source: j.source || "youtube", dir: j.dir || j.folder, ext: j.ext || "",
      kind: j.kind, status: j.status, error: j.error, downloaded: j.downloaded, expected, progress,
      speed: j.speed || 0, eta: j.eta, filepath: j.filepath, filename: j.filepath ? path.basename(j.filepath) : "",
      created: j.created, finished: j.finished, mode: j.mode, phase: j.phase || "",
      stream: current ? { role: current.role, index: j.streams.indexOf(current) + 1, count: j.streams.length } : null,
      segments, connections: segments.filter((s) => s.live).length || (rt?.proc ? this.settings.get().connections : 0),
      postProgress: j.postProgress || 0, resumable: j.resumable,
    };
  }

  list() {
    return [...this.jobs.values()].sort((a, b) => b.created - a.created).map((j) => this.public(j));
  }

  get(id) {
    return this.jobs.get(id);
  }

  changed() {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit("update", this.list());
    }, 150);
  }

  // Info files that yt-dlp may still need to resume a download.
  infoFiles() {
    const keep = new Set();
    for (const j of this.jobs.values()) {
      if (j.infoFile && j.status !== "done" && j.status !== "cancelled") keep.add(path.resolve(j.infoFile));
    }
    return keep;
  }

  folderCounts() {
    const counts = {};
    for (const j of this.jobs.values()) {
      const dir = j.dir || j.folder;
      if (j.status === "done") counts[dir] = (counts[dir] || 0) + 1;
    }
    return counts;
  }

  // ----------------------------------------------------------------- control

  // A download is built as a draft first, so the confirm window can show its
  // default folder and name, then added with commit() once the user agrees.
  async add(url, optionId, custom) {
    return this.commit(await this.draftVideo(url, optionId), custom);
  }

  async addFile(spec, custom) {
    return this.commit(await this.draftFile(spec), custom);
  }

  // custom: { dir, name } from the confirm window. dir is an absolute folder; name has no folder in it.
  commit(job, custom = {}) {
    if (custom.dir && path.isAbsolute(String(custom.dir))) job.customDir = path.resolve(String(custom.dir));
    if (custom.name && cleanName(custom.name)) job.customName = cleanName(custom.name);
    if (job.customName && job.kind === "file") job.title = job.filename = this.targetName(job);
    this.jobs.set(job.id, job);
    this.save();
    this.changed();
    this.schedule();
    return this.public(job);
  }

  // Where a draft would be saved, without creating anything.
  target(job) {
    return { dir: this.dirFor(job).abs, name: this.targetName(job) };
  }

  async draftVideo(url, optionId) {
    const entry = await this.cache.get(url);
    const option = buildOptions(entry.info).find((o) => o.id === optionId);
    if (!option) throw new Error("That format is not available for this video");
    const info = entry.info;
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const http = option.streams.length > 0 && option.streams.every((s) => /^https?$/.test(s.protocol));
    const job = {
      id, url, source: isYoutubeUrl(url) ? "youtube" : "video", videoId: info.id, title: info.title || url, thumbnail: info.thumbnail, duration: info.duration || 0,
      optionId, kind: option.kind, height: option.height || null, label: option.label, folder: option.folder,
      selector: option.selector || option.streams.map((s) => s.formatId).join("+"),
      mode: http ? "segmented" : "ytdlp",
      streams: option.streams.map((s, i) => ({ ...s, path: "", segments: null, index: i })),
      expected: option.size || 0, downloaded: 0, speed: 0, eta: null,
      status: "queued", error: "", filepath: "", created: Date.now(), finished: null, infoFile: entry.file,
    };
    return job;
  }

  // A normal file download, from the browser extension or a pasted link.
  async draftFile({ url, filename, referrer, cookies, userAgent, mime }) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("That is not a valid link");
    }
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("Downy can only download http and https links");
    const headers = {
      "User-Agent": userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      Accept: "*/*",
    };
    if (referrer) headers.Referer = referrer;
    if (cookies) headers.Cookie = cookies;
    const st = { role: "file", formatId: "", ext: "", protocol: parsed.protocol.slice(0, -1), url, headers, size: 0, path: "", segments: null, index: 0 };

    // Check the link before taking the download from the browser, so a link that
    // only works inside the browser can go back to it.
    const info = await probe(st, AbortSignal.timeout(20000));
    const name = safeFileName(filename || info.filename || nameFromUrl(info.finalUrl) || nameFromUrl(url) || "download");
    const wantsPage = /html/.test(mime || "") || /\.html?$/i.test(name);
    if (info.type === "text/html" && !wantsPage) throw new Error("This link opens a web page, not a file");
    st.size = info.size;
    st.ranges = info.ranges;
    st.ext = path.extname(name).slice(1).toLowerCase();

    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const job = {
      id, url, source: "web", title: name, filename: name, thumbnail: null, duration: 0,
      kind: "file", ext: st.ext, label: st.ext ? st.ext.toUpperCase() : "File", folder: FILES_DIR,
      mode: "segmented", streams: [st], expected: st.size || 0, downloaded: 0, speed: 0, eta: null,
      status: "queued", error: "", filepath: "", created: Date.now(), finished: null, resumable: info.ranges,
    };
    return job;
  }

  pause(id) {
    const j = this.jobs.get(id);
    if (!j) return;
    if (j.status === "queued") j.status = "paused";
    else if (j.status === "downloading") {
      j.pausing = true;
      const rt = this.runtime.get(id);
      rt?.ctrl.abort();
      if (rt?.proc) killTree(rt.proc);
    }
    this.save();
    this.changed();
  }

  resume(id) {
    const j = this.jobs.get(id);
    if (!j || !(j.status === "paused" || j.status === "error")) return;
    j.status = "queued";
    j.error = "";
    this.save();
    this.changed();
    this.schedule();
  }

  pauseAll() {
    for (const j of this.jobs.values()) if (j.status === "queued" || j.status === "downloading") this.pause(j.id);
  }

  resumeAll() {
    for (const j of this.jobs.values()) if (j.status === "paused") this.resume(j.id);
  }

  cancel(id) {
    const j = this.jobs.get(id);
    if (!j || FINISHED.has(j.status)) return;
    const rt = this.runtime.get(id);
    if (rt) {
      j.cancelling = true;
      rt.ctrl.abort();
      if (rt.proc) killTree(rt.proc);
    } else {
      j.status = "cancelled";
      j.finished = Date.now();
      this.cleanup(j);
    }
    this.save();
    this.changed();
  }

  remove(id) {
    const j = this.jobs.get(id);
    if (!j || this.runtime.has(id)) return;
    this.jobs.delete(id);
    this.cleanup(j); // a failed job still has its part files for a retry
    this.save();
    this.changed();
  }

  // scope "done" clears finished downloads, "failed" clears failed and cancelled ones, anything else clears both.
  clearFinished(scope) {
    const match = scope === "done" ? (s) => s === "done" : scope === "failed" ? (s) => s === "error" || s === "cancelled" : (s) => FINISHED.has(s);
    for (const [id, j] of this.jobs) {
      if (!match(j.status)) continue;
      this.jobs.delete(id);
      this.cleanup(j);
    }
    this.save();
    this.changed();
  }

  // With resume, downloads that were running come back queued instead of paused.
  async shutdown({ resume = false } = {}) {
    this.stopping = true; // jobs that stop now must not start the next queued one
    clearInterval(this.ticker);
    const running = [...this.runtime.keys()];
    for (const [id, rt] of this.runtime) {
      const j = this.jobs.get(id);
      if (j) j.pausing = true;
      rt.ctrl.abort();
      if (rt.proc) killTree(rt.proc);
    }
    await Promise.allSettled([...this.runtime.values()].map((rt) => rt.done));
    for (const j of this.jobs.values()) if (ACTIVE.has(j.status)) j.status = "paused";
    if (resume) for (const id of running) if (this.jobs.get(id)?.status === "paused") this.jobs.get(id).status = "queued";
    this.save();
  }

  // --------------------------------------------------------------- schedule

  activeCount() {
    return [...this.jobs.values()].filter((j) => ACTIVE.has(j.status)).length;
  }

  schedule() {
    if (this.stopping) return;
    const max = Math.max(1, this.settings.get().maxActive);
    const queued = [...this.jobs.values()].filter((j) => j.status === "queued").sort((a, b) => a.created - b.created);
    for (const j of queued) {
      if (this.activeCount() >= max) break;
      this.start(j);
    }
  }

  tick() {
    let changed = false;
    for (const [id, rt] of this.runtime) {
      const j = this.jobs.get(id);
      if (!j || j.status !== "downloading" || j.mode !== "segmented") continue;
      const now = Date.now();
      rt.samples.push([now, rt.bytes]);
      while (rt.samples.length > 2 && now - rt.samples[0][0] > 4000) rt.samples.shift();
      const [t0, b0] = rt.samples[0];
      const speed = now > t0 ? ((rt.bytes - b0) * 1000) / (now - t0) : 0;
      j.speed = speed;
      j.downloaded = j.streams.reduce((n, s) => n + streamBytes(s), 0);
      const left = Math.max(0, (j.expected || 0) - j.downloaded);
      j.eta = speed > 0 && j.expected ? left / speed : null;
      changed = true;
    }
    if (changed) {
      this.changed();
      this.saveSoon();
    }
  }

  start(j) {
    const ctrl = new AbortController();
    const rt = { ctrl, proc: null, bytes: 0, samples: [] };
    this.runtime.set(j.id, rt);
    j.status = "downloading";
    j.error = "";
    j.phase = "";
    j.pausing = false;
    j.cancelling = false;
    this.changed();
    rt.done = this.run(j, rt).finally(() => {
      this.runtime.delete(j.id);
      this.save();
      this.changed();
      this.schedule();
    });
  }

  // Unfinished files live in Downy's own data folder, so the download folder only holds finished files.
  partsDir() {
    const dir = path.join(this.dataDir, "parts");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  // Older versions kept unfinished files in a hidden .downy-parts folder inside the download folder.
  isPartsDir(dir) {
    return path.basename(dir) === LEGACY_PARTS || path.resolve(dir) === path.resolve(this.dataDir, "parts");
  }

  // Deletes leftover temporary files that no download uses any more, and the old
  // .downy-parts folders once they are empty. That includes folders left behind in
  // download folders the user has since moved away from.
  sweepParts() {
    const dirs = new Set([this.partsDir(), path.join(this.settings.get().downloadDir, LEGACY_PARTS)]);
    const used = new Set();
    const bases = [];
    for (const j of this.jobs.values()) {
      for (const st of j.streams || []) {
        if (!st.path) continue;
        used.add(path.resolve(st.path).toLowerCase());
        dirs.add(path.dirname(st.path));
      }
      if (j.tempDir) dirs.add(j.tempDir);
      if (j.mode === "ytdlp" && j.status !== "done" && j.status !== "cancelled") bases.push(this.ytdlpBase(j) + ".");
      // A finished file sits one to three folders below the download folder it was saved to.
      let up = j.filepath ? path.dirname(j.filepath) : "";
      for (let i = 0; up && i < 3; i++) {
        dirs.add(path.join(up, LEGACY_PARTS));
        up = path.dirname(up) === up ? "" : path.dirname(up);
      }
    }
    const current = path.resolve(this.partsDir());
    for (const dir of dirs) {
      if (!this.isPartsDir(dir)) continue;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      let left = entries.length;
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (!e.isFile() || used.has(path.resolve(full).toLowerCase()) || bases.some((b) => e.name.startsWith(b))) continue;
        try {
          fs.rmSync(full, { force: true });
          left--;
        } catch {}
      }
      if (!left && path.resolve(dir) !== current) {
        try {
          fs.rmdirSync(dir);
        } catch {}
      }
    }
  }

  // rel is the folder inside the download folder, like "YouTube/1080p", or "Other"
  // for a folder the user picked outside it.
  dirFor(j) {
    const s = this.settings.get();
    if (j.customDir) {
      const rel = path.relative(path.resolve(s.downloadDir), j.customDir);
      const inside = rel && !rel.startsWith("..") && !path.isAbsolute(rel);
      return { abs: j.customDir, rel: inside ? rel.split(path.sep).join("/") : "Other" };
    }
    let rel;
    if (j.kind === "file") rel = FILES_DIR;
    else {
      const root = j.source === "video" ? VIDEOS_DIR : YOUTUBE_DIR;
      rel = s.organize ? `${root}/${j.folder}` : root;
    }
    return { abs: path.join(s.downloadDir, ...rel.split("/")), rel };
  }

  targetDir(j) {
    const { abs, rel } = this.dirFor(j);
    j.dir = rel;
    fs.mkdirSync(abs, { recursive: true });
    return abs;
  }

  // The extension that goes with a download's format.
  extFor(j) {
    return j.kind === "video" ? "mp4" : j.kind === "mp3" ? "mp3" : j.kind === "file" ? j.ext || "" : "m4a";
  }

  targetName(j) {
    if (j.customName) {
      const ext = this.extFor(j);
      if (j.kind === "file") {
        const name = safeFileName(j.customName);
        return ext && !path.extname(name) ? `${name}.${ext}` : name;
      }
      return `${this.ytdlpBase(j)}.${ext}`;
    }
    const base = safeName(j.title);
    if (j.kind === "video") return j.height ? `${base} (${j.height}p).mp4` : `${base}.mp4`;
    if (j.kind === "mp3") return `${base}.mp3`;
    if (j.kind === "file") return safeFileName(j.filename);
    return `${base}.m4a`;
  }

  async run(j, rt) {
    try {
      if (j.kind !== "file" && !tools.find("ffmpeg")) throw new Error("ffmpeg was not found. Open Settings in Downy and click Install tools.");
      if (j.mode === "ytdlp") await this.runYtdlp(j, rt);
      else await this.runSegmented(j, rt);
      if (j.mode === "segmented") await this.postProcess(j, rt);
      j.status = "done";
      j.downloaded = j.expected = Math.max(j.expected, j.downloaded);
      j.finished = Date.now();
      j.speed = 0;
      j.eta = null;
      this.cleanup(j);
      this.emit("finished", this.public(j));
    } catch (e) {
      j.speed = 0;
      j.eta = null;
      if (j.cancelling) {
        j.status = "cancelled";
        j.finished = Date.now();
        this.cleanup(j);
      } else if (j.pausing || e instanceof AbortError) {
        j.status = "paused";
      } else {
        j.status = "error";
        j.error = e.message || String(e);
        j.finished = Date.now();
        this.emit("failed", this.public(j));
      }
    } finally {
      j.pausing = false;
      j.cancelling = false;
      j.phase = "";
    }
  }

  async refreshUrls(j) {
    if (j.kind === "file") {
      throw Object.assign(new Error("The download link stopped working. Start the download again from the website."), { retry: false });
    }
    const entry = await this.cache.get(j.url, { fresh: true });
    j.infoFile = entry.file;
    for (const st of j.streams) {
      const f = (entry.info.formats || []).find((x) => String(x.format_id) === st.formatId);
      if (!f) throw new Error("YouTube no longer offers this format. Remove the download and start it again.");
      st.url = f.url;
      st.headers = f.http_headers || {};
    }
    this.saveSoon();
  }

  async runSegmented(j, rt) {
    const parts = this.partsDir();
    // Links from YouTube expire after a few hours, so a download resumed later needs fresh ones.
    if (j.kind !== "file" && j.streams.some((st) => !streamDone(st) && linkExpired(st.url))) await this.refreshUrls(j);
    for (const st of j.streams) {
      if (streamDone(st) && st.path && fs.existsSync(st.path)) continue;
      if (!st.path) st.path = path.join(parts, `${j.id}.${st.role}.${st.ext || "bin"}`);
      if (st.segments && !fs.existsSync(st.path)) st.segments = null; // part file was deleted
      await downloadStream(st, {
        connections: this.settings.get().connections,
        signal: rt.ctrl.signal,
        onBytes: (n) => (rt.bytes += n),
        refresh: () => this.refreshUrls(j),
      });
      j.expected = j.streams.reduce((n, s) => n + (s.size || 0), 0);
      this.saveSoon();
    }
    j.downloaded = j.streams.reduce((n, s) => n + streamBytes(s), 0);
  }

  async postProcess(j, rt) {
    const out = uniquePath(path.join(this.targetDir(j), this.targetName(j)));
    if (j.kind === "file") {
      const from = j.streams[0].path;
      try {
        await fs.promises.rename(from, out);
      } catch {
        // The download folder is on another drive. Copy without blocking the app; cleanup removes the original.
        try {
          await fs.promises.copyFile(from, out);
        } catch (e) {
          removeQuietly(out);
          throw e;
        }
      }
      j.filepath = out;
      return;
    }
    const inputs = j.streams.map((s) => s.path);
    const meta = ["-metadata", `title=${j.title}`, "-metadata", `comment=${j.url}`];
    let args;
    if (j.kind === "video" && inputs.length === 2) {
      j.status = "merging";
      args = ["-i", inputs[0], "-i", inputs[1], "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", ...meta, "-movflags", "+faststart", out];
    } else if (j.kind === "video") {
      j.status = "merging";
      args = ["-i", inputs[0], "-c", "copy", ...meta, "-movflags", "+faststart", out];
    } else if (j.kind === "mp3") {
      j.status = "converting";
      args = ["-i", inputs[0], "-vn", "-c:a", "libmp3lame", "-q:a", "0", ...meta, out];
    } else {
      j.status = "converting";
      // Without m4a audio the picker falls back to webm (opus), which an .m4a file cannot hold.
      const codec = j.streams[0].ext === "m4a" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k"];
      args = ["-i", inputs[0], "-vn", ...codec, ...meta, out];
    }
    j.postProgress = 0;
    this.changed();
    // A stopped or failed ffmpeg leaves a broken file behind; uniquePath made sure it is ours.
    try {
      await this.ffmpeg(args, j, rt);
    } catch (e) {
      removeQuietly(out);
      if (j.kind !== "video" || rt.ctrl.signal.aborted) throw e;
      // Some codec pairs do not fit in MP4. MKV holds anything.
      const mkv = uniquePath(out.replace(/\.mp4$/, ".mkv"));
      try {
        await this.ffmpeg([...args.slice(0, -3), mkv], j, rt);
      } catch (e2) {
        removeQuietly(mkv);
        throw e2;
      }
      j.filepath = mkv;
      return;
    }
    j.filepath = out;
  }

  ffmpeg(args, j, rt) {
    return new Promise((resolve, reject) => {
      const proc = spawn(tools.find("ffmpeg"), ["-y", "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", ...args], { windowsHide: true });
      rt.proc = proc;
      let err = "";
      proc.stdout.on("data", (d) => {
        const m = /out_time_(?:us|ms)=(\d+)/.exec(String(d));
        if (m && j.duration) {
          j.postProgress = Math.min(1, Number(m[1]) / 1e6 / j.duration);
          this.changed();
        }
      });
      proc.stderr.on("data", (d) => (err = (err + d).slice(-2000)));
      proc.on("error", reject);
      proc.on("close", (code) => {
        rt.proc = null;
        if (rt.ctrl.signal.aborted) reject(new AbortError());
        else if (code === 0) resolve();
        else reject(new Error(err.trim().split(/\r?\n/).pop() || `ffmpeg failed (${code})`));
      });
    });
  }

  // Formats that are not plain HTTP files (HLS or DASH fragments) go through yt-dlp,
  // which also downloads fragments over several connections and resumes .part files.
  async runYtdlp(j, rt) {
    const bin = tools.find("yt-dlp");
    if (!bin) throw new Error("yt-dlp was not found");
    const s = this.settings.get();
    const dir = this.targetDir(j);
    // yt-dlp reads % as the start of a template field, so a literal % is written %%.
    const base = this.ytdlpBase(j).replace(/%/g, "%%");
    // A resumed job keeps the temp folder it started in, where its partial files are.
    if (!j.tempDir || !fs.existsSync(j.tempDir)) j.tempDir = this.partsDir();
    // The stream links in an old info file have expired; get fresh ones, or let yt-dlp read the page.
    let infoFile = fs.existsSync(j.infoFile || "") ? j.infoFile : "";
    if (infoFile && Date.now() - fs.statSync(infoFile).mtimeMs > INFO_TTL) {
      try {
        infoFile = j.infoFile = (await this.cache.get(j.url, { fresh: true })).file;
      } catch {
        infoFile = "";
      }
      if (rt.ctrl.signal.aborted) throw new AbortError();
    }
    const args = [
      infoFile ? "--load-info-json" : "--no-playlist",
      infoFile || j.url,
      "-f", j.selector, "-P", dir, "-P", `temp:${j.tempDir}`, "-o", `${base}.%(ext)s`,
      "-N", String(s.connections), "--newline", "--progress", "--no-mtime", "--no-warnings",
      "--ffmpeg-location", tools.find("ffmpeg"),
      "--progress-template",
      "download:DOWNY|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.format_id)s",
      "--print", "after_move:DOWNY_FILE|%(filepath)s",
      ...tools.jsRuntimeArgs(),
    ];
    if (j.kind === "video") args.push("--merge-output-format", "mp4");
    if (j.kind === "mp3") args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
    if (j.kind === "audio" && j.streams?.[0]?.ext !== "m4a") args.push("-x", "--audio-format", "m4a");
    return new Promise((resolve, reject) => {
      const proc = spawn(bin, args, { windowsHide: true, env: CHILD_ENV });
      rt.proc = proc;
      const tail = [];
      let partDone = 0, partId = null, partBytes = 0, buf = "";
      proc.stdout.on("data", (d) => {
        buf += d;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        for (const line of lines.map((l) => l.trim()).filter(Boolean)) {
          const m = PROGRESS_RE.exec(line);
          if (m) {
            const done = Number(m[1]) || 0;
            if (m[6] !== partId) {
              partDone += partBytes;
              partId = m[6];
            }
            partBytes = done;
            j.downloaded = partDone + done;
            j.speed = Number(m[4]) || 0;
            j.eta = Number(m[5]) || null;
            if (!j.expected) j.expected = Number(m[2]) || Number(m[3]) || 0;
            this.changed();
          } else if (line.startsWith("DOWNY_FILE|")) j.filepath = line.slice(11);
          else if (line.startsWith("[Merger]")) j.status = "merging";
          else if (line.startsWith("[ExtractAudio]")) j.status = "converting";
          else tail.push(line), tail.length > 8 && tail.shift();
        }
      });
      proc.stderr.on("data", (d) => tail.push(String(d).trim()));
      proc.on("error", reject);
      proc.on("close", (code) => {
        rt.proc = null;
        if (rt.ctrl.signal.aborted || j.pausing || j.cancelling) reject(new AbortError());
        else if (code === 0) resolve();
        else reject(new Error(tail.filter((t) => t.startsWith("ERROR")).pop() || tail.pop() || "yt-dlp failed"));
      });
      rt.ctrl.signal.addEventListener("abort", () => killTree(proc), { once: true });
    });
  }

  ytdlpBase(j) {
    // A name typed with the extension (like "clip.mp4") must not end up as "clip.mp4.mp4".
    if (j.customName) return safeName(j.customName.replace(new RegExp(`\\.${this.extFor(j)}$`, "i"), ""));
    return safeName(j.title) + (j.kind === "video" && j.height ? ` (${j.height}p)` : "");
  }

  // Deletes a job's temporary files. Only ever touches files in a parts folder.
  cleanup(j) {
    for (const st of j.streams || []) {
      if (st.path && this.isPartsDir(path.dirname(st.path))) removeQuietly(st.path);
      delete st.headers; // they can hold the browser's cookies and are not needed any more
    }
    if (j.mode !== "ytdlp") return;
    // yt-dlp names its temp files after the output name, so keep those of other unfinished jobs.
    const others = [...this.jobs.values()]
      .filter((o) => o !== j && o.mode === "ytdlp" && !FINISHED.has(o.status))
      .map((o) => this.ytdlpBase(o) + ".");
    const base = this.ytdlpBase(j) + ".";
    // Jobs from older versions did not record their temp folder; it was inside the download folder.
    const dir = j.tempDir || path.join(this.settings.get().downloadDir, LEGACY_PARTS);
    if (!this.isPartsDir(dir)) return;
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {}
    for (const n of names) {
      if (n.startsWith(base) && !others.some((o) => n.startsWith(o))) removeQuietly(path.join(dir, n));
    }
  }
}

module.exports = { Manager, FINISHED, ACTIVE };
