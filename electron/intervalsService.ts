import fs from "node:fs";
import { safeStorage } from "electron";
import { deleteSettings, getSetting, setSetting } from "./database";
import type { IntervalsActivity, IntervalsStatus } from "./types";

const BASE_URL = "https://intervals.icu/api/v1";
const SETTINGS = {
  apiKey: "intervals.apiKey",
  athleteId: "intervals.athleteId"
};

function storeSecret(key: string, value: string): void {
  const payload = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(value).toString("base64")
    : value;
  setSetting(key, payload);
}

function readSecret(key: string): string | undefined {
  const raw = getSetting(key);
  if (!raw) return undefined;
  if (!safeStorage.isEncryptionAvailable()) return raw;
  try {
    return safeStorage.decryptString(Buffer.from(raw, "base64"));
  } catch {
    return raw;
  }
}

function authHeader(apiKey: string): string {
  return "Basic " + Buffer.from(`API_KEY:${apiKey}`).toString("base64");
}

function requireAuth(): { apiKey: string; athleteId: string } {
  const apiKey = readSecret(SETTINGS.apiKey);
  const athleteId = getSetting(SETTINGS.athleteId);
  if (!apiKey || !athleteId) {
    throw new Error("Not connected to intervals.icu.");
  }
  return { apiKey, athleteId };
}

export function getIntervalsStatus(): IntervalsStatus {
  const apiKey = readSecret(SETTINGS.apiKey);
  const athleteId = getSetting(SETTINGS.athleteId);
  return apiKey && athleteId
    ? { connected: true, athleteId }
    : { connected: false };
}

export async function connectIntervals(
  apiKey: string,
  athleteId: string
): Promise<IntervalsStatus> {
  const id = athleteId.trim();
  // Validate the key by hitting the athlete endpoint.
  const resp = await fetch(`${BASE_URL}/athlete/${id}`, {
    headers: { Authorization: authHeader(apiKey.trim()) }
  });
  if (resp.status === 401 || resp.status === 403) {
    throw new Error("Invalid intervals.icu API key.");
  }
  if (!resp.ok) {
    throw new Error(`intervals.icu error: ${resp.status}`);
  }
  storeSecret(SETTINGS.apiKey, apiKey.trim());
  setSetting(SETTINGS.athleteId, id);
  return { connected: true, athleteId: id };
}

export function disconnectIntervals(): void {
  deleteSettings([SETTINGS.apiKey, SETTINGS.athleteId]);
}

function fileExtOf(raw: any): IntervalsActivity["fileExt"] {
  const t = String(raw?.source_file?.type ?? raw?.source ?? "").toLowerCase();
  if (t.includes("fit")) return "fit";
  if (t.includes("tcx")) return "tcx";
  return "unknown";
}

export function parseIntervalsActivities(raw: any[]): IntervalsActivity[] {
  return raw.map((a) => {
    const start = a.start_date ?? a.startDate ?? a.start_date_local ?? "";
    return {
      intervalsId: String(a.id),
      name: a.name ?? "Unnamed",
      startEpochMs: start ? Date.parse(start) : 0,
      movingSec: Number(a.moving_time ?? a.movingTime ?? a.elapsed_time ?? 0),
      distanceM: Number(a.distance ?? 0),
      type: String(a.type ?? ""),
      fileExt: fileExtOf(a)
    };
  });
}

export async function listIntervalsActivities(
  daysBack: number
): Promise<IntervalsActivity[]> {
  const { apiKey, athleteId } = requireAuth();
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - daysBack * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const url = `${BASE_URL}/athlete/${athleteId}/activities?oldest=${from}&newest=${to}`;
  const resp = await fetch(url, {
    headers: { Authorization: authHeader(apiKey) }
  });
  if (!resp.ok) {
    throw new Error(`intervals.icu fetch failed: ${resp.status}`);
  }
  return parseIntervalsActivities((await resp.json()) as any[]);
}

export async function downloadIntervalsFit(
  intervalsId: string,
  destPath: string
): Promise<string> {
  const { apiKey } = requireAuth();
  const resp = await fetch(`${BASE_URL}/activity/${intervalsId}/file`, {
    headers: { Authorization: authHeader(apiKey) }
  });
  if (!resp.ok) {
    throw new Error(
      `FIT download failed (${resp.status}) for activity ${intervalsId}`
    );
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  fs.writeFileSync(destPath, buf);
  return destPath;
}
