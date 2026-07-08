import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { buildManualTcx } = await import(
  `${distUrl("tcxBuilder.js")}?cacheBust=${Date.now()}`
);

// Full case with effort fields.
const xml = buildManualTcx({
  sport: "run",
  startTimeIso: "2026-07-08T14:00:00Z",
  durationSec: 2700,
  distanceM: 8000,
  calories: 500,
  avgHr: 145
});
assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
assert.match(xml, /<Activity Sport="Running">/);
assert.match(xml, /<Id>2026-07-08T14:00:00Z<\/Id>/);
assert.match(xml, /<Lap StartTime="2026-07-08T14:00:00Z">/);
assert.match(xml, /<TotalTimeSeconds>2700<\/TotalTimeSeconds>/);
assert.match(xml, /<DistanceMeters>8000<\/DistanceMeters>/);
assert.match(xml, /<Calories>500<\/Calories>/);
assert.match(xml, /<AverageHeartRateBpm><Value>145<\/Value><\/AverageHeartRateBpm>/);
assert.match(xml, /<Intensity>Active<\/Intensity>/);
assert.match(xml, /<TriggerMethod>Manual<\/TriggerMethod>/);
// AverageHeartRateBpm must appear before Intensity (schema order).
assert.ok(xml.indexOf("AverageHeartRateBpm") < xml.indexOf("<Intensity>"));

// Sport mapping.
assert.match(buildManualTcx({ sport: "bike", startTimeIso: "2026-07-08T00:00:00Z", durationSec: 60, distanceM: 0 }), /Sport="Biking"/);
assert.match(buildManualTcx({ sport: "other", startTimeIso: "2026-07-08T00:00:00Z", durationSec: 60, distanceM: 0 }), /Sport="Other"/);

// Effort fields omitted: Calories defaults to 0, no AverageHeartRateBpm element.
const bare = buildManualTcx({ sport: "other", startTimeIso: "2026-07-08T00:00:00Z", durationSec: 1800, distanceM: 0 });
assert.match(bare, /<Calories>0<\/Calories>/);
assert.ok(!bare.includes("AverageHeartRateBpm"));

console.log("tcx-builder tests passed");
