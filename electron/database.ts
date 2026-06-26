import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  LocalTrack,
  SpotifySyncTrack,
  SpotifySyncTrackStatus,
  YouTubeHistoryEntry,
  YouTubeHistoryEntryType
} from "./types";

interface DownloadRow {
  id: string;
  url: string;
  title: string;
  file_path: string;
  size_bytes: number;
  created_at: string;
  transferred_at: string | null;
}

interface SettingRow {
  key: string;
  value: string;
}

interface SpotifySyncTrackRow {
  playlist_id: string;
  spotify_track_id: string;
  artist_name: string;
  track_name: string;
  query: string;
  filename: string;
  status: SpotifySyncTrackStatus;
  local_download_id: string | null;
  file_path: string | null;
  error: string | null;
  updated_at: string;
}

interface YouTubeHistoryRow {
  url: string;
  title: string;
  entry_type: YouTubeHistoryEntryType;
  visits: number;
  last_visited_at: string;
  downloaded_at: string | null;
}

let db: Database.Database | undefined;

function migrateLegacyDatabase(userDataPath: string, dbPath: string): void {
  if (fs.existsSync(dbPath)) {
    return;
  }

  const legacyPath = path.join(userDataPath, "coros-desktop.sqlite");
  if (!fs.existsSync(legacyPath)) {
    return;
  }

  fs.renameSync(legacyPath, dbPath);

  for (const suffix of ["-wal", "-shm"]) {
    const legacySidecar = `${legacyPath}${suffix}`;
    const nextSidecar = `${dbPath}${suffix}`;
    if (fs.existsSync(legacySidecar)) {
      fs.renameSync(legacySidecar, nextSidecar);
    }
  }
}

export function initializeDatabase(userDataPath: string): Database.Database {
  if (db) {
    return db;
  }

  fs.mkdirSync(userDataPath, { recursive: true });
  const dbPath = path.join(userDataPath, "coroslink.sqlite");
  migrateLegacyDatabase(userDataPath, dbPath);
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS downloads (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL UNIQUE,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      transferred_at TEXT
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS spotify_sync_tracks (
      playlist_id TEXT NOT NULL,
      spotify_track_id TEXT NOT NULL,
      artist_name TEXT NOT NULL,
      track_name TEXT NOT NULL,
      query TEXT NOT NULL,
      filename TEXT NOT NULL,
      status TEXT NOT NULL,
      local_download_id TEXT,
      file_path TEXT,
      error TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (playlist_id, spotify_track_id)
    );

    CREATE TABLE IF NOT EXISTS youtube_history (
      url TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      entry_type TEXT NOT NULL,
      visits INTEGER NOT NULL DEFAULT 0,
      last_visited_at TEXT NOT NULL,
      downloaded_at TEXT
    );
  `);

  return db;
}

function requireDatabase(): Database.Database {
  if (!db) {
    throw new Error("Database has not been initialized.");
  }

  return db;
}

function toLocalTrack(row: DownloadRow): LocalTrack {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    filePath: row.file_path,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    transferredAt: row.transferred_at ?? undefined
  };
}

export function listDownloads(): LocalTrack[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT id, url, title, file_path, size_bytes, created_at, transferred_at
       FROM downloads
       ORDER BY created_at DESC`
    )
    .all() as DownloadRow[];

  return rows.map(toLocalTrack);
}

export function getDownloadById(id: string): LocalTrack | undefined {
  const row = requireDatabase()
    .prepare(
      `SELECT id, url, title, file_path, size_bytes, created_at, transferred_at
       FROM downloads
       WHERE id = ?`
    )
    .get(id) as DownloadRow | undefined;

  return row ? toLocalTrack(row) : undefined;
}

