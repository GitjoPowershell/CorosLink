import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { backupFileName } = await import(
  `${distUrl("activityBackupService.js")}?cacheBust=${Date.now()}`
);

// Date prefix comes from the activity start time (epoch seconds).
const morningRun = {
  activityId: "478506322034196580",
  name: "Morning Run",
  sportType: 100,
  startTime: Date.UTC(2026, 5, 14, 12, 0, 0) / 1000
};
const fileName = backupFileName(morningRun, "fit");
assert.match(fileName, /^2026-06-1[45]_Morning Run_478506322034196580\.fit$/);

// Millisecond timestamps are tolerated too.
assert.match(
  backupFileName(
    { ...morningRun, startTime: Date.UTC(2026, 5, 14, 12, 0, 0) },
    "gpx"
  ),
  /^2026-06-1[45]_Morning Run_478506322034196580\.gpx$/
);

// Unsafe filesystem characters are stripped; missing metadata falls back.
assert.equal(
  backupFileName(
    { activityId: "42", name: 'Trail: "Peak" <5k>?', sportType: 100 },
    "fit"
  ),
  "unknown-date_Trail- -Peak- -5k-_42.fit"
);
assert.equal(
  backupFileName({ activityId: "42", sportType: 100 }, "fit"),
  "unknown-date_activity_42.fit"
);

console.log("activity backup tests passed");
