const test = require("node:test");
const assert = require("node:assert/strict");

globalThis.window = {};
require("../src/renderer/times.js");
const { parseTime, formatTime, timeInWords } = globalThis.window;

test("parseTime reads seconds, minutes and seconds, and hours", () => {
  assert.equal(parseTime("75"), 75);
  assert.equal(parseTime("0"), 0);
  assert.equal(parseTime("1:15"), 75);
  assert.equal(parseTime("0:00"), 0);
  assert.equal(parseTime("1:02:05"), 3725);
  assert.equal(parseTime(" 2:30 "), 150);
  assert.equal(parseTime("90:00"), 5400, "the first part can be more than 59");
  assert.equal(parseTime("01:05"), 65);
});

test("parseTime refuses anything that is not a time", () => {
  for (const text of ["", " ", "abc", "1:75", "1:60", "1:02:75", "1:60:00", "1.5", "-5", "1:", ":30", "1::30", "1:2:3:4", "1e3", "99999999"]) {
    assert.equal(parseTime(text), null, JSON.stringify(text));
  }
});

test("formatTime and timeInWords", () => {
  assert.deepEqual([0, 75, 3599, 3725, 36000].map(formatTime), ["0:00", "1:15", "59:59", "1:02:05", "10:00:00"]);
  assert.equal(formatTime(596.47), "9:56");
  assert.equal(timeInWords(90), "1 minute 30 seconds");
  assert.equal(timeInWords(1), "1 second");
  assert.equal(timeInWords(60), "1 minute");
  assert.equal(timeInWords(3725), "1 hour 2 minutes 5 seconds");
  assert.equal(timeInWords(7200), "2 hours");
});
