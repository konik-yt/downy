const { app } = require("electron");
const { EventEmitter } = require("events");
const { testVar } = require("./dev");

const OWNER = "konik-yt";
const REPO = "downy";
const FIRST_CHECK = 15 * 1000;
const EVERY = 4 * 60 * 60 * 1000;

class Updater extends EventEmitter {
  constructor() {
    super();
    this.state = { status: app.isPackaged ? "idle" : "off", current: app.getVersion(), version: null, percent: 0, error: null };
    if (!app.isPackaged) return;

    const { autoUpdater } = require("electron-updater");
    this.au = autoUpdater;
    autoUpdater.setFeedURL(testVar("DOWNY_UPDATE_URL")
      ? { provider: "generic", url: testVar("DOWNY_UPDATE_URL") }
      : { provider: "github", owner: OWNER, repo: REPO });
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.logger = null;

    autoUpdater.on("checking-for-update", () => this.set({ status: this.state.status === "ready" ? "ready" : "checking", error: null }));
    autoUpdater.on("update-not-available", () => this.set({ status: "latest", version: null }));
    autoUpdater.on("update-available", (info) => this.set({ status: "downloading", version: info.version, percent: 0 }));
    autoUpdater.on("download-progress", (p) => this.set({ status: "downloading", percent: Math.round(p.percent || 0) }));
    autoUpdater.on("update-downloaded", (info) => this.set({ status: "ready", version: info.version, percent: 100 }));
    autoUpdater.on("error", (e) => {
      if (this.state.status === "ready") return;
      this.set({ status: "error", error: friendly(e) });
    });
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit("change", this.state);
  }

  start() {
    if (!this.au) return;
    setTimeout(() => this.check(), FIRST_CHECK);
    setInterval(() => this.check(), EVERY);
  }

  async check() {
    if (!this.au || ["checking", "downloading", "ready"].includes(this.state.status)) return this.state;
    try {
      await this.au.checkForUpdates();
    } catch (e) {
      this.set({ status: "error", error: friendly(e) });
    }
    return this.state;
  }

  get ready() {
    return this.state.status === "ready";
  }

  install(runAfter) {
    if (!this.ready) return false;
    this.au.quitAndInstall(true, runAfter);
    return true;
  }
}

function friendly(e) {
  const msg = String(e?.message || e);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|net::ERR/i.test(msg)) return "Downy could not reach GitHub. It tries again later.";
  if (/404|latest\.yml/i.test(msg)) return "The latest release has no update files yet. It tries again later.";
  return msg.split("\n")[0].slice(0, 200);
}

module.exports = { Updater };
