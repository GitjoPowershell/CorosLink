import {
  geoCentroid,
  geoDistance,
  geoEquirectangular,
  geoOrthographic,
  geoPath,
  type GeoPermissibleObjects,
} from "d3-geo";
import type { Feature, MultiPoint } from "geojson";
import {
  ArrowRight,
  Footprints,
  LockKeyhole,
  MapPin,
  RotateCcw,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { feature } from "topojson-client";
import type {
  GeometryCollection,
  Topology,
} from "topojson-specification";
import landAtlas from "world-atlas/land-110m.json";
import type {
  TrainingHubActivity,
  TrainingHubActivityDetail,
} from "../../electron/types";
import {
  formatTrainingTimestamp,
} from "../training/formatters";
import {
  aggregateActivityStats,
  bucketVisitsGeographically,
  extractTrackPoints,
  formatOverallDistance,
  formatOverallDuration,
  getCachedRoutePolylines,
  getCachedVisitPoints,
  loadActivityVisitCentroids,
  rememberActivityGeo,
  sampleGlobePoints,
  type ActivityRoutePolyline,
  type ActivityVisitPoint,
  type GeoHeatBucket,
  type GlobePoint,
} from "./activityVisitHeatmap";
import {
  ActivityGlobeStreetMap,
  type StreetMapFocus,
} from "./ActivityGlobeStreetMap";

interface ActivityGlobeCardProps {
  activities: TrainingHubActivity[];
  connected: boolean;
  detail: TrainingHubActivityDetail | null;
  loading: boolean;
  onOpenTraining: () => void;
}

type LandTopology = Topology<{ land: GeometryCollection }>;

const topology = landAtlas as unknown as LandTopology;
const land = feature(topology, topology.objects.land);
const MAX_RENDERED_POINTS = 900;
/** Zoomed-out land grid — sparse enough to read as dots, not a fill. */
const DOT_STEP_FAR_DEGREES = 1.9;
/** Mid zoom / light regional framing. */
const DOT_STEP_MID_DEGREES = 1.15;
/** Cluster baseline / closer framing — sharper continental silhouette. */
const DOT_STEP_NEAR_DEGREES = 0.85;
/** Regional framing floor (~18°). Drill-down can go tighter. */
const MIN_HALF_SPAN_RAD = (18 * Math.PI) / 180;
const DRILL_MIN_HALF_SPAN_RAD = (6 * Math.PI) / 180;
const MIN_SCALE_FACTOR = 1;
const MAX_SCALE_FACTOR = 4.2;
/** Past this globe scale, crossfade into the street heatmap map. */
const STREET_ENTER_SCALE = 3.05;
const DEFAULT_ROTATION: [number, number, number] = [20, -18, 0];
const IDLE_SPIN_DEG_PER_MS = 0.008;
const CLUSTER_RADIUS_RAD = (14 * Math.PI) / 180;
const DRILL_RADIUS_RAD = (5 * Math.PI) / 180;
const HIT_PIXEL_RADIUS = 28;
const DRAG_CLICK_SLOP_PX = 8;
const CAMERA_EASE_MS = 780;

const landDotsCache = new Map<number, Float64Array>();
let landMaskCache: {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  projection: ReturnType<typeof geoEquirectangular>;
} | null = null;

function landDotStepForScale(scaleFactor: number): number {
  // Cluster framing is typically ~2–3.2; keep far/home (≈1) on the coarse grid.
  if (scaleFactor >= 2) {
    return DOT_STEP_NEAR_DEGREES;
  }
  if (scaleFactor >= 1.35) {
    return DOT_STEP_MID_DEGREES;
  }
  return DOT_STEP_FAR_DEGREES;
}

function getLandMask(): NonNullable<typeof landMaskCache> | null {
  if (landMaskCache) {
    return landMaskCache;
  }

  const width = 1440;
  const height = 720;
  const raster = document.createElement("canvas");
  raster.width = width;
  raster.height = height;
  const rasterContext = raster.getContext("2d", {
    willReadFrequently: true,
  });
  if (!rasterContext) {
    return null;
  }

  const projection = geoEquirectangular().fitExtent(
    [
      [0, 0],
      [width, height],
    ],
    { type: "Sphere" },
  );
  rasterContext.fillStyle = "#fff";
  rasterContext.beginPath();
  geoPath(projection, rasterContext)(land as GeoPermissibleObjects);
  rasterContext.fill();
  landMaskCache = {
    width,
    height,
    pixels: rasterContext.getImageData(0, 0, width, height).data,
    projection,
  };
  return landMaskCache;
}

function getLandDots(stepDegrees: number): Float64Array {
  const cached = landDotsCache.get(stepDegrees);
  if (cached) {
    return cached;
  }

  const mask = getLandMask();
  if (!mask) {
    return new Float64Array(0);
  }

  const { width, height, pixels, projection } = mask;
  const dots: number[] = [];
  for (let row = 0; ; row += 1) {
    const lat = -84 + row * stepDegrees;
    if (lat > 84) {
      break;
    }

    const lonStep =
      stepDegrees / Math.max(Math.cos((lat * Math.PI) / 180), 0.08);
    for (
      let lon = -180 + (row % 2) * lonStep * 0.5;
      lon < 180;
      lon += lonStep
    ) {
      const projected = projection([lon, lat]);
      if (!projected) {
        continue;
      }

      const pixelX = Math.min(width - 1, Math.max(0, Math.round(projected[0])));
      const pixelY = Math.min(
        height - 1,
        Math.max(0, Math.round(projected[1])),
      );
      if (pixels[(pixelY * width + pixelX) * 4 + 3]! > 128) {
        dots.push(lon, lat);
      }
    }
  }

  const built = Float64Array.from(dots);
  landDotsCache.set(stepDegrees, built);
  return built;
}

interface GlobeCamera {
  rotation: [number, number, number];
  scaleFactor: number;
}

interface GlobeLayout {
  width: number;
  height: number;
  sphereX: number;
  sphereY: number;
  sphereRadius: number;
}

function samplePoints(points: GlobePoint[]): GlobePoint[] {
  return sampleGlobePoints(points, MAX_RENDERED_POINTS);
}

function mergeVisits(
  base: ActivityVisitPoint[],
  next: ActivityVisitPoint,
): ActivityVisitPoint[] {
  if (base.some((visit) => visit.activityId === next.activityId)) {
    return base;
  }
  return [...base, next];
}

function mergeRoutes(
  base: ActivityRoutePolyline[],
  next: ActivityRoutePolyline,
): ActivityRoutePolyline[] {
  if (next.points.length < 2) {
    return base;
  }
  const index = base.findIndex((route) => route.activityId === next.activityId);
  if (index < 0) {
    return [...base, next];
  }
  if (base[index]!.points.length >= next.points.length) {
    return base;
  }
  const updated = [...base];
  updated[index] = next;
  return updated;
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE_FACTOR, Math.max(MIN_SCALE_FACTOR, scale));
}

