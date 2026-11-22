const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const tools = require("../src/main/tools");
const { tempDir } = require("./helpers");

// Puts an empty stand-in yt-dlp on PATH, so find() picks it before any real one.
function fakeYtdlp(t) {
  const dir = tempDir(t, "downy-tools-");
  fs.writeFileSync(path.join(dir, process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp"), "");
  const before = process.env.PATH;
  process.env.PATH = dir + path.delimiter + before;
  tools.resetCache();
  t.after(() => {
    process.env.PATH = before;
    tools.resetCache();
  });
  return dir;
}

test("a yt-dlp command ignores config files and reads the page only as a URL", (t) => {
  const dir = fakeYtdlp(t);
  const { bin, args } = tools.ytdlpCommand(["-J"], { url: "https://example.com/--exec=calc" });
  assert.equal(path.dirname(bin), dir);
  assert.equal(args[0], "--ignore-config");
  assert.deepEqual(args.slice(-2), ["--", "https://example.com/--exec=calc"]);
  assert.equal(args.filter((a) => a.startsWith("https:")).length, 1);
});

test("a yt-dlp command from an info file has no URL", (t) => {
  fakeYtdlp(t);
  const { args } = tools.ytdlpCommand(["-f", "18"], { infoFile: "C:/data/info/abc.info.json" });
  assert.equal(args[0], "--ignore-config");
  assert.deepEqual(args.slice(-2), ["--load-info-json", "C:/data/info/abc.info.json"]);
  assert.ok(!args.includes("--"));
});

test("a yt-dlp command refuses anything but an http or https page", (t) => {
  fakeYtdlp(t);
  for (const url of ["--version", "file:///C:/Windows/win.ini", "", undefined]) {
    assert.throws(() => tools.ytdlpCommand([], { url }), /http and https/, String(url));
  }
});
