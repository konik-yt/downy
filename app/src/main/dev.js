// Downy's testing variables. A "source" variable is ignored in an installed build, so
// another program can't point Downy at other data or run scripts in its windows.
// A new variable must be listed here, which forces that choice.
const WHERE = {
  DOWNY_PORT: "anywhere",
  DOWNY_UPDATE_URL: "anywhere", // the updater only runs in an installed build
  DOWNY_USER_DATA: "source",
  DOWNY_WINDOW_SIZE: "source",
  DOWNY_SCREENSHOT: "source",
  DOWNY_SCREENSHOT_EVERY: "source",
  DOWNY_EVAL: "source",
  DOWNY_PROMPT_EVAL: "source",
};

// Plain Node, as in the tests, gets the path of the Electron binary here and has no app.
const installed = () => !!require("electron").app?.isPackaged;

function testVar(name) {
  const where = WHERE[name];
  if (!where) throw new Error(`${name} is not listed in src/main/dev.js`);
  if (where === "source" && installed()) return undefined;
  return process.env[name] || undefined;
}

module.exports = { testVar };
