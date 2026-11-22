// Every Downy window gets the full window.downy API from preload.js, so only
// Downy's own pages may run in them or talk to the main process.
const path = require("path");
const { fileURLToPath } = require("url");

const RENDERER = path.join(__dirname, "..", "renderer");

// True for a file: URL of a page inside the renderer folder.
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

// An IPC event from the top frame of one of Downy's own pages.
function fromApp(e) {
  const frame = e.senderFrame;
  return !!frame && frame === e.sender.mainFrame && isAppPage(frame.url);
}

// The only way to answer a page's IPC call, so no handler can skip the sender check.
// fn gets the event and the call's arguments. What it returns or throws goes back as { ok, data } or { ok, error }.
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

// Like handle(), for messages that get no answer.
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
