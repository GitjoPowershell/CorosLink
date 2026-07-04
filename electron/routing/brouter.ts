import type {
  RouteActivityType,
  RouteGeometry,
  RouteWaypoint,
  TrainingHubTrackPoint
} from "../types";

// BRouter is a free, keyless OSM router. We call its public GeoJSON endpoint,
// which returns a LineString with `[lon, lat, elevation]` coordinates plus
// distance/ascent/time in the feature properties.
const BROUTER_BASE_URL = "https://brouter.de/brouter";
const EARTH_RADIUS_M = 6_371_000;

/** Maps a user-facing activity onto an available brouter.de routing profile. */
export const BROUTER_PROFILE_BY_ACTIVITY: Record<RouteActivityType, string> = {
  walking: "hiking-mountain",
  running: "hiking-mountain",
  hiking: "hiking-mountain",
  "cycling-road": "fastbike",
  "cycling-mountain": "mtb"
};

export function brouterProfileFor(activityType: RouteActivityType): string {
  return BROUTER_PROFILE_BY_ACTIVITY[activityType] ?? "trekking";
}

interface BrouterResponse {
  features?: Array<{
    geometry?: { coordinates?: number[][] };
    properties?: Record<string, string | undefined>;
  }>;
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two points in metres. */
export function haversineMeters(a: RouteWaypoint, b: RouteWaypoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function numberFrom(
  properties: Record<string, string | undefined> | undefined,
  key: string
): number | undefined {
  const raw = properties?.[key];
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Routes through the given waypoints along real roads/trails via BRouter.
 * Requires at least two waypoints.
 */
export async function routeViaBrouter(
  waypoints: RouteWaypoint[],
  activityType: RouteActivityType,
  fetchImpl: typeof fetch = fetch
): Promise<RouteGeometry> {
  if (waypoints.length < 2) {
    throw new Error("At least two points are needed to build a route.");
  }

  const lonlats = waypoints
    .map((point) => `${point.lon},${point.lat}`)
    .join("|");
  const url = new URL(BROUTER_BASE_URL);
  url.searchParams.set("lonlats", lonlats);
  url.searchParams.set("profile", brouterProfileFor(activityType));
  url.searchParams.set("alternativeidx", "0");
  url.searchParams.set("format", "geojson");

  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(30_000)
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(describeBrouterError(response.status, details));
  }

  const payload = (await response.json()) as BrouterResponse;
  const feature = payload.features?.[0];
  const coordinates = feature?.geometry?.coordinates;
  if (!coordinates || coordinates.length < 2) {
    throw new Error(
      "No path was found near one of your points. Move it closer to a road or trail."
    );
  }

  const points: TrainingHubTrackPoint[] = coordinates
    .filter((coordinate) => coordinate.length >= 2)
    .map((coordinate) => ({
      lon: coordinate[0],
      lat: coordinate[1],
      elevation: coordinate.length > 2 ? coordinate[2] : undefined
    }));

  const distanceMeters =
    numberFrom(feature?.properties, "track-length") ??
    distanceAlong(points);
  const ascentMeters = numberFrom(feature?.properties, "filtered ascend");
  const durationSeconds = numberFrom(feature?.properties, "total-time");

  return {
    points,
    distanceMeters: Math.round(distanceMeters),
    durationSeconds,
    ascentMeters,
    // BRouter reports ascent only; treat descent as symmetric for loops and
    // leave undefined-friendly for point-to-point (callers may ignore it).
    descentMeters: ascentMeters
  };
}

/** Straight-line geometry for freehand drawing (no snapping to paths). */
export function straightLineGeometry(
  waypoints: RouteWaypoint[]
): RouteGeometry {
  const points: TrainingHubTrackPoint[] = waypoints.map((point) => ({
    lat: point.lat,
    lon: point.lon
  }));
  return {
    points,
    distanceMeters: Math.round(distanceAlong(points))
  };
}

function distanceAlong(points: TrainingHubTrackPoint[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1]!;
    const current = points[index]!;
    if (
      previous.lat === undefined ||
      previous.lon === undefined ||
      current.lat === undefined ||
      current.lon === undefined
    ) {
      continue;
    }
    total += haversineMeters(
      { lat: previous.lat, lon: previous.lon },
      { lat: current.lat, lon: current.lon }
    );
  }
  return total;
}

/** Offsets a point by `distanceM` metres along the given bearing (degrees). */
function offsetPoint(
  origin: RouteWaypoint,
  bearingDegrees: number,
  distanceM: number
): RouteWaypoint {
  const bearing = toRadians(bearingDegrees);
  const north = distanceM * Math.cos(bearing);
  const east = distanceM * Math.sin(bearing);
  const dLat = (north / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLon =
    (east / (EARTH_RADIUS_M * Math.cos(toRadians(origin.lat)))) *
    (180 / Math.PI);
  return { lat: origin.lat + dLat, lon: origin.lon + dLon };
}

/**
 * Builds a loop of roughly `distanceKm` starting and ending at `start`.
 *
 * BRouter has no round-trip primitive, so we lay waypoints on a circle around
 * the start and route through them. Roads add detour, so the crow-fly circle is
 * shrunk by a factor, then the radius is rescaled up to twice to converge on the
 * target distance. `seed` rotates the starting bearing so "Regenerate" yields a
 * different loop for the same inputs.
 */
export async function synthesizeLoop(
  start: RouteWaypoint,
  distanceKm: number,
  activityType: RouteActivityType,
  seed = 0,
  fetchImpl: typeof fetch = fetch
): Promise<RouteGeometry> {
  const targetMeters = distanceKm * 1000;
  const baseBearing = seed % 360;
  // Four cardinal-ish waypoints make a rounded loop. Detour factor accounts for
  // roads never being straight between the circle points.
  const bearings = [0, 90, 180, 270].map((angle) => baseBearing + angle);
  const detourFactor = 1.3;

  let radius = targetMeters / (2 * Math.PI) / detourFactor;
  let best: RouteGeometry | null = null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const waypoints: RouteWaypoint[] = [
      start,
      ...bearings.map((bearing) => offsetPoint(start, bearing, radius)),
      start
    ];
    const geometry = await routeViaBrouter(waypoints, activityType, fetchImpl);

    if (
      !best ||
      Math.abs(geometry.distanceMeters - targetMeters) <
        Math.abs(best.distanceMeters - targetMeters)
    ) {
      best = geometry;
    }

    const ratio = targetMeters / geometry.distanceMeters;
    if (ratio > 0.85 && ratio < 1.15) {
      break;
    }
    radius *= ratio;
  }

  if (!best) {
    throw new Error("Couldn't build a loop from that location.");
  }
  return best;
}

function describeBrouterError(status: number, details: string): string {
  const trimmed = details.trim();
  if (/target.*island|position not mapped|no.*route/i.test(trimmed)) {
    return "No path was found near one of your points. Move it closer to a road or trail, or switch the sport.";
  }
  if (status === 500 && trimmed) {
    return `Routing failed: ${trimmed.slice(0, 160)}`;
  }
  return `Routing service error: ${status}${trimmed ? ` – ${trimmed.slice(0, 160)}` : ""}`;
}
