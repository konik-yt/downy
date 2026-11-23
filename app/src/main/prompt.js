// The small window that asks before a download from Chrome starts, near the top
// of the screen like a quick entry bar. It shows the file name, the folder and,
// for a video, the format, and starts the download when the user clicks Download.
// It can also collect several downloads and start them as one batch.
// The extension follows each request by its id until it is started or cancelled.
const path = require("path");
const crypto = require("crypto");
const { BrowserWindow, screen, ipcMain, dialog } = require("electron");
const { buildOptions, publicOptions } = require("./formats");
const { parseClip } = require("./clip");
const { readZip, zipView, chooseEntries } = require("./zip");
const { fromApp } = require("./guard");
const { testVar } = require("./dev");

const WIDTH = 540;
const KEEP = 10 * 60 * 1000; // answered requests are forgotten after this

function siteOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// One window can hold several downloads. Files from the site of an open window join it,
// and after "Start a batch" every download Downy catches joins it, from any site.
// Each download keeps its own request id, so the extension can follow it.
class Prompts {
  constructor({ manager, cache, icon, onStart, settings }) {
    this.manager = manager;
    this.cache = cache;
    this.icon = icon;
    this.onStart = onStart;
    this.settings = settings;
    this.items = new Map(); // request id -> { id, state, downloadId, kind, url, site, draft, view }
    this.boxes = new Set(); // open windows: { win, entries, collecting, site, busy }

    const handle = (name, fn) => ipcMain.handle(name, async (e, ...args) => {
      try {
        if (!fromApp(e)) throw new Error("This request did not come from Downy.");
        const box = this.boxOf(e.sender);
        if (!box) throw new Error("This download was already answered.");
        return { ok: true, data: await fn(box, ...args) };
      } catch (err) {
        return { ok: false, error: err.message || String(err) };
      }
    });
    handle("prompt:get", (box) => this.view(box));
    handle("prompt:choose-folder", async (box, current) => {
      const r = await dialog.showOpenDialog(box.win, {
        title: "Choose where to save this download",
        defaultPath: typeof current === "string" && current ? current : undefined,
        properties: ["openDirectory", "createDirectory"],
      });
      return r.canceled ? null : r.filePaths[0] || null;
    });
    handle("prompt:batch", (box) => {
      box.collecting = true;
      this.push(box);
      return this.view(box);
    });
    handle("prompt:remove", (box, id) => this.leaveOut(box, String(id)));
    handle("prompt:clip", (box, raw) => this.clipView(box, raw));
    handle("prompt:submit", (box, choice) => this.submit(box, choice && typeof choice === "object" ? choice : {}));
    handle("prompt:cancel", (box) => box.win.close());
    ipcMain.on("prompt:size", (e, height) => {
      if (!fromApp(e)) return;
      const box = this.boxOf(e.sender);
      const h = Math.round(Number(height));
      if (box && h > 0) box.win.setContentSize(WIDTH, Math.min(h, 720));
    });
  }

  boxOf(sender) {
    return [...this.boxes].find((b) => b.win?.webContents === sender);
  }

  // A video from the extension's quality menu. optionId is the format picked there.
  async openVideo(url, optionId) {
    const { info } = await this.cache.get(url);
    const options = buildOptions(info);
    if (!options.some((o) => o.id === optionId)) throw new Error("That format is not available for this video");
    const targets = {};
    for (const o of options) targets[o.id] = this.manager.target(await this.manager.draftVideo(url, o.id));
    return this.open({
      kind: "video", url, site: siteOf(url),
      view: {
        kind: "video", title: info.title || url, thumbnail: info.thumbnail || "", site: siteOf(url), duration: info.duration || 0,
        options: publicOptions(options), optionId, targets,
      },
    });
  }

  // What a time range changes in the window of one video: the file name and the size of each format.
  // Throws the reason when the range is not usable.
  async clipView(box, raw) {
    const item = box.entries[0];
    if (box.entries.length !== 1 || box.collecting || item.kind !== "video") throw new Error("Only a single video can be trimmed");
    const { info } = await this.cache.get(item.url);
    const clip = parseClip(raw, info.duration || 0);
    const targets = {};
    const sizes = {};
    for (const o of item.view.options) {
      const draft = await this.manager.draftVideo(item.url, o.id, clip);
      targets[o.id] = this.manager.target(draft);
      sizes[o.id] = draft.expected;
    }
    return { clip, targets, sizes };
  }

  // A Chrome download. The link is checked first, so a link Downy can't use stays in Chrome.
  async openFile(spec) {
    const draft = await this.manager.draftFile(spec);
    const zip = await readZip(draft, spec.mime);
    return this.open({
      kind: "file", url: spec.url, draft, zip, site: siteOf(spec.url),
      view: {
        kind: "file", title: draft.filename, site: siteOf(spec.url), size: draft.expected || 0, ext: draft.ext || "",
        optionId: "file", targets: { file: this.manager.target(draft) }, zip: zip && zipView(zip),
      },
    });
  }

