export type WatchModelId = "pace-pro" | "pace-4";

export const PACE_PRO_BYTES = 32 * 1024 * 1024 * 1024;
export const PACE_4_BYTES = 4 * 1024 * 1024 * 1024;

const PACE_4_STORAGE_THRESHOLD = 6 * 1024 * 1024 * 1024;
const PACE_PRO_STORAGE_THRESHOLD = 16 * 1024 * 1024 * 1024;

export function resolveWatchModel(
  name?: string,
  totalBytes?: number
): WatchModelId | undefined {
  const normalized = (name ?? "").trim().toUpperCase();

  if (/PACE\s*PRO/.test(normalized)) {
    return "pace-pro";
  }

  if (/PACE\s*4/.test(normalized)) {
    return "pace-4";
  }

  if (totalBytes !== undefined) {
    if (totalBytes <= PACE_4_STORAGE_THRESHOLD) {
      return "pace-4";
    }

    if (totalBytes >= PACE_PRO_STORAGE_THRESHOLD) {
      return "pace-pro";
    }
  }

  if (/(COROS|PACE|APEX|VERTIX)/.test(normalized)) {
    return "pace-pro";
  }

  return undefined;
}

export function fallbackBytesForModel(model?: WatchModelId): number {
  return model === "pace-4" ? PACE_4_BYTES : PACE_PRO_BYTES;
}
