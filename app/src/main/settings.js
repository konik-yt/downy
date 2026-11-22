const fs = require("fs");
const path = require("path");
const os = require("os");
const { EventEmitter } = require("events");

const DEFAULTS = {
  downloadDir: path.join(os.homedir(), "Downloads", "Downy"),
  connections: 8,
  maxActive: 3,
  organize: true,
  showOnStart: true,
  closeToTray: true,
  openAtLogin: false,
  notify: true,
  confirm: true,
  onboarded: false,
  extensionSetup: false,
};

const LIMITS = { connections: [1, 32], maxActive: [1, 10] };

class Settings extends EventEmitter {
  constructor(dir) {
    super();
    this.file = path.join(dir, "settings.json");
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(this.file, "utf8"));
      // Settings saved by a version without the welcome screen belong to someone already set up.
      if (saved && typeof saved === "object" && saved.onboarded === undefined) saved.onboarded = true;
      for (const k of Object.keys(saved || {})) if (typeof DEFAULTS[k] === "string" && !String(saved[k] ?? "").trim()) delete saved[k];
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