function computeCamera(
  points: GlobePoint[],
  options?: { minHalfSpan?: number; maxScale?: number },
): GlobeCamera {
  if (points.length === 0) {
    return { rotation: [...DEFAULT_ROTATION], scaleFactor: 1 };
  }

  const minHalfSpan = options?.minHalfSpan ?? MIN_HALF_SPAN_RAD;
  const maxScale = options?.maxScale ?? MAX_SCALE_FACTOR;

  const route: Feature<MultiPoint> = {
    type: "Feature",
    properties: {},
    geometry: {
      type: "MultiPoint",
      coordinates: points.map((point) => [point.lon, point.lat]),
    },
  };
  const [longitude, latitude] = geoCentroid(route);
  const centroid: [number, number] = [longitude, latitude];

  let maxDist = 0;
  for (const point of points) {
    maxDist = Math.max(
      maxDist,
      geoDistance([point.lon, point.lat], centroid),
    );
  }

  const halfSpan = Math.min(
    Math.PI / 2.15,
    Math.max(maxDist * 1.7, minHalfSpan),
  );
  const scaleFactor = Math.min(
    maxScale,
    Math.max(1.12, 1 / Math.sin(halfSpan)),
  );

  return {
    rotation: [-longitude, -latitude, 0],
    scaleFactor: clampScale(scaleFactor),
  };
}

function findPeakBucket(buckets: GeoHeatBucket[]): GeoHeatBucket | null {
  if (buckets.length === 0) {
    return null;
  }

  let peak = buckets[0]!;
  for (const bucket of buckets) {
    if (bucket.count > peak.count) {
      peak = bucket;
    }
  }
  return peak;
}

function clusterAround(
  buckets: GeoHeatBucket[],
  center: GlobePoint,
  radiusRad: number,
): GeoHeatBucket[] {
  const nearby = buckets.filter(
    (bucket) =>
      geoDistance([bucket.lon, bucket.lat], [center.lon, center.lat]) <=
      radiusRad,
  );
  return nearby.length > 0 ? nearby : [{ ...center, count: 1 }];
}