export function addDownloads(filePaths: string[], url: string): LocalTrack[] {
  const database = requireDatabase();
  const now = new Date().toISOString();
  const insert = database.prepare(`
    INSERT OR IGNORE INTO downloads
      (id, url, title, file_path, size_bytes, created_at)
    VALUES
      (@id, @url, @title, @filePath, @sizeBytes, @createdAt)
  `);

  const transaction = database.transaction((paths: string[]) => {
    for (const filePath of paths) {
      const stats = fs.statSync(filePath);
      insert.run({
        id: crypto.randomUUID(),
        url,
        title: path.basename(filePath, path.extname(filePath)),
        filePath,
        sizeBytes: stats.size,
        createdAt: now
      });
    }
  });

  transaction(filePaths);

  const select = database.prepare(
    `SELECT id, url, title, file_path, size_bytes, created_at, transferred_at
     FROM downloads
     WHERE file_path = ?`
  );

  return filePaths
    .map((filePath) => select.get(filePath) as DownloadRow | undefined)
    .filter((row): row is DownloadRow => Boolean(row))
    .map(toLocalTrack);
}

export function markDownloadTransferred(id: string): void {
  requireDatabase()
    .prepare("UPDATE downloads SET transferred_at = ? WHERE id = ?")
    .run(new Date().toISOString(), id);
}

export function deleteDownload(id: string, removeFile: boolean): void {
  const existing = getDownloadById(id);
  if (!existing) {
    return;
  }

  if (removeFile && fs.existsSync(existing.filePath)) {
    fs.rmSync(existing.filePath, { force: true });
  }

  requireDatabase().prepare("DELETE FROM downloads WHERE id = ?").run(id);
}

export function getSetting(key: string): string | undefined {
  const row = requireDatabase()
    .prepare("SELECT key, value FROM app_settings WHERE key = ?")
    .get(key) as SettingRow | undefined;

  return row?.value;
}

export function setSetting(key: string, value: string): void {
  requireDatabase()
    .prepare(
      `INSERT INTO app_settings (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

export function deleteSettings(keys: string[]): void {
  const database = requireDatabase();
  const remove = database.prepare("DELETE FROM app_settings WHERE key = ?");
  const transaction = database.transaction((settingKeys: string[]) => {
    for (const key of settingKeys) {
      remove.run(key);
    }
  });

  transaction(keys);
}

function toSpotifySyncTrack(row: SpotifySyncTrackRow): SpotifySyncTrack {
  return {
    playlistId: row.playlist_id,
    spotifyTrackId: row.spotify_track_id,
    artistName: row.artist_name,
    trackName: row.track_name,
    query: row.query,
    filename: row.filename,
    status: row.status,
    localDownloadId: row.local_download_id ?? undefined,
    filePath: row.file_path ?? undefined,
    error: row.error ?? undefined,
    updatedAt: row.updated_at
  };
}

export function listSpotifySyncTracks(playlistId: string): SpotifySyncTrack[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT playlist_id, spotify_track_id, artist_name, track_name, query,
              filename, status, local_download_id, file_path, error, updated_at
       FROM spotify_sync_tracks
       WHERE playlist_id = ?
       ORDER BY artist_name, track_name`
    )
    .all(playlistId) as SpotifySyncTrackRow[];

  return rows.map(toSpotifySyncTrack);
}

export function getSpotifySyncTrack(
  playlistId: string,
  spotifyTrackId: string
): SpotifySyncTrack | undefined {
  const row = requireDatabase()
    .prepare(
      `SELECT playlist_id, spotify_track_id, artist_name, track_name, query,
              filename, status, local_download_id, file_path, error, updated_at
       FROM spotify_sync_tracks
       WHERE playlist_id = ? AND spotify_track_id = ?`
    )
    .get(playlistId, spotifyTrackId) as SpotifySyncTrackRow | undefined;

  return row ? toSpotifySyncTrack(row) : undefined;
}

