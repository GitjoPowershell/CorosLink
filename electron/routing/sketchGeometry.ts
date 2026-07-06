import type { RouteWaypoint } from "../types";

/**
 * Pure geometry for Sketch mode (GPS art): simplifying freehand strokes,
 * resampling them into a bounded set of snap waypoints, and projecting
 * unit-space shapes/glyphs onto the map. Dependency-free so the renderer can
 * bundle it directly and the script test harness can import the compiled
 * dist-electron output.
 */

export type SketchFidelity = "loose" | "balanced" | "strict";

/** A point in normalized shape space; x grows east, y grows north. */
export interface UnitPoint {
  x: number;
  y: number;
}

const METERS_PER_DEGREE_LAT = 111_320;
/** Fewer vias give the router freedom; more trace the sketch tighter. */
const FIDELITY_DIVISOR: Record<SketchFidelity, number> = {
  loose: 20,
  balanced: 35,
  strict: 55
};
const MIN_SPACING_METERS = 60;
export const MIN_SKETCH_WAYPOINTS = 8;
/** Keeps a single BRouter request comfortably within URL/time limits. */
export const MAX_SKETCH_WAYPOINTS = 60;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function haversineMeters(a: RouteWaypoint, b: RouteWaypoint): number {
  const earthRadius = 6_371_000;
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * sinLon * sinLon;
  return 2 * earthRadius * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathDistanceMeters(points: RouteWaypoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += haversineMeters(points[i - 1]!, points[i]!);
  }
  return total;
}

/** Arc-length-weighted centroid, so dense sample runs don't bias the result. */
export function pathCentroid(points: RouteWaypoint[]): RouteWaypoint {
  if (points.length === 1) {
    return { ...points[0]! };
  }
  let weightSum = 0;
  let lat = 0;
  let lon = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const weight = haversineMeters(a, b);
    weightSum += weight;
    lat += ((a.lat + b.lat) / 2) * weight;
    lon += ((a.lon + b.lon) / 2) * weight;
  }
  if (weightSum === 0) {
    return { ...points[0]! };
  }
  return { lat: lat / weightSum, lon: lon / weightSum };
}

/**
 * Rotates (clockwise degrees) and scales a path about `anchor` in local-meter
 * space. Used by Auto fit to generate candidate shape transforms.
 */
export function transformPath(
  points: RouteWaypoint[],
  anchor: RouteWaypoint,
  scaleFactor: number,
  rotationDeg: number
): RouteWaypoint[] {
  const angle = toRadians(rotationDeg);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const metersPerDegreeLon =
    METERS_PER_DEGREE_LAT * Math.cos(toRadians(anchor.lat));
  return points.map((point) => {
    const east = (point.lon - anchor.lon) * metersPerDegreeLon;
    const north = (point.lat - anchor.lat) * METERS_PER_DEGREE_LAT;
    const rotatedEast = (east * cos + north * sin) * scaleFactor;
    const rotatedNorth = (-east * sin + north * cos) * scaleFactor;
    return {
      lat: anchor.lat + rotatedNorth / METERS_PER_DEGREE_LAT,
      lon: anchor.lon + rotatedEast / metersPerDegreeLon
    };
  });
}

/** Local equirectangular meters relative to an origin — plenty for sketch scale. */
function toLocalMeters(
  point: RouteWaypoint,
  origin: RouteWaypoint
): { x: number; y: number } {
  const metersPerDegreeLon =
    METERS_PER_DEGREE_LAT * Math.cos(toRadians(origin.lat));
  return {
    x: (point.lon - origin.lon) * metersPerDegreeLon,
    y: (point.lat - origin.lat) * METERS_PER_DEGREE_LAT
  };
}

function perpendicularDistanceMeters(
  point: { x: number; y: number },
  lineStart: { x: number; y: number },
  lineEnd: { x: number; y: number }
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
  }
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSq
    )
  );
  return Math.hypot(
    point.x - (lineStart.x + t * dx),
    point.y - (lineStart.y + t * dy)
  );
}

