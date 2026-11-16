const fs = require("fs");
const path = require("path");
const os = require("os");
const { EventEmitter } = require("events");

const DEFAULTS = {
  downloadDir: path.join(os.homedir(), "Downloads", "Downy"),
  connections: 8, // connections per file
  maxActive: 3, // downloads running at the same time
  organize: true, // put files in MP3, M4A, 720p, 1080p ... folders
  showOnStart: true, // bring the window up when the extension starts a download
  closeToTray: true,
  openAtLogin: false,
  notify: true,
};

const LIMITS = { connections: [1, 32], maxActive: [1, 10] };

class Settings extends EventEmitter {
  constructor(dir) {
    super();
    this.file = path.join(dir, "settings.json");
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {}
    this.values = { ...DEFAULTS, ...saved };
  }

  get() {
    return this.values;
  }

  set(patch) {
    const next = { ...this.values };
    for (const [k, v] of Object.entries(patch || {})) {
      if (!(k in DEFAULTS)) continue;
      if (typeof DEFAULTS[k] === "boolean") next[k] = !!v;
      else if (typeof DEFAULTS[k] === "number") {
        const [lo, hi] = LIMITS[k];
        const n = Math.round(Number(v));
        if (Number.isFinite(n)) next[k] = Math.min(hi, Math.max(lo, n));
      } else if (typeof v === "string" && v.trim()) next[k] = v.trim();
    }
    this.values = next;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(next, null, 2));
    this.emit("change", next);
    return next;
  }
}

module.exports = { Settings, LIMITS };
