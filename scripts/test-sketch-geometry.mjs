import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const moduleUrl = pathToFileURL(
  path.join(repoRoot, "dist-electron", "routing", "sketchGeometry.js")
);

const {
  connectStrokes,
  layoutGlyphStrokes,
  pathCentroid,
  pathDistanceMeters,
  projectUnitShape,
  resampleByArcLength,
  resampleWithCorners,
  shapeSimilarityScore,
  simplifyPath,
  sketchSpacingMeters,
  transformPath,
  MAX_SKETCH_WAYPOINTS,
  MIN_SKETCH_WAYPOINTS
} = await import(`${moduleUrl.href}?cacheBust=${Date.now()}`);

function haversineMeters(a, b) {
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

// --- pathDistanceMeters -----------------------------------------------------
// ~111 m per 0.001° of latitude.
const northLeg = [
  { lat: 45, lon: -73 },
  { lat: 45.001, lon: -73 }
];
const legDistance = pathDistanceMeters(northLeg);
assert.ok(Math.abs(legDistance - 111.2) < 1, `leg was ${legDistance}`);

// --- simplifyPath -------------------------------------------------------------
// A jittered straight line collapses to its endpoints at 10 m tolerance.
const jittered = [];
for (let i = 0; i <= 20; i += 1) {
  jittered.push({
    lat: 45 + i * 0.0005,
    lon: -73 + (i % 2 === 0 ? 0.00002 : -0.00002)
  });
}
const simplified = simplifyPath(jittered, 10);
assert.equal(simplified.length, 2);
assert.deepEqual(simplified[0], jittered[0]);
assert.deepEqual(simplified.at(-1), jittered.at(-1));

// Square corners survive the same tolerance.
const square = [
  { lat: 45, lon: -73 },
  { lat: 45.005, lon: -73 },
  { lat: 45.005, lon: -73.007 },
  { lat: 45, lon: -73.007 },
  { lat: 45, lon: -73 }
];
const squareSimplified = simplifyPath(square, 10);
assert.equal(squareSimplified.length, 5);

// --- sketchSpacingMeters -----------------------------------------------------
assert.ok(
  sketchSpacingMeters(10000, "loose") > sketchSpacingMeters(10000, "balanced")
);
assert.ok(
  sketchSpacingMeters(10000, "balanced") > sketchSpacingMeters(10000, "strict")
);
// Tiny sketches floor at 60 m so vias stay meaningfully apart.
assert.equal(sketchSpacingMeters(500, "strict"), 60);

// --- resampleByArcLength -----------------------------------------------------
// Densify the square so resampling has segments to interpolate across.
const denseSquare = [];
for (let leg = 1; leg < square.length; leg += 1) {
  const from = square[leg - 1];
  const to = square[leg];
  for (let i = 0; i < 50; i += 1) {
    denseSquare.push({
      lat: from.lat + ((to.lat - from.lat) * i) / 50,
      lon: from.lon + ((to.lon - from.lon) * i) / 50
    });
  }
}
denseSquare.push(square.at(-1));

const perimeter = pathDistanceMeters(denseSquare);
const resampled = resampleByArcLength(denseSquare, 100);
// Closed input stays closed.
assert.deepEqual(resampled[0], resampled.at(-1));
// Consecutive gaps stay near the requested spacing (corners can shorten one).
const expectedStep = perimeter / (resampled.length - 1);
for (let i = 1; i < resampled.length; i += 1) {
  const gap = haversineMeters(resampled[i - 1], resampled[i]);
  assert.ok(
    gap < expectedStep * 1.5,
    `gap ${i} was ${gap.toFixed(1)} m vs step ${expectedStep.toFixed(1)} m`
  );
}
// Clamps: huge spacing still yields the minimum point count…
assert.equal(
  resampleByArcLength(denseSquare, 1e9).length,
  MIN_SKETCH_WAYPOINTS
);
// …and tiny spacing never exceeds the single-request maximum.
assert.equal(
  resampleByArcLength(denseSquare, 0.1).length,
  MAX_SKETCH_WAYPOINTS
);

// --- projectUnitShape --------------------------------------------------------
const center = { lat: 45, lon: -73 };
const unitCircle = [];
for (let i = 0; i < 16; i += 1) {
  const angle = (i / 16) * 2 * Math.PI;
  unitCircle.push({ x: Math.cos(angle), y: Math.sin(angle) });
}
const projected = projectUnitShape(unitCircle, center, 1000, 0);
for (const point of projected) {
  const radius = haversineMeters(center, point);
  assert.ok(Math.abs(radius - 500) < 5, `radius was ${radius}`);
}
// 90° clockwise rotation maps the +y (north) extreme onto east.
const north = projectUnitShape([{ x: 0, y: 1 }], center, 1000, 90)[0];
assert.ok(north.lon > center.lon, "rotated north extreme should sit east");
assert.ok(Math.abs(north.lat - center.lat) < 0.0002);

// --- connectStrokes / layoutGlyphStrokes -------------------------------------
const glyphA = {
  width: 1,
  strokes: [
    [
      { x: 0, y: 0 },
      { x: 0.5, y: 1 },
      { x: 1, y: 0 }
    ]
  ]
};
const glyphI = {
  width: 0.4,
  strokes: [
    [
      { x: 0.2, y: 0 },
      { x: 0.2, y: 1 }
    ]
  ]
};
const layout = layoutGlyphStrokes([glyphA, glyphI], 0.25);
assert.equal(layout.strokes.length, 2);
assert.ok(Math.abs(layout.width - 1.65) < 1e-9);
// Second glyph is translated past the first plus tracking.
assert.ok(Math.abs(layout.strokes[1][0].x - 1.45) < 1e-9);

const connected = connectStrokes(layout.strokes);
// One continuous path containing every stroke point.
assert.equal(connected.length, 5);
// The "I" stroke is entered at its nearest endpoint to the cursor. The cursor
// ends at (1, 0); the I endpoints are (1.45, 0) and (1.45, 1) — bottom first.
assert.deepEqual(connected[3], { x: 1.45, y: 0 });
assert.deepEqual(connected[4], { x: 1.45, y: 1 });

// --- pathCentroid --------------------------------------------------------------
const squareCentroid = pathCentroid(square);
assert.ok(Math.abs(squareCentroid.lat - 45.0025) < 0.0005);
assert.ok(Math.abs(squareCentroid.lon - -73.0035) < 0.0005);

// --- transformPath -------------------------------------------------------------
const anchor = { lat: 45, lon: -73 };
const spoke = [{ lat: 45.001, lon: -73 }]; // ~111 m north of the anchor
const doubled = transformPath(spoke, anchor, 2, 0)[0];
assert.ok(
  Math.abs(haversineMeters(anchor, doubled) - 2 * haversineMeters(anchor, spoke[0])) < 1
);
const rotated = transformPath(spoke, anchor, 1, 90)[0];
assert.ok(rotated.lon > anchor.lon, "90° should map north onto east");
assert.ok(Math.abs(rotated.lat - anchor.lat) < 0.0001);
const fixed = transformPath([anchor], anchor, 3, 137)[0];
assert.ok(haversineMeters(anchor, fixed) < 0.01, "anchor is a fixed point");

// --- resampleWithCorners -------------------------------------------------------
// A 5-point star: every spike vertex must survive coarse resampling.
const starUnit = [];
for (let i = 0; i < 10; i += 1) {
  const radius = i % 2 === 0 ? 1 : 0.42;
  const angle = Math.PI / 2 + (i / 10) * 2 * Math.PI;
  starUnit.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
}
starUnit.push({ ...starUnit[0] });
const star = projectUnitShape(starUnit, { lat: 45, lon: -73 }, 2000, 0);
const starResampled = resampleWithCorners(star, 400);
for (const vertex of star) {
  const hit = starResampled.some((p) => haversineMeters(p, vertex) < 1);
  assert.ok(hit, `star vertex lost: ${JSON.stringify(vertex)}`);
}
assert.deepEqual(starResampled[0], starResampled.at(-1));
// Tiny spacing still respects the single-request budget.
assert.ok(resampleWithCorners(star, 1).length <= MAX_SKETCH_WAYPOINTS);
// Huge spacing still yields enough vias to route.
assert.ok(resampleWithCorners(star, 1e9).length >= MIN_SKETCH_WAYPOINTS);

// --- shapeSimilarityScore ------------------------------------------------------
const identical = shapeSimilarityScore(denseSquare, denseSquare);
assert.ok(identical.score < 0.01, `identical score was ${identical.score}`);
assert.ok(Math.abs(identical.lengthRatio - 1) < 0.01);

// An out-and-back detour (500 m off the shape and back) scores worse.
const detourRoute = [
  ...denseSquare.slice(0, 40),
  { lat: denseSquare[40].lat, lon: denseSquare[40].lon + 0.0064 },
  ...denseSquare.slice(40)
];
const detour = shapeSimilarityScore(detourRoute, denseSquare);
assert.ok(detour.score > identical.score * 5, `detour score ${detour.score}`);
assert.ok(detour.lengthRatio > 1.3);

// A diagonally offset copy scores worse than the aligned one (diagonal so
// both edge families deviate instead of sliding along themselves).
const offsetRoute = denseSquare.map((p) => ({
  lat: p.lat + 0.002,
  lon: p.lon + 0.0025
}));
const offset = shapeSimilarityScore(offsetRoute, denseSquare);
assert.ok(offset.score > identical.score * 5, `offset score ${offset.score}`);
assert.ok(offset.meanDeviationMeters > 100);

console.log("sketch geometry tests passed");
