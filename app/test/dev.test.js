const test = require("node:test");
const assert = require("node:assert/strict");
const { testVar } = require("../src/main/dev");

// Runs fn as if inside Electron, with app.isPackaged set as given.
function inElectron(isPackaged, fn) {
  const electron = require.resolve("electron");
  const saved = require.cache[electron];
  require.cache[electron] = { id: electron, filename: electron, loaded: true, exports: { app: { isPackaged } } };
  try {
    return fn();
  } finally {
    if (saved) require.cache[electron] = saved;
    else delete require.cache[electron];
  }
}

test("an installed build ignores the variables that only work from source", (t) => {
  const env = { DOWNY_USER_DATA: "C:/other", DOWNY_EVAL: "alert(1)", DOWNY_PROMPT_EVAL: "alert(2)", DOWNY_SCREENSHOT: "C:/shot", DOWNY_PORT: "9700" };
  Object.assign(process.env, env);
  t.after(() => {
    for (const k of Object.keys(env)) delete process.env[k];
  });

  for (const name of ["DOWNY_USER_DATA", "DOWNY_EVAL", "DOWNY_PROMPT_EVAL", "DOWNY_SCREENSHOT"]) {
    assert.equal(inElectron(true, () => testVar(name)), undefined, name);
  }
  assert.equal(inElectron(true, () => testVar("DOWNY_PORT")), "9700");
  assert.equal(inElectron(false, () => testVar("DOWNY_EVAL")), "alert(1)");
});

test("a variable that dev.js does not list is refused", () => {
  assert.throws(() => testVar("DOWNY_NEW_THING"), /not listed/);
});
