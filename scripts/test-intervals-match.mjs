import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { isAlreadyOnCoros } = await import(
  `${distUrl("intervalsMatch.js")}?cacheBust=${Date.now()}`
);

const base = { startEpochMs: 1_700_000_000_000, movingSec: 3600, distanceM: 10000 };
const coros = [base];

// Exact match → already on COROS.
assert.equal(isAlreadyOnCoros(base, coros), true);

// Start within 2 min, duration +2%, distance +2% → still a match.
assert.equal(
  isAlreadyOnCoros(
    { startEpochMs: base.startEpochMs + 120_000, movingSec: 3672, distanceM: 10200 },
    coros
  ),
  true
);

// Start off by 10 min → not a match (missing).
assert.equal(
  isAlreadyOnCoros({ ...base, startEpochMs: base.startEpochMs + 600_000 }, coros),
  false
);

// Distance off by 20% → not a match.
assert.equal(isAlreadyOnCoros({ ...base, distanceM: 12000 }, coros), false);

// Time-only activities (distance 0 on both) match on start+duration alone.
assert.equal(
  isAlreadyOnCoros(
    { startEpochMs: base.startEpochMs, movingSec: 3600, distanceM: 0 },
    [{ startEpochMs: base.startEpochMs, movingSec: 3600, distanceM: 0 }]
  ),
  true
);

// Empty COROS list → nothing matches.
assert.equal(isAlreadyOnCoros(base, []), false);

console.log("intervals-match tests passed");
