import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const modUrl = pathToFileURL(
  path.join(repoRoot, "src", "training", "parsers.ts")
);
const { buildHeatmapSummary } = await import(`${modUrl.href}?c=${Date.now()}`);

// Cells are ordered oldest → newest; the last cell is "today".
function cell(load) {
  return {
    happenDay: "20260101",
    trainingLoad: load,
    level: load && load > 0 ? 2 : 0,
    label: "day"
  };
}

// A rest day *today* (day still in progress) must NOT break the streak:
// the streak is broken only when both yesterday AND today have no activity.
const restTodayActiveYesterday = buildHeatmapSummary([
  cell(50), // day -3
  cell(50), // day -2
  cell(50), // yesterday (active)
  cell(0) //  today (rest, in progress)
]);
assert.equal(restTodayActiveYesterday.currentStreak, 3);

// Active today counts today plus the preceding consecutive active days.
const activeToday = buildHeatmapSummary([
  cell(50), // day -2
  cell(50), // yesterday
  cell(50) //  today
]);
assert.equal(activeToday.currentStreak, 3);

// No activity yesterday AND today → streak broken (0).
const restTwoDays = buildHeatmapSummary([
  cell(50), // day -2 (active)
  cell(0), //  yesterday (rest)
  cell(0) //   today (rest)
]);
assert.equal(restTwoDays.currentStreak, 0);

// A gap earlier in the window doesn't affect the current streak.
const gapEarlier = buildHeatmapSummary([
  cell(50),
  cell(0), // gap
  cell(50),
  cell(50),
  cell(0) // today rest → streak = last two active days
]);
assert.equal(gapEarlier.currentStreak, 2);

// Sanity: activeDays / totalLoad unchanged by the streak fix.
assert.equal(restTodayActiveYesterday.activeDays, 3);
assert.equal(restTodayActiveYesterday.totalLoad, 150);
assert.equal(restTodayActiveYesterday.longestStreak, 3);

console.log("heatmap-summary tests passed");
