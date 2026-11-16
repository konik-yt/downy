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

// A dropped link or HTML file would otherwise load in the window and get the API.
function lockDown(contents) {
  contents.on("will-navigate", (e) => e.preventDefault());
  contents.on("will-attach-webview", (e) => e.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
}

module.exports = { fromApp, lockDown };
