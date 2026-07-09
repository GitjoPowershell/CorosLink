export interface MatchableActivity {
  startEpochMs: number;
  movingSec: number;
  distanceM: number;
}

export const START_TOLERANCE_MS = 180_000; // ±3 minutes
export const DURATION_TOLERANCE = 0.05; // ±5%
export const DISTANCE_TOLERANCE = 0.05; // ±5%

function within(a: number, b: number, ratio: number): boolean {
  if (a === 0 && b === 0) return true;
  const larger = Math.max(Math.abs(a), Math.abs(b));
  if (larger === 0) return true;
  return Math.abs(a - b) / larger <= ratio;
}

export function isAlreadyOnCoros(
  intervals: MatchableActivity,
  corosList: MatchableActivity[]
): boolean {
  return corosList.some((c) => {
    if (Math.abs(intervals.startEpochMs - c.startEpochMs) > START_TOLERANCE_MS) {
      return false;
    }
    if (!within(intervals.movingSec, c.movingSec, DURATION_TOLERANCE)) {
      return false;
    }
    if (intervals.distanceM > 0 && c.distanceM > 0) {
      return within(intervals.distanceM, c.distanceM, DISTANCE_TOLERANCE);
    }
    return true;
  });
}
