import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { DriveCandidate, WatchStatus, WatchTrack } from "./types";
import { fallbackBytesForModel, resolveWatchModel } from "./watchModels";

const execFileAsync = promisify(execFile);
const COROS_NAME_PATTERN = /(coros|pace|apex|vertix)/i;

interface RawVolume {
  name: string;
  rootPath: string;
}

interface StorageStats {
  totalBytes?: number;
  freeBytes?: number;
  usedBytes?: number;
}

export async function getWatchStatus(): Promise<WatchStatus> {
  try {
    const candidates = await findDriveCandidates();
    const selected =
      candidates.find((candidate) => candidate.musicPath) ?? candidates[0];

    if (!selected) {
      return {
        connected: false,
        checkedAt: new Date().toISOString(),
        tracks: [],
        candidates: []
      };
    }

    const musicPath =
      selected.musicPath ?? path.join(selected.rootPath, "Music");
    const tracks = fs.existsSync(musicPath) ? listWatchTracks(musicPath) : [];

    const model =
      resolveWatchModel(selected.name, selected.totalBytes) ?? "pace-pro";

    return {
      connected: true,
      checkedAt: new Date().toISOString(),
      name: selected.name,
      model,
      rootPath: selected.rootPath,
      musicPath,
      totalBytes: selected.totalBytes,
      freeBytes: selected.freeBytes,
      usedBytes: selected.usedBytes,
      tracks,
      candidates
    };
  } catch (error) {
    return {
      connected: false,
      checkedAt: new Date().toISOString(),
      tracks: [],
      candidates: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function deleteWatchTrack(relativePath: string): Promise<void> {
  const status = await getWatchStatus();
  if (!status.connected || !status.musicPath) {
    throw new Error("No COROS watch is connected.");
  }

  const targetPath = safeResolveInside(status.musicPath, relativePath);
  if (!targetPath.toLowerCase().endsWith(".mp3")) {
    throw new Error("Only MP3 files can be deleted from the watch.");
  }

  fs.rmSync(targetPath, { force: true });
}

export async function transferFileToWatch(filePath: string): Promise<WatchTrack> {
  if (!filePath.toLowerCase().endsWith(".mp3")) {
    throw new Error("COROS watches only support MP3 files.");
  }

  if (!fs.existsSync(filePath)) {
    throw new Error("Local MP3 file no longer exists.");
  }

  const status = await getWatchStatus();
  if (!status.connected || !status.musicPath) {
    throw new Error("No COROS watch is connected.");
  }

  fs.mkdirSync(status.musicPath, { recursive: true });

  const destination = nextAvailablePath(
    status.musicPath,
    sanitizeFileName(path.basename(filePath))
  );
  fs.copyFileSync(filePath, destination);

  const stats = fs.statSync(destination);
  return {
    name: path.basename(destination),
    relativePath: path.relative(status.musicPath, destination),
    absolutePath: destination,
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString()
  };
}

async function findDriveCandidates(): Promise<DriveCandidate[]> {
  const volumes = await listVolumes();
  const candidates: DriveCandidate[] = [];

  for (const volume of volumes) {
    const musicPath = path.join(volume.rootPath, "Music");
    const hasMusicFolder = isDirectory(musicPath);
    const nameMatches = COROS_NAME_PATTERN.test(volume.name);

    if (!hasMusicFolder && !nameMatches) {
      continue;
    }

    const storage = getStorageStats(volume.rootPath, volume.name);
    candidates.push({
      name: volume.name,
      rootPath: volume.rootPath,
      musicPath: hasMusicFolder ? musicPath : undefined,
      ...storage,
      reason: hasMusicFolder
        ? "Music folder found"
        : "Volume name matches COROS watch family"
    });
  }

  return candidates.sort((left, right) => {
    if (left.musicPath && !right.musicPath) return -1;
    if (!left.musicPath && right.musicPath) return 1;
    return left.name.localeCompare(right.name);
  });
}

async function listVolumes(): Promise<RawVolume[]> {
  const explicitWatchPath = process.env.COROS_WATCH_PATH;
  if (explicitWatchPath) {
    return [
      {
        name: path.basename(explicitWatchPath) || "COROS Watch",
        rootPath: explicitWatchPath
      }
    ];
  }

  if (process.platform === "darwin") {
    return listMacVolumes();
  }

  if (process.platform === "win32") {
    return listWindowsVolumes();
  }

  return listLinuxVolumes();
}

function listMacVolumes(): RawVolume[] {
  const base = "/Volumes";
  if (!isDirectory(base)) {
    return [];
  }

  return fs
    .readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => ({
      name: entry.name,
      rootPath: path.join(base, entry.name)
    }));
}

async function listWindowsVolumes(): Promise<RawVolume[]> {
  const command = [
    "Get-CimInstance Win32_LogicalDisk",
    "| Where-Object { $_.DriveType -in 2,3 }",
    "| Select-Object DeviceID,VolumeName",
    "| ConvertTo-Json -Compress"
  ].join(" ");

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-Command", command],
    { windowsHide: true }
  );

  if (!stdout.trim()) {
    return [];
  }

  const parsed = JSON.parse(stdout.trim()) as
    | { DeviceID: string; VolumeName?: string }[]
    | { DeviceID: string; VolumeName?: string };
  const rows = Array.isArray(parsed) ? parsed : [parsed];

  return rows.map((row) => ({
    name: row.VolumeName || row.DeviceID,
    rootPath: `${row.DeviceID}\\`
  }));
}

function listLinuxVolumes(): RawVolume[] {
  const user = os.userInfo().username;
  const bases = [`/media/${user}`, `/run/media/${user}`, "/mnt"];

  return bases.flatMap((base) => {
    if (!isDirectory(base)) {
      return [];
    }

    return fs
      .readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => ({
        name: entry.name,
        rootPath: path.join(base, entry.name)
      }));
  });
}

function listWatchTracks(musicPath: string): WatchTrack[] {
  const tracks: WatchTrack[] = [];

  function walk(currentPath: string): void {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }

      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".mp3")) {
        continue;
      }

      const stats = fs.statSync(absolutePath);
      tracks.push({
        name: entry.name,
        relativePath: path.relative(musicPath, absolutePath),
        absolutePath,
        sizeBytes: stats.size,
        modifiedAt: stats.mtime.toISOString()
      });
    }
  }

  walk(musicPath);
  return tracks.sort((left, right) => left.name.localeCompare(right.name));
}

function getStorageStats(rootPath: string, volumeName: string): StorageStats {
  try {
    const stats = fs.statfsSync(rootPath);
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    return {
      totalBytes,
      freeBytes,
      usedBytes: totalBytes - freeBytes
    };
  } catch {
    const model = resolveWatchModel(volumeName);
    return {
      totalBytes: fallbackBytesForModel(model)
    };
  }
}

function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function safeResolveInside(basePath: string, relativePath: string): string {
  const resolved = path.resolve(basePath, relativePath);
  const normalizedBase = path.resolve(basePath) + path.sep;
  if (!resolved.startsWith(normalizedBase)) {
    throw new Error("Track path is outside the watch Music folder.");
  }

  return resolved;
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim();
}

function nextAvailablePath(directory: string, fileName: string): string {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  let candidate = path.join(directory, fileName);
  let index = 1;

  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${baseName} (${index})${extension}`);
    index += 1;
  }

  return candidate;
}