/**
 * Douglas–Peucker in local-meter space: removes hand jitter while keeping
 * deliberate corners. Endpoints always survive, so closed strokes stay closed.
 */
export function simplifyPath(
  points: RouteWaypoint[],
  toleranceMeters: number
): RouteWaypoint[] {
  if (points.length <= 2 || toleranceMeters <= 0) {
    return points.slice();
  }
  const origin = points[0]!;
  const local = points.map((point) => toLocalMeters(point, origin));
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [startIdx, endIdx] = stack.pop()!;
    let maxDistance = 0;
    let maxIdx = -1;
    for (let i = startIdx + 1; i < endIdx; i += 1) {
      const distance = perpendicularDistanceMeters(
        local[i]!,
        local[startIdx]!,
        local[endIdx]!
      );
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIdx = i;
      }
    }
    if (maxIdx !== -1 && maxDistance > toleranceMeters) {
      keep[maxIdx] = true;
      stack.push([startIdx, maxIdx], [maxIdx, endIdx]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Waypoint spacing for a sketch of the given perimeter at a fidelity level. */
export function sketchSpacingMeters(
  perimeterMeters: number,
  fidelity: SketchFidelity
): number {
  return Math.max(
    MIN_SPACING_METERS,
    perimeterMeters / FIDELITY_DIVISOR[fidelity]
  );
}

/**
 * Resamples a path at (roughly) equal arc-length spacing. First and last
 * points are always preserved, so a closed input stays closed. Point count is
 * clamped so the result is always routable in one BRouter request.
 */
export function resampleByArcLength(
  points: RouteWaypoint[],
  spacingMeters: number,
  options?: { minPoints?: number; maxPoints?: number }
): RouteWaypoint[] {
  if (points.length <= 2) {
    return points.slice();
  }
  const minPoints = options?.minPoints ?? MIN_SKETCH_WAYPOINTS;
  const maxPoints = options?.maxPoints ?? MAX_SKETCH_WAYPOINTS;
  const total = pathDistanceMeters(points);
  if (total === 0) {
    return [points[0]!, points[points.length - 1]!];
  }
  const segments = Math.min(
    Math.max(Math.round(total / spacingMeters), minPoints - 1),
    maxPoints - 1
  );
  const step = total / segments;

  const result: RouteWaypoint[] = [points[0]!];
  let travelled = 0;
  let nextAt = step;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]!;
    const current = points[i]!;
    let segmentLength = haversineMeters(prev, current);
    let segmentStart = travelled;
    while (
      segmentLength > 0 &&
      nextAt <= segmentStart + segmentLength &&
      result.length < segments
    ) {
      const t = (nextAt - segmentStart) / segmentLength;
      result.push({
        lat: prev.lat + (current.lat - prev.lat) * t,
        lon: prev.lon + (current.lon - prev.lon) * t
      });
      nextAt += step;
    }
    travelled = segmentStart + segmentLength;
  }
  result.push(points[points.length - 1]!);
  return result;
}

/**
 * Resamples a path while guaranteeing that shape-defining corners survive as
 * waypoints. Corners come from Douglas–Peucker (so between two adjacent
 * corners the original path deviates less than the tolerance, making straight
 * subdivision of the chord safe); edges longer than `spacingMeters` get
 * uniform interior samples. Total count respects the waypoint budget.
 */
