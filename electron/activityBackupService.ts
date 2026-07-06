import fs from "node:fs";
import path from "node:path";
import {
  fetchTrainingHubActivityFile,
  getTrainingHubExportFormat,
  listTrainingHubActivities
} from "./trainingHubService";
import type {
  ActivityBackupProgress,
  TrainingHubActivity,
  TrainingHubActivityFileType
} from "./types";

// Activities are fetched in pages of this size until a short page signals the end.
const BACKUP_PAGE_SIZE = 100;
// Hard stop so a misbehaving API can never loop forever (~50k activities).
const BACKUP_MAX_PAGES = 500;
// Pause between downloads so a full-history backup stays polite to COROS.
const BACKUP_DOWNLOAD_DELAY_MS = 250;

let currentProgress: ActivityBackupProgress | null = null;
let running = false;
let cancelRequested = false;
let progressListener: ((progress: ActivityBackupProgress) => void) | null =
  null;

export function setActivityBackupProgressListener(
  listener: ((progress: ActivityBackupProgress) => void) | null
): void {
  progressListener = listener;
}

export function getActivityBackupProgress(): ActivityBackupProgress | null {
  return currentProgress;
}

export function cancelActivityBackup(): ActivityBackupProgress | null {
  if (running) {
    cancelRequested = true;
  }
  return currentProgress;
}

function emitProgress(update: Partial<ActivityBackupProgress>): void {
  if (!currentProgress) {
    return;
  }
  currentProgress = { ...currentProgress, ...update };
  progressListener?.(currentProgress);
}

/** Mirrors main.ts's export sanitizer so backup names match single exports. */
function sanitizeBackupName(name?: string): string {
  if (!name) {
    return "";
  }
  return name
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** COROS timestamps are seconds in list payloads but tolerate milliseconds. */
function activityDatePrefix(startTime?: number): string {
  if (!startTime || !Number.isFinite(startTime) || startTime <= 0) {
    return "unknown-date";
  }
  const ms = startTime < 10_000_000_000 ? startTime * 1000 : startTime;
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function backupFileName(
  activity: TrainingHubActivity,
  extension: string
): string {
  const base = sanitizeBackupName(activity.name) || "activity";
  return `${activityDatePrefix(activity.startTime)}_${base}_${activity.activityId}.${extension}`;
}

async function listAllActivities(): Promise<TrainingHubActivity[]> {
  const all: TrainingHubActivity[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= BACKUP_MAX_PAGES; page += 1) {
    const activities = await listTrainingHubActivities(page, BACKUP_PAGE_SIZE);
    let addedAny = false;
    for (const activity of activities) {
      if (!activity.activityId || seen.has(activity.activityId)) {
        continue;
      }
      seen.add(activity.activityId);
      all.push(activity);
      addedAny = true;
    }
    // A short or fully-duplicated page means the account has no more history.
    if (activities.length < BACKUP_PAGE_SIZE || !addedAny) {
      break;
    }
    if (cancelRequested) {
      break;
    }
  }

  return all;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Downloads every activity on the account into `folder`, one file per
 * activity, skipping files that already exist (so re-running is an
 * incremental backup). Progress streams through the registered listener and
 * the final state is also returned.
 */
export async function startActivityBackup(
  folder: string,
  fileType: TrainingHubActivityFileType = 4
): Promise<ActivityBackupProgress> {
  if (running && currentProgress) {
    return currentProgress;
  }

  const format = getTrainingHubExportFormat(fileType);
  await fs.promises.mkdir(folder, { recursive: true });

  running = true;
  cancelRequested = false;
  currentProgress = {
    state: "listing",
    folder,
    fileType,
    formatLabel: format.label,
    total: 0,
    completed: 0,
    skipped: 0,
    failed: 0
  };
  progressListener?.(currentProgress);

  try {
    const activities = await listAllActivities();
    emitProgress({ total: activities.length, state: "downloading" });

    for (const activity of activities) {
      if (cancelRequested) {
        break;
      }

      const fileName = backupFileName(activity, format.extension);
      const filePath = path.join(folder, fileName);

      if (fs.existsSync(filePath)) {
        emitProgress({
          skipped: (currentProgress?.skipped ?? 0) + 1,
          currentName: activity.name
        });
        continue;
      }

      emitProgress({ currentName: activity.name || fileName });

      try {
        const { content } = await fetchTrainingHubActivityFile(
          activity.activityId,
          activity.sportType,
          fileType
        );
        await fs.promises.writeFile(filePath, content);
        emitProgress({ completed: (currentProgress?.completed ?? 0) + 1 });
      } catch {
        emitProgress({ failed: (currentProgress?.failed ?? 0) + 1 });
      }

      await delay(BACKUP_DOWNLOAD_DELAY_MS);
    }

    emitProgress({
      state: cancelRequested ? "cancelled" : "done",
      currentName: undefined
    });
  } catch (caught) {
    emitProgress({
      state: "error",
      currentName: undefined,
      error:
        caught instanceof Error
          ? caught.message
          : "Activity backup failed unexpectedly."
    });
  } finally {
    running = false;
    cancelRequested = false;
  }

  return currentProgress as ActivityBackupProgress;
}
