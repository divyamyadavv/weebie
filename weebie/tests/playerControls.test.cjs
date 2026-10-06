const test = require("node:test");
const assert = require("node:assert/strict");
const { clampSeek, formatTime } = require("../lib/playerControls.cjs");

test("formats times in minutes and hours", () => {
  assert.equal(formatTime(5), "0:05");
  assert.equal(formatTime(1696), "28:16");
  assert.equal(formatTime(3723), "1:02:03");
});

test("formats invalid and negative times as zero", () => {
  assert.equal(formatTime(-5), "0:00");
  assert.equal(formatTime(Number.NaN), "0:00");
});

test("clamps seeks to the beginning and end of the video", () => {
  assert.equal(clampSeek(3, -10, 120), 0);
  assert.equal(clampSeek(115, 10, 120), 120);
  assert.equal(clampSeek(30, -10, 120), 20);
});

test("allows forward seeks when duration is not finite", () => {
  assert.equal(clampSeek(30, 10, Number.POSITIVE_INFINITY), 40);
});
