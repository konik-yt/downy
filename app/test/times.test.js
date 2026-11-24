const test = require("node:test");
const assert = require("node:assert/strict");

globalThis.window = {};
require("../src/renderer/times.js");
const { formatTime, timeInWords } = globalThis.window;

test("formatTime and timeInWords", () => {
  assert.deepEqual([0, 75, 3599, 3725, 36000].map(formatTime), ["0:00", "1:15", "59:59", "1:02:05", "10:00:00"]);
  assert.equal(formatTime(596.47), "9:56");
  assert.equal(timeInWords(90), "1 minute 30 seconds");
  assert.equal(timeInWords(1), "1 second");
  assert.equal(timeInWords(60), "1 minute");
  assert.equal(timeInWords(3725), "1 hour 2 minutes 5 seconds");
  assert.equal(timeInWords(7200), "2 hours");
});
