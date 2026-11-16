// Checks GitHub releases for a newer Downy. The installed app downloads the new
// setup exe in the background and runs it when Downy quits, or right away when
// the user clicks Restart to update. The portable exe cannot replace itself, so
// it only says that a new version is out and links to the release page.
const { app, shell } = require("electron");
const { EventEmitter } = require("events");

const OWNER = "konik-yt";
const REPO = "downy";
const RELEASES = `https://github.com/${OWNER}/${REPO}/releases/latest`;
const FIRST_CHECK = 15 * 1000;
const EVERY = 4 * 60 * 60 * 1000;

class Updater extends EventEmitter {
  constructor() {
    super();
    this.portable = !!process.env.PORTABLE_EXECUTABLE_FILE;
    // status: off (dev build), idle, checking, latest, available, downloading, ready, error
    this.state = { status: app.isPackaged ? "idle" : "off", current: app.getVersion(), version: null, percent: 0, error: null, portable: this.portable };
    if (!app.isPackaged) return;

    // Loaded here so a dev build never touches it.
    const { autoUpdater } = require("electron-updater");
    this.au = autoUpdater;
    // For testing: DOWNY_UPDATE_URL points at a folder with latest.yml and the setup exe.
    autoUpdater.setFeedURL(process.env.DOWNY_UPDATE_URL
      ? { provider: "generic", url: process.env.DOWNY_UPDATE_URL }
      : { provider: "github", owner: OWNER, repo: REPO });
    autoUpdater.autoDownload = !this.portable;
    autoUpdater.autoInstallOnAppQuit = false; // main.js installs after saving the downloads
    autoUpdater.logger = null;

    autoUpdater.on("checking-for-update", () => this.set({ status: this.state.status === "ready" ? "ready" : "checking", error: null }));
    autoUpdater.on("update-not-available", () => this.set({ status: "latest", version: null }));
    autoUpdater.on("update-available", (info) => this.set({ status: this.portable ? "available" : "downloading", version: info.version, percent: 0 }));
    autoUpdater.on("download-progress", (p) => this.set({ status: "downloading", percent: Math.round(p.percent || 0) }));
    autoUpdater.on("update-downloaded", (info) => this.set({ status: "ready", version: info.version, percent: 100 }));
    autoUpdater.on("error", (e) => {
      if (this.state.status === "ready") return; // a later check failing does not undo a finished download
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

  // Runs the downloaded installer. Call it after the downloads are saved, right before exit.
  install(runAfter) {
    if (!this.ready) return false;
    this.au.quitAndInstall(true, runAfter);
    return true;
  }

  openReleasePage() {
    shell.openExternal(RELEASES);
  }
}

function friendly(e) {
  const msg = String(e?.message || e);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|net::ERR/i.test(msg)) return "Downy could not reach GitHub. It tries again later.";
  if (/404|latest\.yml/i.test(msg)) return "The latest release has no update files yet. It tries again later.";
  return msg.split("\n")[0].slice(0, 200);
}

module.exports = { Updater };
