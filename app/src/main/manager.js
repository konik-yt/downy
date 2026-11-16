// Download queue: runs a few downloads at once, saves their state so they can
// be paused and resumed (also across restarts), and sorts finished files into
// one folder per format (MP3, M4A, 720p, 1080p and so on).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");
const { EventEmitter } = require("events");
const tools = require("./tools");
const { buildOptions } = require("./formats");
const { downloadStream, streamDone, streamBytes, AbortError } = require("./segmented");

const ACTIVE = new Set(["downloading", "merging", "converting"]);
const FINISHED = new Set(["done", "error", "cancelled"]);
const PROGRESS_RE = /^DOWNY\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|(.*)$/;

const CHILD_ENV = { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" };

function safeName(name) {
  const clean = String(name || "video")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "");
  return (clean || "video").slice(0, 150);
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
    this.ticker = setInterval(() => this.tick(), 500);
  }

  // ------------------------------------------------------------ persistence

  load() {
    let rows = [];
    try {
      rows = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {}
    for (const j of rows) {
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
      kind: j.kind, status: j.status, error: j.error, downloaded: j.downloaded, expected, progress,
      speed: j.speed || 0, eta: j.eta, filepath: j.filepath, filename: j.filepath ? path.basename(j.filepath) : "",
      created: j.created, finished: j.finished, mode: j.mode, phase: j.phase || "",
      stream: current ? { role: current.role, index: j.streams.indexOf(current) + 1, count: j.streams.length } : null,
      segments, connections: segments.filter((s) => s.live).length || (rt?.proc ? this.settings.get().connections : 0),
      postProgress: j.postProgress || 0,
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

  folderCounts() {
    const counts = {};
    for (const j of this.jobs.values()) if (j.status === "done") counts[j.folder] = (counts[j.folder] || 0) + 1;
    return counts;
  }

  // ----------------------------------------------------------------- control

  async add(url, optionId) {
    const entry = await this.cache.get(url);
    const option = buildOptions(entry.info).find((o) => o.id === optionId);
    if (!option) throw new Error("That format is not available for this video");
    const info = entry.info;
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const http = option.streams.every((s) => /^https?$/.test(s.protocol));
    const job = {
      id, url, videoId: info.id, title: info.title || url, thumbnail: info.thumbnail, duration: info.duration || 0,
      optionId, kind: option.kind, height: option.height || null, label: option.label, folder: option.folder,
      selector: option.streams.map((s) => s.formatId).join("+"),
      mode: http ? "segmented" : "ytdlp",
      streams: option.streams.map((s, i) => ({ ...s, path: "", segments: null, index: i })),
      expected: option.size || 0, downloaded: 0, speed: 0, eta: null,
      status: "queued", error: "", filepath: "", created: Date.now(), finished: null, infoFile: entry.file,
    };
    this.jobs.set(id, job);
    this.save();
    this.changed();
    this.schedule();
    return this.public(job);
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
    if (!FINISHED.has(j.status)) this.cleanup(j);
    this.jobs.delete(id);
    this.save();
    this.changed();
  }

  clearFinished() {
    for (const [id, j] of this.jobs) if (FINISHED.has(j.status)) this.jobs.delete(id);
    this.save();
    this.changed();
  }

  async shutdown() {
    clearInterval(this.ticker);
    for (const [id, rt] of this.runtime) {
      const j = this.jobs.get(id);
      if (j) j.pausing = true;
      rt.ctrl.abort();
      if (rt.proc) killTree(rt.proc);
    }
    await Promise.allSettled([...this.runtime.values()].map((rt) => rt.done));
    for (const j of this.jobs.values()) if (ACTIVE.has(j.status)) j.status = "paused";
    this.save();
  }

  // --------------------------------------------------------------- schedule

  activeCount() {
    return [...this.jobs.values()].filter((j) => ACTIVE.has(j.status)).length;
  }

  schedule() {
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

  partsDir() {
    const dir = path.join(this.settings.get().downloadDir, ".downy-parts");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      if (process.platform === "win32") execFile("attrib", ["+h", dir], { windowsHide: true }, () => {});
    }
    return dir;
  }

  targetDir(j) {
    const s = this.settings.get();
    const dir = s.organize ? path.join(s.downloadDir, j.folder) : s.downloadDir;
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  targetName(j) {
    const base = safeName(j.title);
    if (j.kind === "video") return `${base} (${j.height}p).mp4`;
    if (j.kind === "mp3") return `${base}.mp3`;
    return `${base}.m4a`;
  }

  async run(j, rt) {
    try {
      if (!tools.find("ffmpeg")) throw new Error("ffmpeg was not found. Install it with: winget install Gyan.FFmpeg");
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
    if (j.streams.some((st) => !streamDone(st) && linkExpired(st.url))) await this.refreshUrls(j);
    for (const st of j.streams) {
      if (streamDone(st) && st.path && fs.existsSync(st.path)) continue;
      if (!st.path) st.path = path.join(parts, `${j.id}.${st.role}.${st.ext}`);
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
      args = ["-i", inputs[0], "-vn", "-c:a", "copy", ...meta, out];
    }
    j.postProgress = 0;
    this.changed();
    try {
      await this.ffmpeg(args, j, rt);
    } catch (e) {
      if (j.kind !== "video" || rt.ctrl.signal.aborted) throw e;
      // Some codec pairs do not fit in MP4. MKV holds anything.
      fs.rmSync(out, { force: true });
      const mkv = uniquePath(out.replace(/\.mp4$/, ".mkv"));
      await this.ffmpeg([...args.slice(0, -3), mkv], j, rt);
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
  runYtdlp(j, rt) {
    const bin = tools.find("yt-dlp");
    if (!bin) throw new Error("yt-dlp was not found");
    const s = this.settings.get();
    const dir = this.targetDir(j);
    const base = safeName(j.title) + (j.kind === "video" ? ` (${j.height}p)` : "");
    const args = [
      fs.existsSync(j.infoFile || "") ? "--load-info-json" : "--no-playlist",
      fs.existsSync(j.infoFile || "") ? j.infoFile : j.url,
      "-f", j.selector, "-P", dir, "-P", `temp:${this.partsDir()}`, "-o", `${base}.%(ext)s`,
      "-N", String(s.connections), "--newline", "--progress", "--no-mtime", "--no-warnings",
      "--ffmpeg-location", tools.find("ffmpeg"),
      "--progress-template",
      "download:DOWNY|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(info.format_id)s",
      "--print", "after_move:DOWNY_FILE|%(filepath)s",
      ...tools.jsRuntimeArgs(),
    ];
    if (j.kind === "video") args.push("--merge-output-format", "mp4");
    if (j.kind === "mp3") args.push("-x", "--audio-format", "mp3", "--audio-quality", "0");
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

  cleanup(j) {
    for (const st of j.streams || []) {
      if (st.path) fs.rmSync(st.path, { force: true });
    }
  }
}

module.exports = { Manager, FINISHED, ACTIVE };
