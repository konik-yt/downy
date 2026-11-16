const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, Notification, nativeImage } = require("electron");
const tools = require("./tools");
const { InfoCache, isYoutubeUrl, buildOptions, publicOptions } = require("./formats");
const { Settings } = require("./settings");
const { Manager } = require("./manager");
const { startServer, PORT } = require("./server");

const ASSETS = path.join(__dirname, "..", "renderer", "assets");

app.setAppUserModelId("dev.downy.app");
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  let tray = null;
  let quitting = false;
  let settings, cache, manager;
  const startHidden = process.argv.includes("--hidden");

  const icon = (name) => nativeImage.createFromPath(path.join(ASSETS, name));

  function createWindow() {
    win = new BrowserWindow({
      width: 1180,
      height: 760,
      minWidth: 820,
      minHeight: 540,
      show: false,
      frame: false,
      backgroundColor: "#000000",
      title: "Downy",
      icon: icon("icon.png"),
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.removeMenu();
    win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
    win.once("ready-to-show", () => {
      if (!startHidden) win.show();
    });
    win.on("close", (e) => {
      if (!quitting && settings.get().closeToTray) {
        e.preventDefault();
        win.hide();
      }
    });
    win.on("closed", () => (win = null));
    const sendState = () => win?.webContents.send("window", { maximized: win.isMaximized() });
    win.on("maximize", sendState);
    win.on("unmaximize", sendState);
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) shell.openExternal(url);
      return { action: "deny" };
    });
  }

  function show(focusId) {
    if (!win) createWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (focusId) win.webContents.send("focus-download", focusId);
  }

  function reveal(id, select = true) {
    const j = id && manager.get(id);
    if (select && j?.filepath && fs.existsSync(j.filepath)) shell.showItemInFolder(j.filepath);
    else openFolder(j?.folder);
  }

  function openFolder(folder) {
    const s = settings.get();
    const dir = folder && s.organize ? path.join(s.downloadDir, folder) : s.downloadDir;
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  }

  function updateTray(list) {
    if (!tray) return;
    const active = list.filter((d) => d.status === "downloading");
    const speed = active.reduce((n, d) => n + d.speed, 0);
    tray.setToolTip(active.length
      ? `Downy: ${active.length} downloading at ${formatSpeed(speed)}`
      : "Downy: no downloads running");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open Downy", click: () => show() },
      { type: "separator" },
      { label: "Pause all", enabled: list.some((d) => d.status === "downloading" || d.status === "queued"), click: () => manager.pauseAll() },
      { label: "Resume all", enabled: list.some((d) => d.status === "paused"), click: () => manager.resumeAll() },
      { label: "Open download folder", click: () => openFolder() },
      { type: "separator" },
      { label: "Quit Downy", click: () => app.quit() },
    ]));
  }

  function formatSpeed(n) {
    if (!n) return "0 KB/s";
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB/s`;
    return `${(n / 1024 / 1024).toFixed(1)} MB/s`;
  }

  function applyLogin() {
    if (!app.isPackaged) return; // a dev build would register the bare electron.exe
    app.setLoginItemSettings({ openAtLogin: settings.get().openAtLogin, args: ["--hidden"] });
  }

  app.on("second-instance", () => show());

  app.whenReady().then(async () => {
    const dataDir = app.getPath("userData");
    settings = new Settings(dataDir);
    cache = new InfoCache(path.join(dataDir, "cache"));
    manager = new Manager({ dataDir, cache, settings });

    createWindow();
    tray = new Tray(icon("tray.png"));
    tray.on("click", () => show());
    updateTray(manager.list());
    applyLogin();

    manager.on("update", (list) => {
      win?.webContents.send("downloads", list);
      updateTray(list);
    });
    manager.on("finished", (d) => {
      if (!settings.get().notify || !Notification.isSupported()) return;
      const n = new Notification({ title: "Download saved", body: `${d.title}\nSaved to ${d.folder}`, icon: path.join(ASSETS, "icon.png") });
      n.on("click", () => reveal(d.id));
      n.show();
    });
    manager.on("failed", (d) => {
      if (!settings.get().notify || !Notification.isSupported()) return;
      const n = new Notification({ title: "Download failed", body: `${d.title}\n${d.error}`, icon: path.join(ASSETS, "icon.png") });
      n.on("click", () => show(d.id));
      n.show();
    });
    settings.on("change", () => {
      applyLogin();
      manager.schedule();
      win?.webContents.send("settings", settings.get());
    });

    try {
      await startServer({ manager, cache, settings, tools, actions: { show, reveal } });
    } catch (e) {
      dialog.showErrorBox("Downy could not start its helper",
        `Port ${PORT} is in use. If the old Python helper is running, close it (end pythonw.exe in Task Manager) and start Downy again.\n\n${e.message}`);
    }
    manager.schedule();
  });

  // Keep running in the tray when the window closes.
  app.on("window-all-closed", () => {});

  app.on("before-quit", async (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    await manager?.shutdown();
    tray?.destroy();
    app.exit(0);
  });

  // ----------------------------------------------------------------- IPC

  const handle = (name, fn) => ipcMain.handle(name, async (_e, ...args) => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  handle("state", () => ({
    downloads: manager.list(),
    settings: settings.get(),
    tools: tools.status(),
    maximized: win?.isMaximized() || false,
  }));
  handle("settings:set", (patch) => settings.set(patch));
  handle("settings:choose-folder", async () => {
    const r = await dialog.showOpenDialog(win, {
      title: "Choose where Downy saves videos",
      defaultPath: settings.get().downloadDir,
      properties: ["openDirectory", "createDirectory"],
    });
    if (r.canceled || !r.filePaths[0]) return settings.get();
    return settings.set({ downloadDir: r.filePaths[0] });
  });
  handle("tools:recheck", () => {
    tools.resetCache();
    return tools.status();
  });
  handle("formats", async (url) => {
    if (!isYoutubeUrl(url)) throw new Error("Paste a YouTube link, such as youtube.com/watch?v=...");
    const { info } = await cache.get(url);
    return { title: info.title, thumbnail: info.thumbnail, duration: info.duration, channel: info.channel || info.uploader, options: publicOptions(buildOptions(info)) };
  });
  handle("download", (url, option) => manager.add(url, option));
  handle("pause", (id) => manager.pause(id));
  handle("resume", (id) => manager.resume(id));
  handle("pause-all", () => manager.pauseAll());
  handle("resume-all", () => manager.resumeAll());
  handle("cancel", (id) => manager.cancel(id));
  handle("remove", (id) => manager.remove(id));
  handle("clear", () => manager.clearFinished());
  handle("open-file", (id) => {
    const j = manager.get(id);
    if (!j?.filepath || !fs.existsSync(j.filepath)) throw new Error("The file was moved or deleted.");
    return shell.openPath(j.filepath);
  });
  handle("reveal", (id) => reveal(id));
  handle("open-folder", (folder) => openFolder(folder));
  handle("folder-counts", () => manager.folderCounts());
  handle("window", (action) => {
    if (!win) return;
    if (action === "minimize") win.minimize();
    else if (action === "maximize") win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === "close") win.close();
  });
}
