import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { parseIntervalsActivities } = await import(
  `${distUrl("intervalsService.js")}?cacheBust=${Date.now()}`
);

const raw = [
  {
    id: "i123",
    name: "Morning Ride",
    start_date: "2026-07-01T06:00:00Z",
    start_date_local: "2026-07-01T08:00:00",
    moving_time: 3600,
    distance: 25000,
    type: "Ride",
    source_file: { type: "fit" }
  },
  {
    id: "i124",
    // no name, no distance, tcx source
    start_date: "2026-07-02T05:30:00Z",
    elapsed_time: 1800,
    type: "Run",
    source_file: { type: "tcx" }
  }
];

const parsed = parseIntervalsActivities(raw);
assert.equal(parsed.length, 2);
assert.equal(parsed[0].intervalsId, "i123");
assert.equal(parsed[0].name, "Morning Ride");
assert.equal(parsed[0].startEpochMs, Date.parse("2026-07-01T06:00:00Z"));
assert.equal(parsed[0].movingSec, 3600);
assert.equal(parsed[0].distanceM, 25000);
assert.equal(parsed[0].fileExt, "fit");

assert.equal(parsed[1].name, "Unnamed");
assert.equal(parsed[1].distanceM, 0);
assert.equal(parsed[1].movingSec, 1800);
assert.equal(parsed[1].fileExt, "tcx");

console.log("intervals-service tests passed");