function heavyClusterPoints(buckets: GeoHeatBucket[]): GlobePoint[] {
  const peak = findPeakBucket(buckets);
  if (!peak) {
    return [];
  }
  return clusterAround(buckets, peak, CLUSTER_RADIUS_RAD);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngleDeg(a: number, b: number, t: number): number {
  let delta = ((b - a + 540) % 360) - 180;
  return a + delta * t;
}

function interpolateCamera(
  from: GlobeCamera,
  to: GlobeCamera,
  t: number,
): GlobeCamera {
  const e = easeInOutCubic(t);
  return {
    rotation: [
      lerpAngleDeg(from.rotation[0], to.rotation[0], e),
      lerp(from.rotation[1], to.rotation[1], e),
      0,
    ],
    scaleFactor: lerp(from.scaleFactor, to.scaleFactor, e),
  };
}

interface GlobeProfile {
  label: string;
  unit: string;
  values: number[];
}

function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function downsampleValues(values: number[], target: number): number[] {
  if (values.length <= target) {
    return values;
  }

  const step = values.length / target;
  return Array.from(
    { length: target },
    (_, index) => values[Math.floor(index * step)]!,
  );
}

function extractProfile(
  detail: TrainingHubActivityDetail | null,
): GlobeProfile | null {
  const heartRate = (detail?.series ?? [])
    .map((point) => point.hr)
    .filter(isFiniteNumber)
    .filter((value) => value > 0);
  if (heartRate.length >= 8) {
    return {
      label: "Heart rate",
      unit: "bpm",
      values: downsampleValues(heartRate, 72),
    };
  }

  const elevation = (detail?.track?.points ?? [])
    .map((point) => point.elevation)
    .filter(isFiniteNumber);
  if (elevation.length >= 8) {
    return {
      label: "Elevation",
      unit: "m",
      values: downsampleValues(elevation, 72),
    };
  }

  return null;
}

export function ActivityGlobeCard({
  activities,
  connected,
  detail,
  loading,
  onOpenTraining,
}: ActivityGlobeCardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rotationRef = useRef<[number, number, number]>([...DEFAULT_ROTATION]);
  const scaleFactorRef = useRef(1);
  const drawRef = useRef<(() => void) | null>(null);
  const layoutRef = useRef<GlobeLayout | null>(null);
  const heatBucketsRef = useRef<GeoHeatBucket[]>([]);
  const hoverBucketRef = useRef<GeoHeatBucket | null>(null);
  const spinRateRef = useRef(IDLE_SPIN_DEG_PER_MS);
  const baselineCameraRef = useRef<GlobeCamera>({
    rotation: [...DEFAULT_ROTATION],
    scaleFactor: 1,
  });
  const cameraAnimRef = useRef<{
    from: GlobeCamera;
    to: GlobeCamera;
    start: number;
    duration: number;
  } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    rotation: [number, number, number];
    moved: boolean;
  } | null>(null);
  const hasFramedRef = useRef(false);
  const streetModeRef = useRef(false);
  const streetEnterTimerRef = useRef<number | null>(null);
  /** While true, pointer/wheel must not cancel the home-camera tween. */
  const cameraResetLockRef = useRef(false);

  const activitiesRef = useRef(activities);
  activitiesRef.current = activities;

  const activityKey = useMemo(
    () => activities.map((activity) => activity.activityId).join("|"),
    [activities],
  );

  const [visits, setVisits] = useState<ActivityVisitPoint[]>(() =>
    getCachedVisitPoints(activities),
  );
  const [routes, setRoutes] = useState<ActivityRoutePolyline[]>(() =>
    getCachedRoutePolylines(activities),
  );
  const [visitsLoading, setVisitsLoading] = useState(false);
  const [canResetView, setCanResetView] = useState(false);
  const [hoveringCluster, setHoveringCluster] = useState(false);
  const [streetFocus, setStreetFocus] = useState<StreetMapFocus | null>(null);
  const streetMode = streetFocus !== null;
  streetModeRef.current = streetMode;

  const routePoints = useMemo(() => {
    return samplePoints(extractTrackPoints(detail));
  }, [detail]);

  // Prefer cached visit routes + latest featured track for the street map.
  const streetRoutes = useMemo(() => {
    let merged = routes;
    if (detail?.activityId && routePoints.length >= 2) {
      merged = mergeRoutes(merged, {
        activityId: detail.activityId,
        points: routePoints,
      });
    }
    return merged;
  }, [routes, detail?.activityId, routePoints]);

  const heatBuckets = useMemo(
    () => bucketVisitsGeographically(visits),
    [visits],
  );
  heatBucketsRef.current = heatBuckets;

  const overall = useMemo(
    () => aggregateActivityStats(activities),
    [activities],
  );

  const syncResetAffordances = () => {
    if (streetModeRef.current) {
      setCanResetView(true);
      return;
    }
    const baseline = baselineCameraRef.current;
    const drilled =
      Math.abs(scaleFactorRef.current - baseline.scaleFactor) > 0.08 ||
      Math.abs(rotationRef.current[1] - baseline.rotation[1]) > 4;
    setCanResetView(drilled && heatBucketsRef.current.length > 0);
  };

  const snapCamera = (camera: GlobeCamera) => {
    rotationRef.current = [...camera.rotation];
    scaleFactorRef.current = clampScale(camera.scaleFactor);
  };

  const enterStreetFocus = (focus: StreetMapFocus) => {
    if (streetEnterTimerRef.current !== null) {
      window.clearTimeout(streetEnterTimerRef.current);
      streetEnterTimerRef.current = null;
    }
    // Finish any in-flight drill tween so exit starts from a known deep zoom.
    if (cameraAnimRef.current) {
      snapCamera(cameraAnimRef.current.to);
      cameraAnimRef.current = null;
    }
    cameraResetLockRef.current = false;
    setStreetFocus(focus);
    setCanResetView(true);
    setHoveringCluster(false);
    hoverBucketRef.current = null;
  };

  const scheduleStreetFocus = (focus: StreetMapFocus, delayMs: number) => {
    if (streetEnterTimerRef.current !== null) {
      window.clearTimeout(streetEnterTimerRef.current);
    }
    streetEnterTimerRef.current = window.setTimeout(() => {
      streetEnterTimerRef.current = null;
      enterStreetFocus(focus);
    }, delayMs);
  };

  const animateToCamera = (to: GlobeCamera, duration = CAMERA_EASE_MS) => {
    cameraAnimRef.current = {
      from: {
        rotation: [...rotationRef.current],
        scaleFactor: scaleFactorRef.current,
      },
      to: {
        rotation: [...to.rotation],
        scaleFactor: clampScale(to.scaleFactor),
      },
      start: performance.now(),
      duration,
    };
  };

  const restoreBaselineCamera = (duration = 900) => {
    if (streetEnterTimerRef.current !== null) {
      window.clearTimeout(streetEnterTimerRef.current);
      streetEnterTimerRef.current = null;
    }
    const baseline: GlobeCamera = {
      rotation: [...baselineCameraRef.current.rotation],
      scaleFactor: baselineCameraRef.current.scaleFactor,
    };
    // Drop any leftover street/drill tween, then ease back to the load frame.
    cameraAnimRef.current = null;
    cameraResetLockRef.current = true;
    animateToCamera(baseline, duration);
    setCanResetView(false);
  };

  const exitStreetMode = () => {
    if (streetEnterTimerRef.current !== null) {
      window.clearTimeout(streetEnterTimerRef.current);
      streetEnterTimerRef.current = null;
    }
    setStreetFocus(null);
    restoreBaselineCamera(900);
  };

  const globeCenterFocus = (): StreetMapFocus | null => {
    const layout = layoutRef.current;
    if (!layout) {
      const peak = findPeakBucket(heatBucketsRef.current);
      return peak ? { lat: peak.lat, lon: peak.lon } : null;
    }
    const projection = geoOrthographic()
      .translate([layout.sphereX, layout.sphereY])
      .scale(layout.sphereRadius * scaleFactorRef.current)
      .precision(0.35)
      .clipAngle(90)
      .rotate(rotationRef.current);
    const center = projection.invert?.([layout.sphereX, layout.sphereY]);
    if (!center) {
      return null;
    }
    return { lon: center[0], lat: center[1] };
  };

  // Seed / refresh latest activity geo into the visit + route caches.
  useEffect(() => {
    if (!detail?.activityId) {
      return;
    }

    const { centroid, route } = rememberActivityGeo(detail.activityId, detail);
    if (centroid) {
      setVisits((current) =>
        mergeVisits(current, {
          activityId: detail.activityId!,
          ...centroid,
        }),
      );
    }
    if (route && route.length >= 2) {
      setRoutes((current) =>
        mergeRoutes(current, {
          activityId: detail.activityId!,
          points: route,
        }),
      );
    }
  }, [detail]);

  // Background-load visit centroids + route polylines for recent activities.
  useEffect(() => {
    const api = window.corosLink;
    const list = activitiesRef.current;
    if (!api || !connected || list.length === 0) {
      setVisits(getCachedVisitPoints(list));
      setRoutes(getCachedRoutePolylines(list));
      return;
    }

    const controller = new AbortController();
    setVisits(getCachedVisitPoints(list));
    setRoutes(getCachedRoutePolylines(list));
    setVisitsLoading(true);

    void loadActivityVisitCentroids(
      list,
      (activityId, sportType, listActivity) =>
        api.getTrainingHubActivityDetail(activityId, sportType, listActivity),
      {
        signal: controller.signal,
        onVisit: (visit) => {
          if (controller.signal.aborted) {
            return;
          }
          setVisits((current) => mergeVisits(current, visit));
        },
        onRoute: (route) => {
          if (controller.signal.aborted) {
            return;
          }
          setRoutes((current) => mergeRoutes(current, route));
        },
      },
    ).finally(() => {
      if (!controller.signal.aborted) {
        setVisitsLoading(false);
      }
    });

    return () => {
      controller.abort();
    };
  }, [activityKey, connected]);

  useEffect(() => {
    if (heatBuckets.length === 0 && routePoints.length === 0) {
      hasFramedRef.current = false;
      scaleFactorRef.current = 1;
      baselineCameraRef.current = {
        rotation: [...DEFAULT_ROTATION],
        scaleFactor: 1,
      };
      setCanResetView(false);
      return;
    }

    // Frame once when first geo data arrives — ease into the densest cluster.
    if (!hasFramedRef.current) {
      const focusPoints =
        heatBuckets.length > 0
          ? heavyClusterPoints(heatBuckets)
          : routePoints;
      const camera = computeCamera(focusPoints, {
        minHalfSpan: MIN_HALF_SPAN_RAD,
        maxScale: 2.9,
      });
      baselineCameraRef.current = camera;
      hasFramedRef.current = true;
      animateToCamera(camera, 1100);
      setCanResetView(false);
    }
  }, [heatBuckets, routePoints]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    let width = 0;
    let height = 0;
    let animationFrame = 0;
    let previousTime = performance.now();
    let pulsePhase = 0;
    let pulseAccum = 0;
    const reducedMotionQuery = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );

    const draw = () => {
      if (width <= 0 || height <= 0) {
        return;
      }

      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const computedStyle = getComputedStyle(canvas);
      const paperTheme = document.documentElement.dataset.theme === "paper";
      const accent = computedStyle.getPropertyValue("--accent").trim();
      const accentStrong = computedStyle
        .getPropertyValue("--accent-strong")
        .trim();
      const gold = computedStyle.getPropertyValue("--accent-gold").trim();
      const sphereRadius = Math.min(width * 0.46, height * 0.44);
      const sphereX = width * 0.52;
      const sphereY = height * 0.5;
      const scaleFactor = scaleFactorRef.current;
      const projectionScale = sphereRadius * scaleFactor;
      layoutRef.current = { width, height, sphereX, sphereY, sphereRadius };

      const projection = geoOrthographic()
        .translate([sphereX, sphereY])
        .scale(projectionScale)
        .precision(0.35)
        .clipAngle(90)
        .rotate(rotationRef.current);

      context.save();
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, width, height);

      const halo = context.createRadialGradient(
        sphereX,
        sphereY,
        sphereRadius * 0.94,
        sphereX,
        sphereY,
        sphereRadius * 1.32,
      );
      halo.addColorStop(0, "rgba(172, 192, 212, 0)");
      halo.addColorStop(
        0.22,
        paperTheme
          ? "rgba(47, 190, 145, 0.1)"
          : "rgba(47, 190, 145, 0.07)",
      );
      halo.addColorStop(1, "rgba(172, 192, 212, 0)");
      context.beginPath();
      context.arc(sphereX, sphereY, sphereRadius * 1.32, 0, Math.PI * 2);
      context.fillStyle = halo;
      context.fill();

      const sphere = context.createRadialGradient(
        sphereX - sphereRadius * 0.1,
        sphereY - sphereRadius * 0.38,
        sphereRadius * 0.06,
        sphereX,
        sphereY - sphereRadius * 0.08,
        sphereRadius * 1.14,
      );
      if (paperTheme) {
        sphere.addColorStop(0, "rgba(255, 255, 255, 1)");
        sphere.addColorStop(0.45, "rgba(246, 247, 249, 1)");
        sphere.addColorStop(0.78, "rgba(226, 230, 235, 1)");
        sphere.addColorStop(1, "rgba(198, 204, 212, 1)");
      } else {
        sphere.addColorStop(0, "rgba(108, 117, 130, 1)");
        sphere.addColorStop(0.42, "rgba(48, 53, 62, 1)");
        sphere.addColorStop(0.74, "rgba(20, 22, 27, 1)");
        sphere.addColorStop(1, "rgba(6, 7, 9, 1)");
      }

      context.beginPath();
      context.arc(sphereX, sphereY, sphereRadius, 0, Math.PI * 2);
      context.fillStyle = sphere;
      context.fill();
      context.strokeStyle = paperTheme
        ? "rgba(100, 110, 122, 0.16)"
        : "rgba(255, 255, 255, 0.05)";
      context.lineWidth = 1;
      context.stroke();

      const center = (projection.invert?.([sphereX, sphereY]) ?? [0, 0]) as [
        number,
        number,
      ];

      // Clip so regional zoom stays a spherical disk.
      context.save();
      context.beginPath();
      context.arc(sphereX, sphereY, sphereRadius - 0.5, 0, Math.PI * 2);
      context.clip();

      const landDotStep = landDotStepForScale(scaleFactor);
      const landDots = getLandDots(landDotStep);
      // Radius tracks grid spacing so denser levels stay dotted, not solid fill.
      const baseDotRadius =
        sphereRadius * ((landDotStep * Math.PI) / 180) * 0.4;
      const minDotRadius = landDotStep <= DOT_STEP_NEAR_DEGREES ? 0.4 : 0.55;
      const litColor = paperTheme ? [255, 255, 255] : [242, 247, 252];
      const shadeColor = paperTheme ? [104, 115, 128] : [96, 106, 118];

      for (let i = 0; i < landDots.length; i += 2) {
        const coordinate: [number, number] = [
          landDots[i]!,
          landDots[i + 1]!,
        ];
        const distance = geoDistance(coordinate, center);
        if (distance >= Math.PI / 2) {
          continue;
        }

        const projected = projection(coordinate);
        if (!projected) {
          continue;
        }

        const [x, y] = projected;
        const dx = x - sphereX;
        const dy = y - sphereY;
        if (dx * dx + dy * dy > sphereRadius * sphereRadius) {
          continue;
        }

        const foreshorten = Math.cos(distance);
        const normalX = (x - sphereX) / sphereRadius;
        const normalY = (y - sphereY) / sphereRadius;
        const light = Math.max(
          0.1,
          Math.min(1, 0.66 - 0.46 * (normalX * 0.6 + normalY * 0.75)),
        );
        const sparkle = 0.82 + (0.18 * (((i * 2654435761) >>> 0) % 997)) / 997;
        const alpha =
          (0.32 + 0.68 * light) * (0.3 + 0.7 * foreshorten) * sparkle;
        const dotRadius = baseDotRadius * (0.45 + 0.55 * foreshorten);
        const red = Math.round(
          shadeColor[0]! + (litColor[0]! - shadeColor[0]!) * light,
        );
        const green = Math.round(
          shadeColor[1]! + (litColor[1]! - shadeColor[1]!) * light,
        );
        const blue = Math.round(
          shadeColor[2]! + (litColor[2]! - shadeColor[2]!) * light,
        );

        context.beginPath();
        context.arc(x, y, Math.max(minDotRadius, dotRadius), 0, Math.PI * 2);
        context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(3)})`;
        context.fill();
      }

      const buckets = heatBucketsRef.current;
      const maxVisitCount = Math.max(
        1,
        ...buckets.map((bucket) => bucket.count),
      );
      let peak: { x: number; y: number; intensity: number } | null = null;
      const hover = hoverBucketRef.current;
      const projectedBuckets: Array<{
        bucket: GeoHeatBucket;
        x: number;
        y: number;
        intensity: number;
        isHovered: boolean;
      }> = [];

      for (const bucket of buckets) {
        const coordinate: [number, number] = [bucket.lon, bucket.lat];
        if (geoDistance(coordinate, center) > Math.PI / 2) {
          continue;
        }

        const projected = projection(coordinate);
        if (!projected) {
          continue;
        }

        const [x, y] = projected;
        const dx = x - sphereX;
        const dy = y - sphereY;
        if (dx * dx + dy * dy > sphereRadius * sphereRadius) {
          continue;
        }

        const intensity = Math.sqrt(bucket.count / maxVisitCount);
        const isHovered =
          hover !== null &&
          hover.lat === bucket.lat &&
          hover.lon === bucket.lon;
        projectedBuckets.push({ bucket, x, y, intensity, isHovered });
        if (!peak || intensity > peak.intensity) {
          peak = { x, y, intensity };
        }
      }

      // Additive cyan/teal bloom — command-center heat look from the reference.
      context.save();
      context.globalCompositeOperation = "lighter";
      for (const entry of projectedBuckets) {
        const { x, y, intensity, isHovered } = entry;
        const radius =
          (14 + intensity * 28) * (isHovered ? 1.18 : 1) * (0.92 + 0.08 * scaleFactor);
        const heat = context.createRadialGradient(x, y, 0, x, y, radius);
        heat.addColorStop(0, "rgba(255, 244, 205, 0.95)");
        heat.addColorStop(0.18, gold);
        heat.addColorStop(0.42, accentStrong);
        heat.addColorStop(0.72, accent);
        heat.addColorStop(1, "rgba(47, 190, 145, 0)");
        context.globalAlpha = isHovered
          ? 0.4 + intensity * 0.45
          : 0.26 + intensity * 0.48;
        context.fillStyle = heat;
        context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }

      // Extra soft bloom on the densest cluster so one glow reads as the hero.
      if (peak) {
        const heroRadius = 22 + peak.intensity * 34;
        const hero = context.createRadialGradient(
          peak.x,
          peak.y,
          0,
          peak.x,
          peak.y,
          heroRadius,
        );
        hero.addColorStop(0, "rgba(79, 214, 166, 0.55)");
        hero.addColorStop(0.45, "rgba(47, 190, 145, 0.22)");
        hero.addColorStop(1, "rgba(47, 190, 145, 0)");
        context.globalAlpha = 0.55 + peak.intensity * 0.25;
        context.fillStyle = hero;
        context.fillRect(
          peak.x - heroRadius,
          peak.y - heroRadius,
          heroRadius * 2,
          heroRadius * 2,
        );
      }
      context.restore();

      for (const entry of projectedBuckets) {
        if (!entry.isHovered) {
          continue;
        }
        context.beginPath();
        context.arc(entry.x, entry.y, 7 + entry.intensity * 4, 0, Math.PI * 2);
        context.strokeStyle = gold;
        context.globalAlpha = 0.4;
        context.lineWidth = 1.2;
        context.stroke();
        context.globalAlpha = 1;
      }

      if (routePoints.length >= 2) {
        const pathPoints: Array<[number, number]> = [];
        for (const point of routePoints) {
          const coordinate: [number, number] = [point.lon, point.lat];
          if (geoDistance(coordinate, center) > Math.PI / 2) {
            if (pathPoints.length > 1) {
              drawRouteSegment(context, pathPoints, accentStrong);
            }
            pathPoints.length = 0;
            continue;
          }

          const projected = projection(coordinate);
          if (!projected) {
            if (pathPoints.length > 1) {
              drawRouteSegment(context, pathPoints, accentStrong);
            }
            pathPoints.length = 0;
            continue;
          }

          const [x, y] = projected;
          const dx = x - sphereX;
          const dy = y - sphereY;
          if (dx * dx + dy * dy > sphereRadius * sphereRadius) {
            if (pathPoints.length > 1) {
              drawRouteSegment(context, pathPoints, accentStrong);
            }
            pathPoints.length = 0;
            continue;
          }

          pathPoints.push([x, y]);
        }
        if (pathPoints.length > 1) {
          drawRouteSegment(context, pathPoints, accentStrong);
        }
      }

      if (peak) {
        const pulse = reducedMotionQuery.matches
          ? 1
          : 0.9 + 0.1 * Math.sin(pulsePhase);
        // Bright yellowish-white / gold center pin
        context.beginPath();
        context.arc(peak.x, peak.y, 5.8 * pulse, 0, Math.PI * 2);
        context.fillStyle = "rgba(255, 246, 210, 0.22)";
        context.fill();

        context.beginPath();
        context.arc(peak.x, peak.y, 2.4 * pulse, 0, Math.PI * 2);
        context.fillStyle = "#fff6d0";
        context.globalAlpha = 0.95;
        context.fill();

        context.beginPath();
        context.arc(peak.x, peak.y, 1.15 * pulse, 0, Math.PI * 2);
        context.fillStyle = gold;
        context.globalAlpha = 0.9;
        context.fill();
        context.globalAlpha = 1;
      }

      const limb = context.createRadialGradient(
        sphereX - sphereRadius * 0.18,
        sphereY - sphereRadius * 0.28,
        sphereRadius * 0.2,
        sphereX,
        sphereY,
        sphereRadius,
      );
      limb.addColorStop(0, "rgba(255, 255, 255, 0)");
      limb.addColorStop(
        0.62,
        paperTheme ? "rgba(80, 92, 106, 0)" : "rgba(0, 0, 0, 0)",
      );
      limb.addColorStop(
        1,
        paperTheme ? "rgba(70, 82, 96, 0.14)" : "rgba(0, 0, 0, 0.26)",
      );
      context.beginPath();
      context.arc(sphereX, sphereY, sphereRadius, 0, Math.PI * 2);
      context.fillStyle = limb;
      context.fill();

      context.restore();
      context.restore();
    };

    drawRef.current = draw;

    const resizeObserver = new ResizeObserver(([entry]) => {
      if (!entry) {
        return;
      }

      width = entry.contentRect.width;
      height = entry.contentRect.height;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * pixelRatio));
      canvas.height = Math.max(1, Math.floor(height * pixelRatio));
      draw();
    });
    resizeObserver.observe(canvas);

    const themeObserver = new MutationObserver(draw);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const animate = (time: number) => {
      const elapsed = Math.min(time - previousTime, 40);
      previousTime = time;
      const reduced = reducedMotionQuery.matches;
      const backgrounded = document.body.classList.contains("is-backgrounded");
      const dragging = Boolean(dragRef.current);
      const animating = Boolean(cameraAnimRef.current);

      // Ease idle spin rate: full when idle, near-zero while dragging/animating.
      const targetSpin =
        reduced ||
        backgrounded ||
        dragging ||
        animating ||
        streetModeRef.current
          ? 0
          : IDLE_SPIN_DEG_PER_MS;
      spinRateRef.current += (targetSpin - spinRateRef.current) * 0.08;

      if (cameraAnimRef.current) {
        const anim = cameraAnimRef.current;
        const t = Math.min(1, (time - anim.start) / anim.duration);
        const camera = interpolateCamera(anim.from, anim.to, t);
        rotationRef.current = camera.rotation;
        scaleFactorRef.current = camera.scaleFactor;
        if (t >= 1) {
          // Hard-snap so easing never leaves an intermediate street/drill scale.
          snapCamera(anim.to);
          cameraAnimRef.current = null;
          cameraResetLockRef.current = false;
          syncResetAffordances();
        }
        draw();
      } else if (spinRateRef.current > 0.00005) {
        rotationRef.current = [
          rotationRef.current[0] + elapsed * spinRateRef.current,
          rotationRef.current[1],
          0,
        ];
        draw();
      } else if (
        heatBucketsRef.current.length > 0 &&
        !reduced &&
        !backgrounded
      ) {
        pulsePhase += elapsed * 0.003;
        pulseAccum += elapsed;
        if (pulseAccum >= 66) {
          pulseAccum = 0;
          draw();
        }
      }

      animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);

    return () => {
      drawRef.current = null;
      resizeObserver.disconnect();
      themeObserver.disconnect();
      cancelAnimationFrame(animationFrame);
      if (streetEnterTimerRef.current !== null) {
        window.clearTimeout(streetEnterTimerRef.current);
        streetEnterTimerRef.current = null;
      }
    };
  }, [routePoints]);

  const projectBuckets = () => {
    const layout = layoutRef.current;
    if (!layout) {
      return [] as Array<{ bucket: GeoHeatBucket; x: number; y: number }>;
    }

    const { sphereX, sphereY, sphereRadius } = layout;
    const projection = geoOrthographic()
      .translate([sphereX, sphereY])
      .scale(sphereRadius * scaleFactorRef.current)
      .precision(0.35)
      .clipAngle(90)
      .rotate(rotationRef.current);
    const center = (projection.invert?.([sphereX, sphereY]) ?? [0, 0]) as [
      number,
      number,
    ];

    const projected: Array<{ bucket: GeoHeatBucket; x: number; y: number }> =
      [];
    for (const bucket of heatBucketsRef.current) {
      const coordinate: [number, number] = [bucket.lon, bucket.lat];
      if (geoDistance(coordinate, center) > Math.PI / 2) {
        continue;
      }
      const point = projection(coordinate);
      if (!point) {
        continue;
      }
      const [x, y] = point;
      const dx = x - sphereX;
      const dy = y - sphereY;
      if (dx * dx + dy * dy > sphereRadius * sphereRadius) {
        continue;
      }
      projected.push({ bucket, x, y });
    }
    return projected;
  };

  const hitTestCluster = (
    clientX: number,
    clientY: number,
  ): GeoHeatBucket | null => {
    const canvas = canvasRef.current;
    const layout = layoutRef.current;
    if (!canvas || !layout) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * layout.width;
    const y = ((clientY - rect.top) / rect.height) * layout.height;
    const projected = projectBuckets();
    let best: { bucket: GeoHeatBucket; dist: number } | null = null;
    for (const entry of projected) {
      const dx = entry.x - x;
      const dy = entry.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist <= HIT_PIXEL_RADIUS && (!best || dist < best.dist)) {
        best = { bucket: entry.bucket, dist };
      }
    }
    return best?.bucket ?? null;
  };

  const handlePointerDown = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    // Don't interrupt a locked home-camera reset (street → globe / Reset view).
    if (cameraResetLockRef.current) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    cameraAnimRef.current = null;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      rotation: [...rotationRef.current],
      moved: false,
    };
    event.currentTarget.classList.add("is-dragging");
  };

  const handlePointerMove = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    const drag = dragRef.current;
    if (drag && drag.pointerId === event.pointerId) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > DRAG_CLICK_SLOP_PX) {
        drag.moved = true;
      }
      rotationRef.current = [
        drag.rotation[0] + dx * 0.28,
        Math.max(-70, Math.min(70, drag.rotation[1] - dy * 0.24)),
        0,
      ];
      drawRef.current?.();
      return;
    }

    const hit = hitTestCluster(event.clientX, event.clientY);
    const prev = hoverBucketRef.current;
    const changed =
      (prev?.lat !== hit?.lat || prev?.lon !== hit?.lon) &&
      (prev !== null || hit !== null);
    hoverBucketRef.current = hit;
    if (changed) {
      setHoveringCluster(Boolean(hit));
      drawRef.current?.();
    }
  };

  const handlePointerUp = (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    event.currentTarget.classList.remove("is-dragging");

    if (!drag.moved) {
      const hit = hitTestCluster(event.clientX, event.clientY);
      if (hit) {
        const focus = clusterAround(
          heatBucketsRef.current,
          hit,
          DRILL_RADIUS_RAD,
        );
        const camera = computeCamera(focus, {
          minHalfSpan: DRILL_MIN_HALF_SPAN_RAD,
          maxScale: MAX_SCALE_FACTOR,
        });
        animateToCamera(camera, 620);
        // After a short camera ease, open the street heatmap at this cluster.
        scheduleStreetFocus({ lat: hit.lat, lon: hit.lon }, 580);
        setCanResetView(true);
        return;
      }
    }

    syncResetAffordances();
  };

  const handlePointerLeave = () => {
    if (hoverBucketRef.current) {
      hoverBucketRef.current = null;
      setHoveringCluster(false);
      drawRef.current?.();
    }
  };

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (streetMode) {
      return;
    }
    // Residual scroll from street-map zoom-out must not cancel the home tween.
    if (cameraResetLockRef.current) {
      return;
    }
    cameraAnimRef.current = null;
    const delta = event.deltaY;
    const zoomFactor = Math.exp(-delta * 0.00135);
    const nextScale = clampScale(scaleFactorRef.current * zoomFactor);

    if (
      delta < 0 &&
      nextScale >= STREET_ENTER_SCALE &&
      (heatBucketsRef.current.length > 0 || routePoints.length > 0)
    ) {
      const focus = globeCenterFocus() ?? findPeakBucket(heatBucketsRef.current);
      if (focus) {
        scaleFactorRef.current = nextScale;
        enterStreetFocus({ lat: focus.lat, lon: focus.lon });
        return;
      }
    }

    scaleFactorRef.current = nextScale;
    syncResetAffordances();
    drawRef.current?.();
  };

  const handleResetView = () => {
    if (streetFocus) {
      exitStreetMode();
      return;
    }
    restoreBaselineCamera(900);
  };

  const profile = useMemo(() => extractProfile(detail), [detail]);
  const profileChart = useMemo(() => {
    if (!profile) {
      return null;
    }

    const { values } = profile;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(max - min, 1e-6);
    const chartWidth = 240;
    const points = values.map((value, index) => {
      const x = (index / (values.length - 1)) * chartWidth;
      const y = 50 - ((value - min) / span) * 40;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    return {
      line: `M${points.join(" L")}`,
      area: `M0,56 L${points.join(" L")} L${chartWidth},56 Z`,
      range: `${Math.round(min)}–${Math.round(max)} ${profile.unit}`,
    };
  }, [profile]);

  const hasRoute = routePoints.length > 0;
  const hasVisits = visits.length > 0;
  const routeTrackCount = streetRoutes.length;
  const title = detail?.name ?? detail?.sportName ?? "Latest activity";
  const distance = formatOverallDistance(overall.totalDistanceMeters);
  const duration = formatOverallDuration(overall.totalDurationSeconds);
  const placeCount = heatBuckets.length;

  const statusLabel = loading
    ? "Loading your latest route"
    : visitsLoading && !hasVisits
      ? "Mapping where you’ve been"
      : hasVisits && routeTrackCount > 1
        ? `${placeCount.toLocaleString()} ${placeCount === 1 ? "place" : "places"} · ${routeTrackCount.toLocaleString()} GPS routes`
      : hasVisits && hasRoute
        ? `${placeCount.toLocaleString()} ${placeCount === 1 ? "place" : "places"} · ${routePoints.length.toLocaleString()} GPS on latest`
        : hasVisits
          ? `${visits.length.toLocaleString()} ${visits.length === 1 ? "visit" : "visits"} mapped`
          : hasRoute
            ? `${routePoints.length.toLocaleString()} mapped GPS samples`
            : connected
              ? "Outdoor GPS activities will map here"
              : "Connect Training Hub to add your routes";

  const metaParts = detail
    ? [
        detail.sportName,
        detail.startTime ? formatTrainingTimestamp(detail.startTime) : null,
      ].filter(Boolean)
    : [];

  const periodLabel =
    overall.count > 0
      ? `Last ${overall.count} ${overall.count === 1 ? "activity" : "activities"}`
      : connected
        ? "No recent activities yet"
        : "Training Hub offline";

  const hasOverall = overall.count > 0;

  return (
    <section className="activity-globe-card panel">
      <div className="activity-globe-panel">
        <header className="activity-globe-header">
          <div>
            <p className="eyebrow">Training</p>
            <h2>Where you’ve been</h2>
            <p className="activity-globe-period">{periodLabel}</p>
          </div>
        </header>

        {hasOverall ? (
          <>
            <dl className="activity-globe-heroes">
              <div
                className="activity-globe-hero"
                style={{ animationDelay: "40ms" }}
              >
                <dt>Distance</dt>
                <dd>
                  <span className="activity-globe-hero-value">
                    {distance.value}
                  </span>
                  <span className="activity-globe-hero-unit">
                    {distance.unit}
                  </span>
                </dd>
              </div>
              <div
                className="activity-globe-hero"
                style={{ animationDelay: "90ms" }}
              >
                <dt>Time</dt>
                <dd>
                  <span className="activity-globe-hero-value">
                    {duration.value}
                  </span>
                  <span className="activity-globe-hero-unit">
                    {duration.unit}
                  </span>
                </dd>
              </div>
              <div
                className="activity-globe-hero"
                style={{ animationDelay: "140ms" }}
              >
                <dt>Activities</dt>
                <dd>
                  <span className="activity-globe-hero-value">
                    {overall.count}
                  </span>
                </dd>
              </div>
            </dl>

            <div className="activity-globe-chips">
              {overall.totalElevationMeters > 0 ? (
                <span className="activity-globe-chip">
                  <strong>
                    {Math.round(overall.totalElevationMeters).toLocaleString()}
                  </strong>
                  m elev
                </span>
              ) : null}
              {overall.totalTrainingLoad > 0 ? (
                <span className="activity-globe-chip">
                  <strong>
                    {Math.round(overall.totalTrainingLoad).toLocaleString()}
                  </strong>
                  load
                </span>
              ) : null}
              {overall.totalCalories > 0 ? (
                <span className="activity-globe-chip">
                  <strong>
                    {Math.round(overall.totalCalories).toLocaleString()}
                  </strong>
                  kcal
                </span>
              ) : null}
              {placeCount > 0 ? (
                <span className="activity-globe-chip activity-globe-chip--accent">
                  <strong>{placeCount}</strong>
                  {placeCount === 1 ? "place" : "places"}
                </span>
              ) : null}
            </div>
          </>
        ) : (
          <p className="activity-globe-empty">
            {connected
              ? "Once activities sync, overall totals and visit density land here."
              : "Connect Training Hub to map your routes on the globe."}
          </p>
        )}

        {detail ? (
          <div className="activity-globe-featured">
            <div className="activity-globe-featured-head">
              <span className="activity-globe-featured-icon" aria-hidden="true">
                <Footprints size={16} />
              </span>
              <div className="activity-globe-featured-text">
                <strong>{title}</strong>
                <span>
                  {metaParts.length > 0
                    ? metaParts.join(" · ")
                    : "Latest GPS activity"}
                </span>
              </div>
            </div>
            {profile && profileChart ? (
              <div className="activity-globe-profile">
                <div className="activity-globe-profile-head">
                  <span>{profile.label}</span>
                  <span>{profileChart.range}</span>
                </div>
                <svg
                  viewBox="0 0 240 56"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient
                      id="activityGlobeProfileFill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="0%"
                        stopColor="var(--accent)"
                        stopOpacity="0.26"
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--accent)"
                        stopOpacity="0"
                      />
                    </linearGradient>
                  </defs>
                  <path
                    d={profileChart.area}
                    fill="url(#activityGlobeProfileFill)"
                  />
                  <path
                    d={profileChart.line}
                    fill="none"
                    stroke="var(--accent)"
                    strokeWidth="1.6"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="activity-globe-panel-footer">
          <div className="activity-globe-meta">
            <div className="activity-globe-status">
              <MapPin size={14} aria-hidden="true" />
              <span>{statusLabel}</span>
            </div>
            <div className="activity-globe-status">
              <LockKeyhole size={14} aria-hidden="true" />
              <span>Rendered locally on your device</span>
            </div>
          </div>
          <button
            type="button"
            className="activity-globe-action"
            onClick={onOpenTraining}
          >
            {connected ? "View training" : "Connect Training Hub"}
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        className={`activity-globe-stage${streetMode ? " is-street-mode" : ""}`}
        role="img"
        aria-label={
          streetMode
            ? `Street map heatmap centered near recent visits. Zoom out or reset to return to the globe.`
            : hasVisits
              ? `Interactive globe showing visit density across ${placeCount} places. Drag to rotate, scroll to zoom, click a cluster to open the street heatmap.`
              : hasRoute
                ? `Interactive globe showing the latest route for ${title}`
                : "Interactive globe waiting for GPS activity data"
        }
      >
        <canvas
          ref={canvasRef}
          className={`activity-globe-canvas${hoveringCluster ? " is-hovering-cluster" : ""}${streetMode ? " is-street-hidden" : ""}`}
          onPointerDown={streetMode ? undefined : handlePointerDown}
          onPointerMove={streetMode ? undefined : handlePointerMove}
          onPointerUp={streetMode ? undefined : handlePointerUp}
          onPointerCancel={streetMode ? undefined : handlePointerUp}
          onPointerLeave={streetMode ? undefined : handlePointerLeave}
          onWheel={streetMode ? undefined : handleWheel}
          aria-hidden="true"
        />

        {streetFocus ? (
          <ActivityGlobeStreetMap
            focus={streetFocus}
            visits={visits}
            routes={streetRoutes}
            onRequestExit={exitStreetMode}
          />
        ) : null}

        {canResetView ? (
          <button
            type="button"
            className="activity-globe-reset"
            onClick={handleResetView}
          >
            <RotateCcw size={13} aria-hidden="true" />
            {streetMode ? "Back to globe" : "Reset view"}
          </button>
        ) : null}

        {hasVisits || hasRoute ? (
          <div className="activity-globe-legend" aria-label="Visit density">
            <span>Low</span>
            <i aria-hidden="true" />
            <span>High</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function drawRouteSegment(
  context: CanvasRenderingContext2D,
  points: Array<[number, number]>,
  stroke: string,
): void {
  if (points.length < 2) {
    return;
  }

  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";

  context.beginPath();
  context.moveTo(points[0]![0], points[0]![1]);
  for (let i = 1; i < points.length; i += 1) {
    context.lineTo(points[i]![0], points[i]![1]);
  }
  context.strokeStyle = stroke;
  context.globalAlpha = 0.28;
  context.lineWidth = 2.6;
  context.stroke();

  context.beginPath();
  context.moveTo(points[0]![0], points[0]![1]);
  for (let i = 1; i < points.length; i += 1) {
    context.lineTo(points[i]![0], points[i]![1]);
  }
  context.strokeStyle = stroke;
  context.globalAlpha = 0.88;
  context.lineWidth = 1.25;
  context.stroke();
  context.restore();
}
