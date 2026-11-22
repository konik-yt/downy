const path = require("path");
const { fileURLToPath } = require("url");

const RENDERER = path.join(__dirname, "..", "renderer");

function isAppPage(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "file:") return false;
    const rel = path.relative(RENDERER, fileURLToPath(u));
    return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
  } catch {
    return false;
  }
}

function fromApp(e) {
  const frame = e.senderFrame;
  return !!frame && frame === e.sender.mainFrame && isAppPage(frame.url);
}

function handle(name, fn) {
  require("electron").ipcMain.handle(name, async (e, ...args) => {
    try {
      if (!fromApp(e)) throw new Error("This request did not come from Downy.");
      return { ok: true, data: await fn(e, ...args) };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });
}

function listen(name, fn) {
  require("electron").ipcMain.on(name, (e, ...args) => {
    if (fromApp(e)) fn(e, ...args);
  });
}

// A dropped link or HTML file would otherwise load in the window and get the API.
function lockDown(contents) {
  contents.on("will-navigate", (e) => e.preventDefault());
  contents.on("will-attach-webview", (e) => e.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
}

module.exports = { fromApp, lockDown, handle, listen };