export function resampleWithCorners(
  points: RouteWaypoint[],
  spacingMeters: number,
  options?: { minPoints?: number; maxPoints?: number }
): RouteWaypoint[] {
  if (points.length <= 2) {
    return points.slice();
  }
  const minPoints = options?.minPoints ?? MIN_SKETCH_WAYPOINTS;
  const maxPoints = options?.maxPoints ?? MAX_SKETCH_WAYPOINTS;
  const perimeter = pathDistanceMeters(points);
  if (perimeter === 0) {
    return [points[0]!, points[points.length - 1]!];
  }

  // Small sketches deserve at least minPoints vias regardless of spacing.
  const spacing = Math.min(spacingMeters, perimeter / (minPoints - 1));

  let tolerance = Math.min(spacing / 2, perimeter / 60);
  let corners = simplifyPath(points, tolerance);
  while (corners.length > maxPoints) {
    tolerance *= 1.6;
    corners = simplifyPath(points, tolerance);
  }

  // Distribute the remaining budget across edges, proportional to length.
  const edgeLengths = corners
    .slice(1)
    .map((corner, i) => haversineMeters(corners[i]!, corner));
  const desired = edgeLengths.map((length) =>
    Math.max(0, Math.floor(length / spacing))
  );
  const desiredTotal = desired.reduce((sum, value) => sum + value, 0);
  const available = maxPoints - corners.length;
  const shrink = desiredTotal > available ? available / desiredTotal : 1;

  const result: RouteWaypoint[] = [corners[0]!];
  for (let i = 1; i < corners.length; i += 1) {
    const from = corners[i - 1]!;
    const to = corners[i]!;
    const interior = Math.floor(desired[i - 1]! * shrink);
    for (let s = 1; s <= interior; s += 1) {
      const t = s / (interior + 1);
      result.push({
        lat: from.lat + (to.lat - from.lat) * t,
        lon: from.lon + (to.lon - from.lon) * t
      });
    }
    result.push(to);
  }
  return result;
}

/** How closely a snapped route reproduces the sketched shape. Lower = better. */
export interface SketchMatch {
  /** Dimensionless: normalized deviation plus a detour penalty. */
  score: number;
  /** Symmetric mean route↔shape deviation, in meters. */
  meanDeviationMeters: number;
  /** Route length divided by sketch outline length. */
  lengthRatio: number;
}

/** Route may exceed the outline by this factor before the detour penalty. */
const LENGTH_SLACK = 1.15;
const SCORE_SAMPLES = 96;

function minDistanceToPath(
  point: { x: number; y: number },
  path: Array<{ x: number; y: number }>
): number {
  let best = Infinity;
  for (let i = 1; i < path.length; i += 1) {
    const distance = perpendicularDistanceMeters(point, path[i - 1]!, path[i]!);
    if (distance < best) {
      best = distance;
    }
  }
  return best;
}

/**
 * Scores how well `route` reproduces `ghost`: symmetric mean deviation
 * (route must hug the shape AND cover all of it) normalized by the sketch's
 * bounding-box diagonal, plus a penalty for out-and-back detours that inflate
 * the route beyond the outline length.
 */
export function shapeSimilarityScore(
  route: RouteWaypoint[],
  ghost: RouteWaypoint[]
): SketchMatch {
  if (route.length < 2 || ghost.length < 2) {
    return { score: Infinity, meanDeviationMeters: Infinity, lengthRatio: 0 };
  }
  const routeLength = pathDistanceMeters(route);
  const ghostLength = pathDistanceMeters(ghost);
  if (routeLength === 0 || ghostLength === 0) {
    return { score: Infinity, meanDeviationMeters: Infinity, lengthRatio: 0 };
  }

  const origin = ghost[0]!;
  const sampleOptions = { minPoints: 2, maxPoints: SCORE_SAMPLES + 32 };
  const routeSamples = resampleByArcLength(
    route,
    routeLength / SCORE_SAMPLES,
    sampleOptions
  ).map((point) => toLocalMeters(point, origin));
  const ghostSamples = resampleByArcLength(
    ghost,
    ghostLength / SCORE_SAMPLES,
    sampleOptions
  ).map((point) => toLocalMeters(point, origin));
  const routeLocal = route.map((point) => toLocalMeters(point, origin));
  const ghostLocal = ghost.map((point) => toLocalMeters(point, origin));

  let routeToGhost = 0;
  for (const sample of routeSamples) {
    routeToGhost += minDistanceToPath(sample, ghostLocal);
  }
  routeToGhost /= routeSamples.length;

  let ghostToRoute = 0;
  for (const sample of ghostSamples) {
    ghostToRoute += minDistanceToPath(sample, routeLocal);
  }
  ghostToRoute /= ghostSamples.length;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of ghostLocal) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY) || 1;

  const meanDeviationMeters = (routeToGhost + ghostToRoute) / 2;
  const lengthRatio = routeLength / ghostLength;
  const score =
    meanDeviationMeters / diagonal + 0.5 * Math.max(0, lengthRatio - LENGTH_SLACK);
  return { score, meanDeviationMeters, lengthRatio };
}

