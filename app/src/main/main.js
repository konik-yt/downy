const path = require("path");
const fs = require("fs");
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, shell, Notification, nativeImage, clipboard } = require("electron");
const tools = require("./tools");
const { InfoCache, isYoutubeUrl, buildOptions, publicOptions } = require("./formats");
const { Settings } = require("./settings");
const { Manager } = require("./manager");
const { startServer, PORT } = require("./server");
const { ExtensionCopy, openChrome } = require("./extension");
const { Updater } = require("./updater");
const { Installer } = require("./installer");
const { Prompts } = require("./prompt");

const ASSETS = path.join(__dirname, "..", "renderer", "assets");

app.setAppUserModelId("dev.downy.app");
// For testing: keep data apart from the real profile, and save screenshots of the window.
if (process.env.DOWNY_USER_DATA) app.setPath("userData", process.env.DOWNY_USER_DATA);
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  let tray = null;
  let quitting = false;
  let settings, cache, manager, extension, updater, installer, prompts;
  let restartForUpdate = false;
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
      if (!startHidden || !settings.get().onboarded) win.show(); // the first run always shows the welcome screen
    });
    if (process.env.DOWNY_SCREENSHOT) {
      const shoot = async (n) => {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(`${process.env.DOWNY_SCREENSHOT}-${n}.png`, img.toPNG());
      };
      let n = 0;
      win.webContents.on("console-message", (e) => console.log("[renderer]", e.message));
      win.webContents.once("did-finish-load", () => {
        if (process.env.DOWNY_EVAL) setTimeout(() => win.webContents.executeJavaScript(process.env.DOWNY_EVAL), 800);
        setTimeout(() => shoot(n++), 1500);
        setInterval(() => shoot(n++), Number(process.env.DOWNY_SCREENSHOT_EVERY || 4000));
      });
    }
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
    else if (j?.filepath) openFolder(path.dirname(j.filepath));
    else openFolder();
  }

  // `folder` is a path inside the download folder, such as "Downloads" or "YouTube/1080p".
  function openFolder(folder) {
    const root = path.resolve(settings.get().downloadDir);
    let dir = folder ? path.resolve(root, folder) : root;
    if (dir !== root && !dir.startsWith(root + path.sep)) dir = root;
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
      ...(updater?.ready ? [{ label: `Restart to update to ${updater.state.version}`, click: restartToUpdate }] : []),
      { label: "Quit Downy", click: () => app.quit() },
    ]));
  }

  function extensionSeen(version) {
    if (extension.markSeen(version)) win?.webContents.send("extension", extension.status());
  }

  function formatSpeed(n) {
    if (!n) return "0 KB/s";
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB/s`;
    return `${(n / 1024 / 1024).toFixed(1)} MB/s`;
  }

  // The portable build runs from a temp folder that is deleted on exit, so register
  // the .exe the user started, which electron-builder passes in this variable.
  const exePath = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;

  function applyLogin() {
    if (!app.isPackaged) return; // a dev build would register the bare electron.exe
    app.setLoginItemSettings({ openAtLogin: settings.get().openAtLogin, path: exePath, args: ["--hidden"] });
  }

  // downy:// links let the extension start Downy when it is not running.
  if (app.isPackaged) app.setAsDefaultProtocolClient("downy", exePath, []);
  app.on("second-instance", () => show());

  app.whenReady().then(async () => {
    const dataDir = app.getPath("userData");
    installer = new Installer(dataDir);
    installer.on("change", (st) => win?.webContents.send("install", st));
    settings = new Settings(dataDir);
    cache = new InfoCache(path.join(dataDir, "cache"));
    manager = new Manager({ dataDir, cache, settings });
    cache.prune(manager.infoFiles());
    prompts = new Prompts({
      manager, cache, icon: icon("icon.png"),
      onStart: (d) => {
        if (settings.get().showOnStart) show(d.id);
      },
    });
    extension = new ExtensionCopy(dataDir);
    extension.sync();
    updater = new Updater();
    updater.on("change", (u) => {
      win?.webContents.send("update", u);
      updateTray(manager.list());
    });

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
      // A folder the user picked outside the download folder ("Other") goes by its own name.
      const where = d.dir === "Other" ? path.basename(path.dirname(d.filepath)) : (d.dir || d.folder).replace(/\//g, " / ");
      const n = new Notification({ title: "Download saved", body: `${d.title}\nSaved to ${where}`, icon: path.join(ASSETS, "icon.png") });
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
      manager.sweepParts(); // the download folder may have changed
      manager.schedule();
      win?.webContents.send("settings", settings.get());
    });

    try {
      await startServer({ manager, cache, settings, tools, prompts, actions: { show, reveal, extensionSeen } });
    } catch (e) {
      dialog.showErrorBox("Downy could not start its helper",
        `Port ${PORT} is in use. If the old Python helper is running, close it (end pythonw.exe in Task Manager) and start Downy again.\n\n${e.message}`);
    }
    manager.schedule();
    updater.start();
    installer.updateYtdlp();
  });

  function restartToUpdate() {
    if (!updater.ready) return;
    restartForUpdate = true;
    app.quit();
  }

  // With "Keep running in the tray" on, closing only hides the window, so this runs
  // when that setting is off. Quit through before-quit so downloads are saved as paused.
  app.on("window-all-closed", () => {
    if (!settings?.get().closeToTray) app.quit();
  });

  app.on("before-quit", async (e) => {
    if (quitting) return;
    quitting = true;
    e.preventDefault();
    // A restart for an update picks the running downloads up again once the new version starts.
    await manager?.shutdown({ resume: restartForUpdate });
    tray?.destroy();
    updater?.install(restartForUpdate); // a downloaded update also installs when Downy quits from the tray
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
    install: installer.state,
    extension: extension.status(),
    update: updater.state,
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
  handle("extension:open-chrome", () => {
    clipboard.writeText("chrome://extensions");
    return openChrome();
  });
  handle("extension:copy-path", () => clipboard.writeText(extension.dir));
  handle("extension:show-folder", () => {
    extension.sync(); // put the files back if someone deleted them
    shell.openPath(extension.dir);
  });
  handle("tools:install", async () => {
    const st = await installer.install();
    return { install: st, tools: tools.status() };
  });
  handle("update:check", () => updater.check());
  handle("update:restart", () => restartToUpdate());
  handle("update:open-page", () => updater.openReleasePage());
  handle("formats", async (url) => {
    if (!isYoutubeUrl(url)) throw new Error("Paste a YouTube link, such as youtube.com/watch?v=...");
    const { info } = await cache.get(url);
    return { title: info.title, thumbnail: info.thumbnail, duration: info.duration, channel: info.channel || info.uploader, options: publicOptions(buildOptions(info)) };
  });
  handle("download", (url, option) => manager.add(url, option));
  handle("add-file", (url) => manager.addFile({ url }));
  handle("pause", (id) => manager.pause(id));
  handle("resume", (id) => manager.resume(id));
  handle("pause-all", () => manager.pauseAll());
  handle("resume-all", () => manager.resumeAll());
  handle("cancel", (id) => manager.cancel(id));
  handle("remove", (id) => manager.remove(id));
  handle("clear", (scope) => manager.clearFinished(scope));
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