  // Where a new download goes: the newest window that collects a batch, else a window
  // that holds only files from the same site, else a window of its own.
  open(item) {
    item.id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    item.state = "open";
    this.items.set(item.id, item);
    const open = [...this.boxes].filter((b) => !b.busy);
    const box = open.filter((b) => b.collecting).pop()
      || (item.kind === "file" && open.find((b) => b.site === item.site && b.entries.every((e) => e.kind === "file")));
    if (box) {
      box.entries.push(item);
      this.push(box);
      return item;
    }
    this.window({ entries: [item], collecting: false, site: item.site, busy: false });
    return item;
  }

  window(box) {
    this.boxes.add(box);
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { x, y, width } = display.workArea;
    const others = this.boxes.size - 1;
    const win = new BrowserWindow({
      width: WIDTH, height: 300,
      x: Math.round(x + (width - WIDTH) / 2), y: y + 80 + others * 28,
      frame: false, transparent: true, backgroundColor: "#00000000", resizable: false, maximizable: false, minimizable: false,
      alwaysOnTop: true, show: false, title: "Downy", icon: this.icon,
      webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    box.win = win;
    win.removeMenu();
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.loadFile(path.join(__dirname, "..", "renderer", "prompt.html"));
    win.once("ready-to-show", () => {
      win.show();
      win.focus();
      // For testing, like the main window: a script to run in the window, then a screenshot.
      if (testVar("DOWNY_SCREENSHOT")) {
        setTimeout(async () => {
          if (testVar("DOWNY_PROMPT_EVAL")) await win.webContents.executeJavaScript(testVar("DOWNY_PROMPT_EVAL")).catch(() => {});
          await new Promise((r) => setTimeout(r, 600));
          const img = await win.webContents.capturePage();
          require("fs").writeFileSync(`${testVar("DOWNY_SCREENSHOT")}-prompt-${box.entries[0]?.id}.png`, img.toPNG());
        }, 1200);
      }
    });
    win.on("closed", () => {
      box.win = null;
      this.boxes.delete(box);
      for (const item of box.entries) this.forget(item);
    });
  }

  // Answered requests are kept a while so the extension can still ask how they went.
  forget(item) {
    if (item.state === "open") item.state = "cancelled";
    item.draft = null;
    item.zip = null;
    setTimeout(() => this.items.delete(item.id), KEEP);
  }

  // What the window shows. A window with one download and no batch is the plain form.
  view(box) {
    const files = box.entries.every((e) => e.kind === "file");
    return {
      collecting: box.collecting,
      maxActive: this.settings?.get().maxActive || 3,
      // The download folder, so the window can name folders inside it the short way, like YouTube/1080p.
      root: this.settings?.get().downloadDir || "",
      // Files all go to Downloads, so the window can name the folder. With videos it can't.
      dir: files ? box.entries[0]?.view.targets.file.dir || "" : "",
      entries: box.entries.map((e) => ({ id: e.id, ...e.view })),
    };
  }

  push(box) {
    box.win?.webContents.send("prompt:update", this.view(box));
  }

  // The x on a row leaves that download out, and an empty window closes.
  leaveOut(box, id) {
    const item = box.entries.find((e) => e.id === id);
    if (!item) return this.view(box);
    box.entries = box.entries.filter((e) => e !== item);
    this.forget(item);
    if (!box.entries.length) box.win?.close();
    else this.push(box);
    return this.view(box);
  }

  // choice for one download: { optionId, dir, name, clip, files }, where files lists the entries picked
  // from a ZIP, or is left out for the whole file.
  // For several, or a batch: { order, formats, mode, dir }, where order lists request ids
  // top to bottom and formats maps a video's request id to the format picked on its row.
  async submit(box, choice) {
    if (box.busy) throw new Error("These downloads were already answered.");
    box.busy = true;
    try {
      const custom = { dir: typeof choice.dir === "string" ? choice.dir : "", name: typeof choice.name === "string" ? choice.name : "" };
      if (box.entries.length === 1 && !box.collecting) {
        const item = box.entries[0];
        const d = item.kind === "video"
          ? await this.manager.add(item.url, choice.optionId || item.view.optionId, custom, choice.clip)
          : this.manager.commit(item.zip ? chooseEntries(item.draft, item.zip, choice.files) : item.draft, custom);
        this.started(item, d);
        box.win?.close();
        this.onStart(d);
        return d;
      }
      const order = Array.isArray(choice.order) ? choice.order.map(String) : [];
      const rank = (e) => (order.includes(e.id) ? order.indexOf(e.id) : order.length);
      const entries = [...box.entries].sort((a, b) => rank(a) - rank(b));
      const formats = choice.formats && typeof choice.formats === "object" ? choice.formats : {};
      const drafts = [];
      for (const e of entries) {
        drafts.push(e.kind === "video" ? await this.manager.draftVideo(e.url, String(formats[e.id] || e.view.optionId)) : e.draft);
      }
      const { downloads } = this.manager.commitBatch(drafts, { dir: custom.dir }, choice.mode === "all" ? "all" : "one");
      entries.forEach((e, k) => this.started(e, downloads[k]));
      box.win?.close();
      this.onStart(downloads[0]);
      return downloads[0];
    } catch (e) {
      box.busy = false;
      throw e;
    }
  }

  started(item, d) {
    item.state = "started";
    item.downloadId = d.id;
  }

  status(id) {
    const item = this.items.get(id);
    if (!item) return { state: "cancelled" };
    return { state: item.state, downloadId: item.downloadId || null };
  }
}

module.exports = { Prompts };