/**
 * Projects a unit-space shape ([-1, 1] square) onto the map around `center`.
 * `sizeMeters` is the shape's full width/height; rotation is clockwise degrees.
 */
export function projectUnitShape(
  shape: UnitPoint[],
  center: RouteWaypoint,
  sizeMeters: number,
  rotationDeg: number
): RouteWaypoint[] {
  const half = sizeMeters / 2;
  const angle = toRadians(rotationDeg);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const metersPerDegreeLon =
    METERS_PER_DEGREE_LAT * Math.cos(toRadians(center.lat));
  return shape.map((point) => {
    // Clockwise rotation in an east/north frame.
    const east = (point.x * cos + point.y * sin) * half;
    const north = (-point.x * sin + point.y * cos) * half;
    return {
      lat: center.lat + north / METERS_PER_DEGREE_LAT,
      lon: center.lon + east / metersPerDegreeLon
    };
  });
}

function strokeEndpoints(stroke: UnitPoint[]): [UnitPoint, UnitPoint] {
  return [stroke[0]!, stroke[stroke.length - 1]!];
}

function unitDistance(a: UnitPoint, b: UnitPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Joins disconnected strokes into one continuous polyline by greedily walking
 * to the nearest remaining stroke endpoint (reversing strokes as needed). The
 * straight pen-travel joins become ordinary waypoint legs that the router
 * later resolves along real streets.
 */
export function connectStrokes(strokes: UnitPoint[][]): UnitPoint[] {
  const remaining = strokes.filter((stroke) => stroke.length > 0);
  if (remaining.length === 0) {
    return [];
  }
  const path = remaining.shift()!.slice();
  while (remaining.length > 0) {
    const cursor = path[path.length - 1]!;
    let bestIdx = 0;
    let bestReversed = false;
    let bestDistance = Infinity;
    remaining.forEach((stroke, idx) => {
      const [start, end] = strokeEndpoints(stroke);
      const toStart = unitDistance(cursor, start);
      const toEnd = unitDistance(cursor, end);
      if (toStart < bestDistance) {
        bestDistance = toStart;
        bestIdx = idx;
        bestReversed = false;
      }
      if (toEnd < bestDistance) {
        bestDistance = toEnd;
        bestIdx = idx;
        bestReversed = true;
      }
    });
    const [next] = remaining.splice(bestIdx, 1);
    path.push(...(bestReversed ? next!.slice().reverse() : next!));
  }
  return path;
}

export interface GlyphStrokes {
  /** Advance width in glyph units (same scale as the stroke coordinates). */
  width: number;
  strokes: UnitPoint[][];
}

/**
 * Lays glyphs out left-to-right with `trackingEm` extra spacing (in glyph
 * units) between them, returning the translated strokes plus total width.
 */
export function layoutGlyphStrokes(
  glyphs: GlyphStrokes[],
  trackingEm = 0.2
): { strokes: UnitPoint[][]; width: number } {
  const strokes: UnitPoint[][] = [];
  let penX = 0;
  glyphs.forEach((glyph, index) => {
    if (index > 0) {
      penX += trackingEm;
    }
    for (const stroke of glyph.strokes) {
      strokes.push(stroke.map((point) => ({ x: point.x + penX, y: point.y })));
    }
    penX += glyph.width;
  });
  return { strokes, width: penX };
}
