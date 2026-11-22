const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { app } = require("electron");

function bundledDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "extension")
    : path.join(__dirname, "..", "..", "..", "extension");
}

function versionIn(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")).version || null;
  } catch {
    return null;
  }
}

function loadToken(dataDir) {
  const file = path.join(dataDir, "api-token");
  try {
    const t = fs.readFileSync(file, "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(t)) return t;
  } catch {}
  const t = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(file, t);
  } catch (e) {
    console.error("Could not save the extension token", e);
  }
  return t;
}

class ExtensionCopy {
  constructor(dataDir) {
    this.dir = path.join(dataDir, "Chrome extension");
    this.version = versionIn(bundledDir());
    this.token = loadToken(dataDir);
    this.seen = null;
  }

  sync() {
    if (!this.version) return;
    if (!app.isPackaged || versionIn(this.dir) !== this.version) {
      try {
        fs.cpSync(bundledDir(), this.dir, { recursive: true, force: true });
      } catch (e) {
        console.error("Could not copy the Chrome extension", e);
      }
    }
    try {
      fs.writeFileSync(path.join(this.dir, "token.json"), JSON.stringify({ token: this.token }));
    } catch (e) {
      console.error("Could not write the extension token", e);
    }
  }

  markSeen(version) {
    const v = version || null;
    const changed = !this.seen || this.seen.version !== v;
    this.seen = { version: v, at: Date.now() };
    return changed;
  }

  status() {
    return {
      dir: this.dir,
      version: this.version,
      seen: !!this.seen,
      seenVersion: this.seen?.version || null,
      current: !!this.seen && this.seen.version === this.version,
    };
  }
}

// Chrome ignores chrome:// addresses passed on its command line, so Downy only
// opens Chrome and the user pastes the address.
function openChrome() {
  const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA];
  for (const root of roots) {
    if (!root) continue;
    const exe = path.join(root, "Google", "Chrome", "Application", "chrome.exe");
    if (!fs.existsSync(exe)) continue;
    spawn(exe, [], { detached: true, stdio: "ignore" }).unref();
    return true;
  }
  return false;
}

module.exports = { ExtensionCopy, openChrome };
