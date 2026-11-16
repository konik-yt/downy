// The small window that asks before a download from Chrome starts, near the top
// of the screen like a quick entry bar. It shows the file name, the folder and,
// for a video, the format, and starts the download when the user clicks Download.
// The extension follows each request by its id until it is started or cancelled.
const path = require("path");
const crypto = require("crypto");
const { app, BrowserWindow, screen, ipcMain, dialog } = require("electron");
const { buildOptions, publicOptions } = require("./formats");
const { fromApp } = require("./guard");

const WIDTH = 620;
const KEEP = 10 * 60 * 1000; // answered requests are forgotten after this

function siteOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

class Prompts {
  constructor({ manager, cache, icon, onStart }) {
    this.manager = manager;
    this.cache = cache;
    this.icon = icon;
    this.onStart = onStart;
    this.items = new Map(); // id -> { id, state, downloadId, error, kind, url, draft, view, win }

    const handle = (name, fn) => ipcMain.handle(name, async (e, ...args) => {
      try {
        if (!fromApp(e)) throw new Error("This request did not come from Downy.");
        const item = [...this.items.values()].find((x) => x.win?.webContents === e.sender);
        if (!item) throw new Error("This download was already answered.");
        return { ok: true, data: await fn(item, ...args) };
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }
    });
    handle("prompt:get", (item) => item.view);
    handle("prompt:choose-folder", async (item, current) => {
      const r = await dialog.showOpenDialog(item.win, {
        title: "Choose where to save this download",
        defaultPath: typeof current === "string" ? current : undefined,
        properties: ["openDirectory", "createDirectory"],
      });
      return r.canceled ? null : r.filePaths[0] || null;
    });
    handle("prompt:submit", (item, choice) => this.submit(item, choice && typeof choice === "object" ? choice : {}));
    handle("prompt:cancel", (item) => item.win.close());
    ipcMain.on("prompt:size", (e, height) => {
      if (!fromApp(e)) return;
      const item = [...this.items.values()].find((x) => x.win?.webContents === e.sender);
      const h = Math.round(Number(height));
      if (item && h > 0) item.win.setContentSize(WIDTH, Math.min(h, 720));
    });
  }

  // A video from the extension's quality menu. optionId is the format picked there.
  async openVideo(url, optionId) {
    const { info } = await this.cache.get(url);
    const options = buildOptions(info);
    if (!options.some((o) => o.id === optionId)) throw new Error("That format is not available for this video");
    const targets = {};
    for (const o of options) targets[o.id] = this.manager.target(await this.manager.draftVideo(url, o.id));
    return this.open({
      kind: "video", url,
      view: {
        kind: "video", title: info.title || url, thumbnail: info.thumbnail || "", site: siteOf(url),
        options: publicOptions(options), optionId, targets,
      },
    });
  }

  // A Chrome download. The link is checked first, so a link Downy can't use stays in Chrome.
  async openFile(spec) {
    const draft = await this.manager.draftFile(spec);
    return this.open({
      kind: "file", url: spec.url, draft,
      view: {
        kind: "file", title: draft.filename, site: siteOf(spec.url), size: draft.expected || 0,
        optionId: "file", targets: { file: this.manager.target(draft) },
      },
    });
  }

  open(item) {
    item.id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    item.state = "open";
    this.items.set(item.id, item);
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { x, y, width } = display.workArea;
    const others = [...this.items.values()].filter((i) => i.state === "open" && i !== item).length;
    const win = new BrowserWindow({
      width: WIDTH, height: 300,
      x: Math.round(x + (width - WIDTH) / 2), y: y + 80 + others * 28,
      frame: false, transparent: true, backgroundColor: "#00000000", resizable: false, maximizable: false, minimizable: false,
      alwaysOnTop: true, show: false, title: "Downy", icon: this.icon,
      webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    item.win = win;
    win.removeMenu();
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.loadFile(path.join(__dirname, "..", "renderer", "prompt.html"));
    win.once("ready-to-show", () => {
      win.show();
      win.focus();
      // For testing, like the main window: a screenshot, then a script to run in the window.
      if (!app.isPackaged && process.env.DOWNY_SCREENSHOT) {
        setTimeout(async () => {
          const img = await win.webContents.capturePage();
          require("fs").writeFileSync(`${process.env.DOWNY_SCREENSHOT}-prompt-${item.id}.png`, img.toPNG());
          if (process.env.DOWNY_PROMPT_EVAL) win.webContents.executeJavaScript(process.env.DOWNY_PROMPT_EVAL);
        }, 1200);
      }
    });
    win.on("closed", () => {
      item.win = null;
      if (item.state === "open") item.state = "cancelled";
      item.draft = null;
      setTimeout(() => this.items.delete(item.id), KEEP);
    });
    return item;
  }

  async submit(item, { optionId, dir, name }) {
    if (item.state !== "open") throw new Error("This download was already answered.");
    const custom = { dir: dir || "", name: name || "" };
    const d = item.kind === "video"
      ? await this.manager.add(item.url, optionId || item.view.optionId, custom)
      : this.manager.commit(item.draft, custom);
    item.state = "started";
    item.downloadId = d.id;
    item.win?.close();
    this.onStart(d);
    return d;
  }

  status(id) {
    const item = this.items.get(id);
    if (!item) return { state: "cancelled" };
    return { state: item.state, downloadId: item.downloadId || null };
  }
}

module.exports = { Prompts };