export function upsertSpotifySyncTrack(
  track: Omit<SpotifySyncTrack, "updatedAt"> & { updatedAt?: string }
): SpotifySyncTrack {
  const updatedAt = track.updatedAt ?? new Date().toISOString();
  requireDatabase()
    .prepare(
      `INSERT INTO spotify_sync_tracks (
         playlist_id, spotify_track_id, artist_name, track_name, query,
         filename, status, local_download_id, file_path, error, updated_at
       )
       VALUES (
         @playlistId, @spotifyTrackId, @artistName, @trackName, @query,
         @filename, @status, @localDownloadId, @filePath, @error, @updatedAt
       )
       ON CONFLICT(playlist_id, spotify_track_id) DO UPDATE SET
         artist_name = excluded.artist_name,
         track_name = excluded.track_name,
         query = excluded.query,
         filename = excluded.filename,
         status = excluded.status,
         local_download_id = excluded.local_download_id,
         file_path = excluded.file_path,
         error = excluded.error,
         updated_at = excluded.updated_at`
    )
    .run({
      playlistId: track.playlistId,
      spotifyTrackId: track.spotifyTrackId,
      artistName: track.artistName,
      trackName: track.trackName,
      query: track.query,
      filename: track.filename,
      status: track.status,
      localDownloadId: track.localDownloadId ?? null,
      filePath: track.filePath ?? null,
      error: track.error ?? null,
      updatedAt
    });

  return {
    ...track,
    updatedAt
  };
}

function toYouTubeHistoryEntry(row: YouTubeHistoryRow): YouTubeHistoryEntry {
  return {
    url: row.url,
    title: row.title,
    entryType: row.entry_type,
    visits: row.visits,
    lastVisitedAt: row.last_visited_at,
    downloadedAt: row.downloaded_at ?? undefined
  };
}

export function listYouTubeHistory(limit = 50): YouTubeHistoryEntry[] {
  const rows = requireDatabase()
    .prepare(
      `SELECT url, title, entry_type, visits, last_visited_at, downloaded_at
       FROM youtube_history
       ORDER BY COALESCE(downloaded_at, last_visited_at) DESC
       LIMIT ?`
    )
    .all(limit) as YouTubeHistoryRow[];

  return rows.map(toYouTubeHistoryEntry);
}

export function recordYouTubeVisit(entry: {
  url: string;
  title: string;
  entryType: YouTubeHistoryEntryType;
}): YouTubeHistoryEntry {
  const now = new Date().toISOString();
  requireDatabase()
    .prepare(
      `INSERT INTO youtube_history
        (url, title, entry_type, visits, last_visited_at)
       VALUES
        (@url, @title, @entryType, 1, @now)
       ON CONFLICT(url) DO UPDATE SET
        title = CASE
          WHEN excluded.title != '' THEN excluded.title
          ELSE youtube_history.title
        END,
        entry_type = excluded.entry_type,
        visits = youtube_history.visits + 1,
        last_visited_at = excluded.last_visited_at`
    )
    .run({
      url: entry.url,
      title: entry.title,
      entryType: entry.entryType,
      now
    });

  return getYouTubeHistoryEntry(entry.url);
}

export function markYouTubeDownloaded(entry: {
  url: string;
  title: string;
  entryType: YouTubeHistoryEntryType;
}): YouTubeHistoryEntry {
  const now = new Date().toISOString();
  requireDatabase()
    .prepare(
      `INSERT INTO youtube_history
        (url, title, entry_type, visits, last_visited_at, downloaded_at)
       VALUES
        (@url, @title, @entryType, 1, @now, @now)
       ON CONFLICT(url) DO UPDATE SET
        title = CASE
          WHEN excluded.title != '' THEN excluded.title
          ELSE youtube_history.title
        END,
        entry_type = excluded.entry_type,
        downloaded_at = excluded.downloaded_at,
        last_visited_at = excluded.last_visited_at`
    )
    .run({
      url: entry.url,
      title: entry.title,
      entryType: entry.entryType,
      now
    });

  return getYouTubeHistoryEntry(entry.url);
}

function getYouTubeHistoryEntry(url: string): YouTubeHistoryEntry {
  const row = requireDatabase()
    .prepare(
      `SELECT url, title, entry_type, visits, last_visited_at, downloaded_at
       FROM youtube_history
       WHERE url = ?`
    )
    .get(url) as YouTubeHistoryRow | undefined;

  if (!row) {
    throw new Error("YouTube history entry was not found.");
  }

  return toYouTubeHistoryEntry(row);
}
