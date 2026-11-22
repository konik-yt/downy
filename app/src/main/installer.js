const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { EventEmitter } = require("events");
const tools = require("./tools");

const PACKAGES = {
  "yt-dlp": { label: "yt-dlp", id: "yt-dlp.yt-dlp" },
  ffmpeg: { label: "ffmpeg", id: "Gyan.FFmpeg" },
  deno: { label: "Deno", id: "DenoLand.Deno" },
};
const FLAGS = ["--exact", "--silent", "--accept-source-agreements", "--accept-package-agreements", "--disable-interactivity"];
const UPDATE_EVERY = 24 * 60 * 60 * 1000;
const UNITS = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
// winget draws its progress bar as text, like "  12.0 MB / 23.4 MB".
const PROGRESS_RE = /([\d.]+)\s*(B|KB|MB|GB)\s*\/\s*([\d.]+)\s*(B|KB|MB|GB)/;
const NO_UPDATE = [0x8a15002b, -1978335189];

function winget(args, onLine) {
  return new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn("winget", args, { windowsHide: true });
    } catch (e) {
      return reject(e);
    }
    const tail = [];
    let buf = "";
    const read = (d) => {
      buf += d;
      const parts = buf.split(/[\r\n]+/);
      buf = parts.pop();
      for (const line of parts.map((l) => l.trim()).filter(Boolean)) {
        onLine?.(line);
        tail.push(line);
        if (tail.length > 6) tail.shift();
      }
      if (buf.trim()) onLine?.(buf.trim()); // progress bars redraw without a newline
    };
    proc.stdout.on("data", read);
    proc.stderr.on("data", read);
    proc.on("error", (e) => reject(e.code === "ENOENT"
      ? new Error("winget is not on this PC. Install App Installer from the Microsoft Store, then try again.")
      : e));
    proc.on("close", (code) => {
      if (code === 0 || NO_UPDATE.includes(code)) resolve();
      else reject(new Error(tail.filter((l) => !PROGRESS_RE.test(l)).pop() || `winget stopped with code ${code}`));
    });
  });
}

class Installer extends EventEmitter {
  constructor(dataDir) {
    super();
    this.stamp = path.join(dataDir, "yt-dlp-checked");
    this.state = { running: false, tool: null, label: "", received: 0, total: 0, error: null, done: [] };
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit("change", this.state);
  }

  missing() {
    const s = tools.status();
    return [!s.ytdlp && "yt-dlp", !s.ffmpeg && "ffmpeg", !s.jsRuntime && "deno"].filter(Boolean);
  }

  async install() {
    if (this.state.running) return this.state;
    this.set({ running: true, error: null, done: [] });
    let current = null;
    try {
      for (const name of this.missing()) {
        current = name;
        await this.installOne(name);
        tools.resetCache();
        this.set({ done: [...this.state.done, name] });
      }
      this.set({ running: false, tool: null, label: "" });
    } catch (e) {
      this.set({ running: false, error: `${PACKAGES[current]?.label || "A tool"} could not be installed. ${e.message}` });
    } finally {
      tools.resetCache();
    }
    return this.state;
  }

  installOne(name) {
    const pkg = PACKAGES[name];
    this.set({ tool: name, label: pkg.label, received: 0, total: 0 });
    let last = 0;
    return winget(["install", "--id", pkg.id, ...FLAGS], (line) => {
      const m = PROGRESS_RE.exec(line);
      if (!m || Date.now() - last < 200) return;
      last = Date.now();
      this.set({ received: Number(m[1]) * UNITS[m[2]], total: Number(m[3]) * UNITS[m[4]] });
    });
  }

  async updateYtdlp() {
    const bin = tools.status().ytdlp;
    if (!bin || !/[\\/]WinGet[\\/]/i.test(bin) || this.state.running) return;
    try {
      if (Date.now() - fs.statSync(this.stamp).mtimeMs < UPDATE_EVERY) return;
    } catch {}
    try {
      await winget(["upgrade", "--id", PACKAGES["yt-dlp"].id, ...FLAGS]);
      fs.writeFileSync(this.stamp, new Date().toISOString());
    } catch (e) {
      console.error("yt-dlp update failed", e.message);
    }
  }
}

module.exports = { Installer };
