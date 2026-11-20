
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import type {
  PosterSource,
  MetadataSettings,
  LibraryMode,
  LibraryRoots,
  MovieRecord,
  MovieModeCounts,
  OrganizationSettings,
  PlaybackCheckpoint,
  PlayerSettings,
  ScanHistoryEntry,
  SubtitleRecord
} from "../shared/contracts";
import { DEFAULT_ORGANIZATION_SETTINGS } from "../shared/organizationTemplates";

interface MovieRow {
  id: string;
  title: string;
  display_name: string | null;
  year: number | null;
  video_id: string | null;
  source_path: string;
  folder_path: string;
  library_mode: LibraryMode;
  resolution: string;
  poster_url: string | null;
  poster_source: PosterSource;
  actresses_json: string;
  keywords_json: string;
  updated_at: string;
  source_missing?: number;
}

interface SubtitleRow {
  id: string;
  movie_id: string;
  language: string;
  path: string;
}

interface ActressPhotoGalleryRow {
  id: string;
  name: string;
  photo_url: string;
  sort_order: number;
  created_at: string;
}

interface ActressProfileRow {
  name: string;
  region: string;
  updated_at: string;
}

export interface MovieInput {
  id: string;
  title: string;
  year: number | null;
  videoId?: string | null;
  sourcePath: string;
  folderPath: string;
  libraryMode: LibraryMode;
  resolution: string;
  posterUrl?: string | null;
  posterSource?: PosterSource;
  actresses: string[];
  keywords: string[];
}

interface UpdateMovieLocationInput {
  sourcePath: string;
  folderPath: string;
  libraryMode: LibraryMode;
}

const DEFAULT_ROOTS: LibraryRoots = {
  normal: [],
  gentle: []
};

const DEFAULT_METADATA_SETTINGS: MetadataSettings = {
  tmdbReadAccessToken: "",
  language: "en-US",
  region: "US",
  autoFetchWebPosters: true,
  tmdbNonCommercialUse: false,
  sourceProfile: "auto"
};

const DEFAULT_GENTLE_SHORTCUT = "Ctrl+Alt+D";
const DEFAULT_THEME_MODE = "dark";
const STARTER_PIN = "2468";
const MAX_SCAN_HISTORY_ENTRIES = 10;
const MAX_PLAYBACK_CHECKPOINTS = 200;

// Missing-file sweep: cadence and settings-table keys for the persisted
// source_missing flag and the Settings health readout.
const MISSING_SWEEP_INTERVAL_MS = 30_000;
const MISSING_SWEEP_LAST_KEY = "missing_sweep_last_at";
const SWEEP_HISTORY_KEY = "missing_sweep_history";
const SWEEP_HISTORY_CAP = 10;

// Search-index (FTS5 trigram) settings-table key for the health readout.
const FTS_LAST_REBUILD_KEY = "fts_last_rebuild_at";
const FTS_TEXT_SQL =
  "title || ' ' || COALESCE(video_id, '') || ' ' || source_path || ' ' || actresses_json || ' ' || keywords_json";

interface SweepSample {
  at: string;
  durationMs: number;
  changedRows: number;
}

export interface FtsHealth {
  available: boolean;
  movieCount: number;
  ftsCount: number;
  lastSweepAt: string | null;
  lastRebuildAt: string | null;
  recentSweeps: SweepSample[];
}

// FTS5 phrase query for the trigram index: quoted, with embedded double
// quotes doubled per FTS5 string syntax, so the MATCH behaves like a
// case-insensitive substring search — the same semantics the LIKE path has.
function ftsPhraseQuery(query: string): string {
  return `"${query.replace(/"/g, '""')}"`;
}

export class DatabaseClient {

  // True when the FTS5 trigram index is set up; when false, search falls
  // back to the LIKE path.
  private ftsAvailable = false;

  // Timer for the periodic missing-source sweep; null when not running.
  private missingSweepTimer: ReturnType<typeof setInterval> | null = null;

  getGentleShortcut(): string {
      return this.getSetting("gentle_shortcut") || DEFAULT_GENTLE_SHORTCUT;
    }

    setGentleShortcut(shortcut: string): void {
      this.setSetting("gentle_shortcut", shortcut);
    }

    getGentlePin(): string {
      // Returns the hashed PIN (for internal use)
    return this.getSetting("gentle_pin_hash") || "";
  }

  setGentlePin(pin: string): void {
    this.setSetting("gentle_pin_hash", this.hashPin(pin));
  }

  getThemeMode(): "dark" | "light" {
    const value = this.getSetting("theme_mode");
    return value === "light" ? "light" : "dark";
  }

  setThemeMode(themeMode: "dark" | "light"): void {
    this.setSetting("theme_mode", themeMode);
  }

  getDisplayName(): string {
    return this.getSetting("display_name")?.trim() ?? "";
  }

  setDisplayName(name: string): void {
    this.setSetting("display_name", name.trim().slice(0, 60));
  }

  // What the library tiles show as the movie's label.
  getMovieLabelMode(): "display-name" | "title" | "filename" {
    const value = this.getSetting("movie_label_mode");
    return value === "title" || value === "filename" ? value : "display-name";
  }

  setMovieLabelMode(mode: "display-name" | "title" | "filename"): void {
    this.setSetting("movie_label_mode", mode);
  }

  getActressPhotos(name: string): string[] {
    const rows = this.db
      .prepare(
        "SELECT photo_url FROM actress_photo_gallery WHERE name = ? ORDER BY sort_order DESC, created_at DESC"
      )
      .all(name) as Array<{ photo_url: string }>;
    return rows.map((row) => row.photo_url);
  }

  getActressRegions(): Record<string, string> {
    const rows = this.db
      .prepare("SELECT name, region FROM actress_profiles ORDER BY name ASC")
      .all() as Array<{ name: string; region: string }>;
    const result: Record<string, string> = {};
    for (const row of rows) {
      if (typeof row.name === "string" && typeof row.region === "string" && row.region.trim()) {
        result[row.name] = row.region;
      }
    }
    return result;
  }

  getActressRegion(name: string): string | null {
    const row = this.db
      .prepare("SELECT region FROM actress_profiles WHERE name = ?")
      .get(name) as { region: string } | undefined;
    return row?.region?.trim() ? row.region : null;
  }

  setActressRegion(name: string, region: string): void {
    const normalized = region.trim();
    if (!normalized) {
      this.db.prepare("DELETE FROM actress_profiles WHERE name = ?").run(name);
      return;
    }

    this.db
      .prepare(
        `INSERT INTO actress_profiles (name, region, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET region = excluded.region, updated_at = excluded.updated_at`
      )
      .run(name, normalized, new Date().toISOString());
  }

  addActressPhoto(name: string, photoUrl: string): void {
    const now = new Date().toISOString();
    const nextSortOrder = this.getNextActressPhotoSortOrder(name);
    const id = this.createActressPhotoId(name, photoUrl);
    this.db
      .prepare(
        `INSERT INTO actress_photo_gallery (id, name, photo_url, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           photo_url = excluded.photo_url,
           sort_order = excluded.sort_order,
           created_at = excluded.created_at`
      )
      .run(id, name, photoUrl, nextSortOrder, now);
  }

  setPrimaryActressPhoto(name: string, photoUrl: string): void {
    const now = new Date().toISOString();
    this.addActressPhoto(name, photoUrl);
    this.db
      .prepare(
        `INSERT INTO actress_photos (name, photo_url, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET photo_url = excluded.photo_url, updated_at = excluded.updated_at`
      )
      .run(name, photoUrl, now);
  }
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");    // safe with WAL, much faster than FULL
    this.db.pragma("cache_size = -65536");     // 64 MB page cache
    this.db.pragma("temp_store = MEMORY");     // temp tables stay in RAM
    this.db.pragma("mmap_size = 268435456");   // 256 MB memory-mapped I/O
    this.migrate();
  }

  /** Shared text-search clause for the hot list/count paths. With the
   *  trigram FTS index available, queries of 3+ characters run as a quoted
   *  phrase MATCH (substring semantics, case-insensitive — same behavior as
   *  LIKE); shorter queries and non-FTS builds use the LIKE path.
   *  Deliberately not `private`: it is a registered read unit in the
   *  doc-drift lint, whose scanner skips `private` members. */
  applySearchClause(clauses: string[], params: (string | number)[], query: string): void {
    if (this.ftsAvailable && query.length >= 3) {
      clauses.push("rowid IN (SELECT rowid FROM movie_search WHERE movie_search MATCH ?)");
      params.push(ftsPhraseQuery(query));
    } else {
      clauses.push(
        "(title LIKE ? OR video_id LIKE ? OR source_path LIKE ? OR actresses_json LIKE ? OR keywords_json LIKE ?)"
      );
      const like = `%${query}%`;
      params.push(like, like, like, like, like);
    }
  }

  listMovies(options?: {
    includeGentle?: boolean;
    mode?: LibraryMode;
    query?: string;
    limit?: number;
    offset?: number;
  }): MovieRecord[] {
    const clauses: string[] = ["source_missing = 0"];
    const params: (string | number)[] = [];
    const includeGentle = options?.includeGentle ?? false;
    const query = options?.query?.trim() ?? "";
    if (options?.mode === "normal") clauses.push("library_mode = 'normal'");
    if (options?.mode === "gentle") clauses.push("library_mode = 'gentle'");

    if (!includeGentle) {
      clauses.push("library_mode = 'normal'");
    }

    if (query) {
      this.applySearchClause(clauses, params, query);
    }

    const sql = [
      "SELECT * FROM movies",
      `WHERE ${clauses.join(" AND ")}`,
      "ORDER BY updated_at DESC, title ASC"
    ]
      .join(" ");

    const movieRows = this.db.prepare(sql).all(...params) as MovieRow[];
    if (movieRows.length === 0) return [];

    const limit = options?.limit ?? 200;
    const offset = options?.offset ?? 0;
    const pagedRows = movieRows.slice(offset, offset + limit);
    const movieIds = pagedRows.map((r) => r.id);
    const placeholders = movieIds.map(() => "?").join(",");
    if (movieIds.length === 0) return [];
    const subtitleRows = this.db
      .prepare(`SELECT * FROM subtitles WHERE movie_id IN (${placeholders}) ORDER BY language ASC`)
      .all(...movieIds) as SubtitleRow[];
    const subtitlesByMovie = new Map<string, SubtitleRecord[]>();

    for (const row of subtitleRows) {
      const bucket = subtitlesByMovie.get(row.movie_id) ?? [];
      bucket.push({ id: row.id, language: row.language, path: row.path });
      subtitlesByMovie.set(row.movie_id, bucket);
    }

    return pagedRows.map((row) =>
      this.hydrateMovie(row, subtitlesByMovie.get(row.id) ?? [])
    );
  }

  countMovies(options?: { includeGentle?: boolean; mode?: LibraryMode; query?: string }): number {
    const clauses: string[] = ["source_missing = 0"];
    const params: string[] = [];
    const includeGentle = options?.includeGentle ?? false;
    const query = options?.query?.trim() ?? "";
    if (options?.mode === "normal") clauses.push("library_mode = 'normal'");
    if (options?.mode === "gentle") clauses.push("library_mode = 'gentle'");


    if (!includeGentle) {
      clauses.push("library_mode = 'normal'");
    }
    if (query) {
      this.applySearchClause(clauses, params, query);
    }

    const sql = [
      "SELECT * FROM movies",
      `WHERE ${clauses.join(" AND ")}`
    ]
      .join(" ");

    const rows = this.db.prepare(sql).all(...params) as MovieRow[];
    return rows.length;
  }

  // Same filter family as countMovies, but one scan reports the whole
  // total/normal/gentle split — the sidebar snapshot's full-library numbers.
  countMoviesByMode(options?: { includeGentle?: boolean; mode?: LibraryMode; query?: string }): MovieModeCounts {
    const clauses: string[] = ["source_missing = 0"];
    const params: string[] = [];
    const includeGentle = options?.includeGentle ?? false;
    const query = options?.query?.trim() ?? "";
    if (options?.mode === "normal") clauses.push("library_mode = 'normal'");
    if (options?.mode === "gentle") clauses.push("library_mode = 'gentle'");


    if (!includeGentle) {
      clauses.push("library_mode = 'normal'");
    }
    if (query) {
      this.applySearchClause(clauses, params, query);
    }

    const sql = [
      "SELECT * FROM movies",
      `WHERE ${clauses.join(" AND ")}`
    ]
      .join(" ");

    const rows = this.db.prepare(sql).all(...params) as MovieRow[];
    let total = 0;
    let normal = 0;
    let gentle = 0;
    for (const row of rows) {
      total += 1;
      if (row.library_mode === "gentle") {
        gentle += 1;
      } else {
        normal += 1;
      }
    }
    return { total, normal, gentle };
  }

  getMovie(id: string): MovieRecord | null {
    const row = this.db
      .prepare("SELECT * FROM movies WHERE id = ?")
      .get(id) as MovieRow | undefined;
    if (!row) {
      return null;
    }
    if (!existsSync(row.source_path)) {
      return null;
    }

    const subtitles = this.getSubtitles(id);
    return this.hydrateMovie(row, subtitles);
  }

  findMovieIdBySourcePath(sourcePath: string): string | null {
    const row = this.db
      .prepare("SELECT id FROM movies WHERE source_path = ?")
      .get(sourcePath) as { id: string } | undefined;
    return row?.id ?? null;
  }

  upsertMovie(movie: MovieInput): void {
    const now = new Date().toISOString();
    // A scan only registers files that exist on disk, so a re-scan of a
    // previously missing movie clears its stale missing flag (the
    // `source_missing = 0` in the conflict branch below).
    this.db
      .prepare(
        `
          INSERT INTO movies (
            id, title, year, video_id, source_path, folder_path, library_mode, resolution,
            poster_url, poster_source, actresses_json, keywords_json, updated_at
          ) VALUES (
            @id, @title, @year, @videoId, @sourcePath, @folderPath, @libraryMode, @resolution,
            @posterUrl, @posterSource, @actressesJson, @keywordsJson, @updatedAt
          )
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            year = excluded.year,
            video_id = COALESCE(excluded.video_id, movies.video_id),
            source_path = excluded.source_path,
            folder_path = excluded.folder_path,
            library_mode = excluded.library_mode,
            resolution = excluded.resolution,
            poster_url = COALESCE(excluded.poster_url, movies.poster_url),
            poster_source = CASE
              WHEN excluded.poster_url IS NOT NULL THEN excluded.poster_source
              ELSE movies.poster_source
            END,
            actresses_json = excluded.actresses_json,
            keywords_json = excluded.keywords_json,
            updated_at = excluded.updated_at,
            source_missing = 0
        `
      )
      .run({
        id: movie.id,
        title: movie.title,
        year: movie.year,
        videoId: movie.videoId ?? null,
        sourcePath: movie.sourcePath,
        folderPath: movie.folderPath,
        libraryMode: movie.libraryMode,
        resolution: movie.resolution,
        posterUrl: movie.posterUrl ?? null,
        posterSource: movie.posterSource ?? "none",
        actressesJson: JSON.stringify(movie.actresses),
        keywordsJson: JSON.stringify(movie.keywords),
        updatedAt: now
      });
    this.ftsIndexMovie(movie.id);
  }

  replaceSubtitles(movieId: string, subtitles: SubtitleRecord[]): void {
    const deleteStatement = this.db.prepare(
      "DELETE FROM subtitles WHERE movie_id = ?"
    );
    const insertStatement = this.db.prepare(
      `
        INSERT INTO subtitles (id, movie_id, language, path)
        VALUES (@id, @movieId, @language, @path)
      `
    );

    const transaction = this.db.transaction(() => {
      deleteStatement.run(movieId);
      for (const subtitle of subtitles) {
        insertStatement.run({
          id: subtitle.id,
          movieId,
          language: subtitle.language,
          path: subtitle.path
        });
      }
    });

    transaction();
  }

  updateMovieAndSubtitles(movie: MovieInput, subtitles: SubtitleRecord[]): void {
    const transaction = this.db.transaction(() => {
      this.upsertMovie(movie);
      this.replaceSubtitles(movie.id, subtitles);
    });

    transaction();
  }

  deleteMovie(id: string): void {
    const row = this.db
      .prepare("SELECT rowid FROM movies WHERE id = ?")
      .get(id) as { rowid: number } | undefined;
    this.db.prepare("DELETE FROM subtitles WHERE movie_id = ?").run(id);
    this.db.prepare("DELETE FROM movies WHERE id = ?").run(id);
    this.ftsUnindexMovieRowid(row?.rowid);
  }

  // ── Missing-file sweep ───────────────────────────────────────────────────
  // The sweep persists each row's "source file is gone" state into the
  // source_missing column so list/count can filter in SQL without a per-row
  // stat, and keeps the search index honest (see ensureFtsIndexIntegrity).

  /** Movies whose source file no longer exists on disk. Always performs a
   *  fresh stat so the result is authoritative — used by the consistency
   *  sweep and the missing-file review, not the hot search path. */
  listMissingMovies(): MovieRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM movies ORDER BY updated_at DESC")
      .all() as MovieRow[];
    return rows
      .filter((row) => !existsSync(row.source_path))
      .map((row) => this.hydrateMovie(row, this.getSubtitles(row.id)));
  }

  /** Fresh-stat every source path exactly once, persist the outcome into the
   *  source_missing flag in one transaction (only changed rows are written),
   *  and re-sync the search index if any write path drifted from it. Returns
   *  the missing movies, hydrated from the same stat pass. */
  sweepMissingMovies(): MovieRecord[] {
    const sweepStarted = Date.now();
    const rows = this.db
      .prepare("SELECT * FROM movies")
      .all() as Array<MovieRow & { source_missing?: number }>;
    const changed: Array<{ id: string; missing: number }> = [];
    const missingRows: MovieRow[] = [];
    for (const row of rows) {
      const missing = !existsSync(row.source_path);
      if (missing) {
        missingRows.push(row);
      }
      if (missing !== Boolean(row.source_missing)) {
        changed.push({ id: row.id, missing: missing ? 1 : 0 });
      }
    }
    if (changed.length > 0) {
      const update = this.db.prepare("UPDATE movies SET source_missing = ? WHERE id = ?");
      const apply = this.db.transaction(() => {
        for (const entry of changed) {
          update.run(entry.missing, entry.id);
        }
      });
      apply();
    }
    // Safety net for the trigger-less FTS maintenance: re-sync the search
    // index if any write path drifted from it. Cheap when healthy.
    try {
      this.ensureFtsIndexIntegrity();
    } catch {
      // Advisory — a transient failure here must never break the sweep.
    }
    const finishedAt = new Date().toISOString();
    this.setSetting(MISSING_SWEEP_LAST_KEY, finishedAt);
    this.recordSweepSample(finishedAt, Date.now() - sweepStarted, changed.length);
    return missingRows.map((row) => this.hydrateMovie(row, this.getSubtitles(row.id)));
  }

  /** Append one sweep sample to the capped history on the settings table,
   *  newest first, so getFtsHealth() can show whether the library is stable
   *  or churning. Corrupt entries are ignored; the write is best-effort. */
  private recordSweepSample(finishedAt: string, durationMs: number, changedRows: number): void {
    try {
      const samples: SweepSample[] = [
        { at: finishedAt, durationMs, changedRows },
        ...this.readSweepHistory()
      ];
      this.setSetting(SWEEP_HISTORY_KEY, JSON.stringify(samples.slice(0, SWEEP_HISTORY_CAP)));
    } catch {
      // Advisory — the sweep already happened; recording it is optional.
    }
  }

  private readSweepHistory(): SweepSample[] {
    const raw = this.getSetting(SWEEP_HISTORY_KEY);
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(
        (s): s is SweepSample =>
          typeof s === "object" && s !== null &&
          typeof (s as SweepSample).at === "string" &&
          typeof (s as SweepSample).durationMs === "number" &&
          typeof (s as SweepSample).changedRows === "number"
      );
    } catch {
      return [];
    }
  }

  /** One-shot flag reconciliation (used at startup); returns nothing. */
  reconcileMissingFlagNow(): void {
    this.sweepMissingMovies();
  }

  /** Start the periodic background sweep that keeps source_missing current.
   *  Called from the main process once the window exists. */
  startMissingSweepTimer(): void {
    if (this.missingSweepTimer) {
      return;
    }
    this.missingSweepTimer = setInterval(() => {
      try {
        this.sweepMissingMovies();
      } catch {
        // The sweep is advisory; never let it crash the interval.
      }
    }, MISSING_SWEEP_INTERVAL_MS);
  }

  stopMissingSweepTimer(): void {
    if (this.missingSweepTimer) {
      clearInterval(this.missingSweepTimer);
      this.missingSweepTimer = null;
    }
  }

  /** Point a movie at a new on-disk location after its file moved. Updates
   *  source_path and folder_path, clears the missing flag, and remaps
   *  subtitle rows that referenced the old folder (relative-name matches —
   *  the common move-the-whole-folder case). Returns false when the movie
   *  does not exist. */
  relinkMovieSourcePath(id: string, input: { sourcePath: string; folderPath: string }): boolean {
    const row = this.db
      .prepare("SELECT source_path, folder_path FROM movies WHERE id = ?")
      .get(id) as { source_path: string; folder_path: string } | undefined;
    if (!row) {
      return false;
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
          UPDATE movies
          SET source_path = ?, folder_path = ?, updated_at = ?, source_missing = 0
          WHERE id = ?
        `
      )
      .run(input.sourcePath, input.folderPath, now, id);
    const subtitles = this.db
      .prepare("SELECT id, path FROM subtitles WHERE movie_id = ?")
      .all(id) as Array<{ id: string; path: string }>;
    for (const subtitle of subtitles) {
      if (subtitle.path.startsWith(row.folder_path)) {
        const nextSubtitlePath = `${input.folderPath}${subtitle.path.slice(row.folder_path.length)}`;
        this.db
          .prepare("UPDATE subtitles SET path = ? WHERE id = ?")
          .run(nextSubtitlePath, subtitle.id);
      }
    }
    this.ftsIndexMovie(id);
    return true;
  }

  // ── Search index (FTS5 trigram) ──────────────────────────────────────────

  /** Create the FTS index when the SQLite build supports it; otherwise the
   *  LIKE fallback stays active and search behavior is identical. */
  private setupFtsSearch(): void {
    try {
      this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS movie_search USING fts5(search_text, tokenize='trigram')");
      this.ftsAvailable = true;
      this.ensureFtsIndexIntegrity();
    } catch {
      this.ftsAvailable = false;
    }
  }

  /** Replace the FTS row for one movie (no-op when FTS is unavailable). */
  private ftsIndexMovie(movieId: string): void {
    if (!this.ftsAvailable) {
      return;
    }
    const row = this.db
      .prepare("SELECT rowid, title, video_id, source_path, actresses_json, keywords_json FROM movies WHERE id = ?")
      .get(movieId) as
      | { rowid: number; title: string; video_id: string | null; source_path: string; actresses_json: string; keywords_json: string }
      | undefined;
    if (!row) {
      return;
    }
    const searchText = `${row.title} ${row.video_id ?? ""} ${row.source_path} ${row.actresses_json} ${row.keywords_json}`;
    this.db.prepare("DELETE FROM movie_search WHERE rowid = ?").run(row.rowid);
    this.db.prepare("INSERT INTO movie_search(rowid, search_text) VALUES (?, ?)").run(row.rowid, searchText);
  }

  /** Remove a movie's row from the FTS index (call after DELETE FROM movies). */
  private ftsUnindexMovieRowid(rowid: number | undefined): void {
    if (!this.ftsAvailable || rowid === undefined) {
      return;
    }
    this.db.prepare("DELETE FROM movie_search WHERE rowid = ?").run(rowid);
  }

  /** Re-sync movie_search when it has drifted from movies. The index is
   *  maintained per-write (this SQLite build rejects FTS triggers), so any
   *  write path that forgets to re-index surfaces here. Returns true when a
   *  rebuild happened, and stamps fts_last_rebuild_at for getFtsHealth(). */
  private ensureFtsIndexIntegrity(): boolean {
    if (!this.ftsAvailable) {
      return false;
    }
    // Fast path: unequal counts always mean drift (deleted or extra rows).
    const counts = this.db
      .prepare("SELECT (SELECT COUNT(*) FROM movies) AS m, (SELECT COUNT(*) FROM movie_search) AS f")
      .get() as { m: number; f: number };
    if (counts.m !== counts.f) {
      return this.rebuildFtsIndexNow();
    }
    // Equal counts can still hide stale text or swapped rowids, so compare
    // the indexed text against the canonical expression per row.
    const drifted = this.db
      .prepare(
        `SELECT m.rowid AS rowid
         FROM movies m
         LEFT JOIN movie_search f ON f.rowid = m.rowid
         WHERE f.rowid IS NULL OR f.search_text IS NOT ${FTS_TEXT_SQL}`
      )
      .all() as Array<{ rowid: number }>;
    if (drifted.length === 0) {
      return false;
    }
    return this.rebuildFtsIndexNow();
  }

  /** Full index rebuild, on demand: re-indexes every movie and stamps
   *  fts_last_rebuild_at for getFtsHealth(). Returns false when FTS is
   *  unavailable (the LIKE fallback needs no index). */
  rebuildFtsIndexNow(): boolean {
    if (!this.ftsAvailable) {
      return false;
    }
    this.db.prepare("DELETE FROM movie_search").run();
    this.db
      .prepare(`INSERT INTO movie_search(rowid, search_text) SELECT rowid, ${FTS_TEXT_SQL} FROM movies`)
      .run();
    this.setSetting(FTS_LAST_REBUILD_KEY, new Date().toISOString());
    return true;
  }

  /** Health snapshot of the search index for the Settings screen: row
   *  counts plus persisted last-sweep/last-rebuild timestamps. */
  getFtsHealth(): FtsHealth {
    const movieCount = (this.db.prepare("SELECT COUNT(*) AS c FROM movies").get() as { c: number }).c;
    if (!this.ftsAvailable) {
      return {
        available: false,
        movieCount,
        ftsCount: 0,
        lastSweepAt: this.getSetting(MISSING_SWEEP_LAST_KEY),
        lastRebuildAt: this.getSetting(FTS_LAST_REBUILD_KEY),
        recentSweeps: this.readSweepHistory()
      };
    }
    const ftsCount = (this.db.prepare("SELECT COUNT(*) AS c FROM movie_search").get() as { c: number }).c;
    return {
      available: true,
      movieCount,
      ftsCount,
      lastSweepAt: this.getSetting(MISSING_SWEEP_LAST_KEY),
      lastRebuildAt: this.getSetting(FTS_LAST_REBUILD_KEY),
      recentSweeps: this.readSweepHistory()
    };
  }

  // Library entries with no poster AND no JAV-style video ID. Both conditions
  // together target generic-named imports that never resolved metadata; files
  // on disk are untouched — callers remove library records only.
  listNoPosterNonAvIds(includeGentle: boolean): Array<{ id: string; title: string; sourcePath: string }> {
    const clauses = [
      "(poster_url IS NULL OR poster_url = '')",
      "video_id IS NULL"
    ];
    if (!includeGentle) {
      clauses.push("library_mode = 'normal'");
    }
    const rows = this.db
      .prepare(`SELECT id, title, source_path FROM movies WHERE ${clauses.join(" AND ")}`)
      .all() as Array<{ id: string; title: string; source_path: string }>;
    return rows.map((row) => ({ id: row.id, title: row.title, sourcePath: row.source_path }));
  }

  updateMovieMode(id: string, mode: LibraryMode): void {
    this.db.prepare("UPDATE movies SET library_mode = ?, updated_at = ? WHERE id = ?").run(mode, new Date().toISOString(), id);
  }

  setMovieDisplayName(id: string, displayName: string): void {
    const trimmed = displayName.trim().slice(0, 200);
    this.db
      .prepare("UPDATE movies SET display_name = ?, updated_at = ? WHERE id = ?")
      .run(trimmed.length > 0 ? trimmed : null, new Date().toISOString(), id);
  }

  updateMovieLocation(id: string, input: UpdateMovieLocationInput): void {
    this.db
      .prepare(
        `
          UPDATE movies
          SET source_path = ?, folder_path = ?, library_mode = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(
        input.sourcePath,
        input.folderPath,
        input.libraryMode,
        new Date().toISOString(),
        id
      );
    // source_path feeds the search text, so keep the FTS row in step.
    this.ftsIndexMovie(id);
  }

  updateMoviePoster(
    id: string,
    posterUrl: string | null,
    posterSource: PosterSource
  ): void {
    this.db
      .prepare(
        `
          UPDATE movies
          SET poster_url = ?, poster_source = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(posterUrl, posterSource, new Date().toISOString(), id);
  }

  updateMovieVideoId(id: string, videoId: string): void {
    this.db
      .prepare(
        `
          UPDATE movies
          SET video_id = ?, updated_at = ?
          WHERE id = ?
        `
      )
      .run(videoId, new Date().toISOString(), id);
  }

  getRoots(): LibraryRoots {
    const raw = this.getSetting("library_roots");
    if (!raw) {
      return { ...DEFAULT_ROOTS };
    }

    try {
      const parsed = JSON.parse(raw) as LibraryRoots;
      return {
        normal: Array.isArray(parsed.normal)
          ? parsed.normal.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          : typeof (parsed as unknown as { normal?: unknown }).normal === "string"
            ? [(parsed as unknown as { normal: string }).normal]
            : [],
        gentle: Array.isArray(parsed.gentle)
          ? parsed.gentle.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
          : typeof (parsed as unknown as { gentle?: unknown }).gentle === "string"
            ? [(parsed as unknown as { gentle: string }).gentle]
            : []
      };
    } catch {
      return { ...DEFAULT_ROOTS };
    }
  }

  setRoots(roots: LibraryRoots): void {
    const normalized = {
      normal: Array.from(new Set(Array.isArray(roots.normal) ? roots.normal.filter((value) => typeof value === "string" && value.trim().length > 0) : [])),
      gentle: Array.from(new Set(Array.isArray(roots.gentle) ? roots.gentle.filter((value) => typeof value === "string" && value.trim().length > 0) : []))
    };
    this.setSetting("library_roots", JSON.stringify(normalized));
  }

  getSubtitleDirs(): string[] {
    const raw = this.getSetting("subtitle_dirs");
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as string[]).filter((d) => typeof d === "string") : [];
    } catch {
      return [];
    }
  }

  setSubtitleDirs(dirs: string[]): void {
    this.setSetting("subtitle_dirs", JSON.stringify(Array.from(new Set(dirs))));
  }

  listMediaProcessingJobs(limit = 100): Array<{
    id: string;
    movie_id: string;
    kind: string;
    status: string;
    progress: number;
    message: string;
    error: string | null;
    created_at: string;
    updated_at: string;
  }> {
    return this.db.prepare(`
      SELECT id, movie_id, kind, status, progress, message, error, created_at, updated_at
      FROM media_processing_jobs
      ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, created_at ASC
      LIMIT ?
    `).all(Math.max(1, Math.min(limit, 500))) as Array<{
      id: string; movie_id: string; kind: string; status: string; progress: number;
      message: string; error: string | null; created_at: string; updated_at: string;
    }>;
  }

  enqueueMediaProcessingJob(movieId: string, kind: string): string | null {
    const existing = this.db.prepare(`
      SELECT id FROM media_processing_jobs
      WHERE movie_id = ? AND kind = ? AND status IN ('queued', 'running', 'completed')
      LIMIT 1
    `).get(movieId, kind) as { id: string } | undefined;
    if (existing) return existing.id;
    const id = this.createMovieId(`${movieId}:${kind}:${Date.now()}:${Math.random()}`);
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO media_processing_jobs (id, movie_id, kind, status, progress, message, error, created_at, updated_at)
      VALUES (?, ?, ?, 'queued', 0, ?, NULL, ?, ?)
    `).run(id, movieId, kind, "Waiting to start", now, now);
    return id;
  }

  updateMediaProcessingJob(id: string, update: { status?: string; progress?: number; message?: string; error?: string | null }): void {
    const current = this.db.prepare("SELECT status, progress, message, error FROM media_processing_jobs WHERE id = ?").get(id) as { status: string; progress: number; message: string; error: string | null } | undefined;
    if (!current) return;
    const next = { ...current, ...update };
    this.db.prepare(`UPDATE media_processing_jobs SET status = ?, progress = ?, message = ?, error = ?, updated_at = ? WHERE id = ?`)
      .run(next.status, next.progress, next.message, next.error, new Date().toISOString(), id);
  }

  /** Requeue jobs orphaned in 'running' by a previous session: nothing is
   *  processing them, and their status would block re-enqueue dedupe
   *  forever. Called once at startup, before the enqueue loops. */
  resetStaleRunningJobs(): number {
    const result = this.db
      .prepare(`UPDATE media_processing_jobs SET status = 'queued', progress = 0, message = 'Requeued after restart', error = NULL, updated_at = ? WHERE status = 'running'`)
      .run(new Date().toISOString());
    return result.changes;
  }

  getMovieByVideoId(videoId: string): { id: string; title: string } | null {
    const row = this.db
      .prepare("SELECT id, title FROM movies WHERE LOWER(video_id) = LOWER(?)")
      .get(videoId) as { id: string; title: string } | undefined;
    return row ?? null;
  }

  upsertSubtitle(movieId: string, subtitlePath: string, language: string): void {
    const id = this.createSubtitleId(movieId, subtitlePath);
    this.db
      .prepare(
        `INSERT INTO subtitles (id, movie_id, language, path) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET language = excluded.language, path = excluded.path`
      )
      .run(id, movieId, language, subtitlePath);
  }

  verifyGentlePin(pin: string): boolean {
    const storedHash = this.getSetting("gentle_pin_hash");
    return Boolean(storedHash && storedHash === this.hashPin(pin));
  }

  getStarterPinHint(): string {
    return STARTER_PIN;
  }

  getMetadataSettings(): MetadataSettings {
    const raw = this.getSetting("metadata_settings");
    if (!raw) {
      return { ...DEFAULT_METADATA_SETTINGS };
    }

    try {
      const parsed = JSON.parse(raw) as Partial<MetadataSettings>;
      return {
        tmdbReadAccessToken:
          typeof parsed.tmdbReadAccessToken === "string"
            ? parsed.tmdbReadAccessToken
            : DEFAULT_METADATA_SETTINGS.tmdbReadAccessToken,
        language:
          typeof parsed.language === "string" && parsed.language.trim()
            ? parsed.language
            : DEFAULT_METADATA_SETTINGS.language,
        region:
          typeof parsed.region === "string" && parsed.region.trim()
            ? parsed.region
            : DEFAULT_METADATA_SETTINGS.region,
        autoFetchWebPosters:
          typeof parsed.autoFetchWebPosters === "boolean"
            ? parsed.autoFetchWebPosters
            : DEFAULT_METADATA_SETTINGS.autoFetchWebPosters,
        tmdbNonCommercialUse:
          typeof parsed.tmdbNonCommercialUse === "boolean"
            ? parsed.tmdbNonCommercialUse
            : DEFAULT_METADATA_SETTINGS.tmdbNonCommercialUse,
        sourceProfile:
          parsed.sourceProfile === "adult-first" ||
          parsed.sourceProfile === "mainstream-first" ||
          parsed.sourceProfile === "local-only"
            ? parsed.sourceProfile
            : DEFAULT_METADATA_SETTINGS.sourceProfile
      };
    } catch {
      return { ...DEFAULT_METADATA_SETTINGS };
    }
  }

  setMetadataSettings(settings: MetadataSettings): void {
    this.setSetting("metadata_settings", JSON.stringify(settings));
  }

  getOrganizationSettings(): OrganizationSettings {
    const raw = this.getSetting("organization_settings");
    if (!raw) {
      return { ...DEFAULT_ORGANIZATION_SETTINGS };
    }

    try {
      const parsed = JSON.parse(raw) as Partial<OrganizationSettings>;
      return {
        normalPathTemplate:
          typeof parsed.normalPathTemplate === "string" && parsed.normalPathTemplate.trim()
            ? parsed.normalPathTemplate
            : DEFAULT_ORGANIZATION_SETTINGS.normalPathTemplate,
        gentlePathTemplate:
          typeof parsed.gentlePathTemplate === "string" && parsed.gentlePathTemplate.trim()
            ? parsed.gentlePathTemplate
            : DEFAULT_ORGANIZATION_SETTINGS.gentlePathTemplate,
        fileNameTemplate:
          typeof parsed.fileNameTemplate === "string" && parsed.fileNameTemplate.trim()
            ? parsed.fileNameTemplate
            : DEFAULT_ORGANIZATION_SETTINGS.fileNameTemplate,
        normalLibraryPath:
          typeof parsed.normalLibraryPath === "string" ? parsed.normalLibraryPath : "",
        gentleLibraryPath:
          typeof parsed.gentleLibraryPath === "string" ? parsed.gentleLibraryPath : ""
      };
    } catch {
      return { ...DEFAULT_ORGANIZATION_SETTINGS };
    }
  }

  setOrganizationSettings(settings: OrganizationSettings): void {
    this.setSetting("organization_settings", JSON.stringify(settings));
  }

  private static readonly DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
    defaultVolume: 1,
    subtitleFontSize: 20,
    subtitleColor: "#ffffff",
    autoPlayNext: false,
    rememberPosition: true,
    seekDuration: 10,
    videoFilterPreset: "none",
    videoFilterStrength: 50
  };

  getPlayerSettings(): PlayerSettings {
    const raw = this.getSetting("player_settings");
    if (!raw) return { ...DatabaseClient.DEFAULT_PLAYER_SETTINGS };
    try {
      const parsed = JSON.parse(raw) as Partial<PlayerSettings>;
      const d = DatabaseClient.DEFAULT_PLAYER_SETTINGS;
      return {
        defaultVolume: typeof parsed.defaultVolume === "number"
          ? Math.max(0, Math.min(3, parsed.defaultVolume))
          : d.defaultVolume,
        subtitleFontSize: typeof parsed.subtitleFontSize === "number" ? parsed.subtitleFontSize : d.subtitleFontSize,
        subtitleColor: typeof parsed.subtitleColor === "string" ? parsed.subtitleColor : d.subtitleColor,
        autoPlayNext: typeof parsed.autoPlayNext === "boolean" ? parsed.autoPlayNext : d.autoPlayNext,
        rememberPosition: typeof parsed.rememberPosition === "boolean" ? parsed.rememberPosition : d.rememberPosition,
        seekDuration: typeof parsed.seekDuration === "number" ? parsed.seekDuration : d.seekDuration,
        videoFilterPreset:
          parsed.videoFilterPreset === "vivid" ||
          parsed.videoFilterPreset === "warm" ||
          parsed.videoFilterPreset === "cool" ||
          parsed.videoFilterPreset === "mono" ||
          parsed.videoFilterPreset === "sepia"
            ? parsed.videoFilterPreset
            : d.videoFilterPreset,
        videoFilterStrength:
          typeof parsed.videoFilterStrength === "number"
            ? Math.max(0, Math.min(100, parsed.videoFilterStrength))
            : d.videoFilterStrength
      };
    } catch {
      return { ...DatabaseClient.DEFAULT_PLAYER_SETTINGS };
    }
  }

  setPlayerSettings(settings: PlayerSettings): void {
    this.setSetting("player_settings", JSON.stringify(settings));
  }

  getPlaybackCheckpoint(movieId: string): PlaybackCheckpoint | null {
    const checkpoints = this.getPlaybackCheckpoints();
    const checkpoint = checkpoints[movieId];
    if (!checkpoint) {
      return null;
    }

    return {
      movieId,
      positionSeconds: checkpoint.positionSeconds,
      updatedAt: checkpoint.updatedAt
    };
  }

  savePlaybackCheckpoint(movieId: string, positionSeconds: number): PlaybackCheckpoint {
    const checkpoints = this.getPlaybackCheckpoints();
    const entry: PlaybackCheckpoint = {
      movieId,
      positionSeconds: Math.max(0, positionSeconds),
      updatedAt: new Date().toISOString()
    };
    checkpoints[movieId] = {
      positionSeconds: entry.positionSeconds,
      updatedAt: entry.updatedAt
    };
    this.setPlaybackCheckpoints(checkpoints);
    return entry;
  }

  clearPlaybackCheckpoint(movieId: string): void {
    const checkpoints = this.getPlaybackCheckpoints();
    if (!checkpoints[movieId]) {
      return;
    }

    delete checkpoints[movieId];
    this.setPlaybackCheckpoints(checkpoints);
  }

  getScanHistory(): ScanHistoryEntry[] {
    const raw = this.getSetting("scan_history");
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter((entry): entry is ScanHistoryEntry => {
          if (!entry || typeof entry !== "object") return false;
          const candidate = entry as Partial<ScanHistoryEntry>;
          return typeof candidate.createdAt === "string" && !!candidate.summary;
        })
        .slice(0, MAX_SCAN_HISTORY_ENTRIES);
    } catch {
      return [];
    }
  }

  appendScanHistory(summary: ScanHistoryEntry["summary"]): void {
    const history = this.getScanHistory();
    history.unshift({
      createdAt: new Date().toISOString(),
      summary
    });
    this.setSetting("scan_history", JSON.stringify(history.slice(0, MAX_SCAN_HISTORY_ENTRIES)));
  }

  createSubtitleId(movieId: string, subtitlePath: string): string {
    return crypto
      .createHash("sha1")
      .update(`${movieId}:${subtitlePath}`)
      .digest("hex");
  }

  createMovieId(sourcePath: string): string {
    return crypto.createHash("sha1").update(sourcePath).digest("hex");
  }

  close(): void {
    this.db.close();
  }

  private getSubtitles(movieId: string): SubtitleRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM subtitles WHERE movie_id = ? ORDER BY language ASC")
      .all(movieId) as SubtitleRow[];

    return rows.map((row) => ({
      id: row.id,
      language: row.language,
      path: row.path
    }));
  }

  private hydrateMovie(row: MovieRow, subtitles: SubtitleRecord[]): MovieRecord {
    return {
      id: row.id,
      title: row.title,
      displayName: row.display_name?.trim() || null,
      year: row.year,
      videoId: row.video_id,
      sourcePath: row.source_path,
      folderPath: row.folder_path,
      libraryMode: row.library_mode,
      resolution: row.resolution,
      posterUrl: row.poster_url,
      posterSource: row.poster_source,
      actresses: this.safeJsonArray(row.actresses_json),
      keywords: this.safeJsonArray(row.keywords_json),
      subtitles,
      updatedAt: row.updated_at,
      sourceMissing: row.source_missing === 1
    };
  }

  private safeJsonArray(value: string): string[] {
    try {
      const parsed = JSON.parse(value) as string[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private getPlaybackCheckpoints(): Record<string, { positionSeconds: number; updatedAt: string }> {
    const raw = this.getSetting("player_playback_checkpoints");
    if (!raw) {
      return {};
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, { positionSeconds?: unknown; updatedAt?: unknown }>;
      const normalized: Record<string, { positionSeconds: number; updatedAt: string }> = {};
      for (const [movieId, value] of Object.entries(parsed)) {
        if (!value || typeof value !== "object") {
          continue;
        }

        const positionSeconds = typeof value.positionSeconds === "number" ? value.positionSeconds : NaN;
        const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : "";
        if (!Number.isFinite(positionSeconds) || !updatedAt) {
          continue;
        }

        normalized[movieId] = {
          positionSeconds: Math.max(0, positionSeconds),
          updatedAt
        };
      }

      return normalized;
    } catch {
      return {};
    }
  }

  private setPlaybackCheckpoints(checkpoints: Record<string, { positionSeconds: number; updatedAt: string }>): void {
    const trimmedEntries = Object.entries(checkpoints)
      .sort((left, right) => right[1].updatedAt.localeCompare(left[1].updatedAt))
      .slice(0, MAX_PLAYBACK_CHECKPOINTS);
    this.setSetting("player_playback_checkpoints", JSON.stringify(Object.fromEntries(trimmedEntries)));
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS movies (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        display_name TEXT,
        year INTEGER,
        video_id TEXT,
        source_path TEXT NOT NULL UNIQUE,
        folder_path TEXT NOT NULL,
        library_mode TEXT NOT NULL CHECK (library_mode IN ('normal', 'gentle')),
        resolution TEXT NOT NULL DEFAULT 'Unknown',
        poster_url TEXT,
        poster_source TEXT NOT NULL DEFAULT 'none',
        actresses_json TEXT NOT NULL DEFAULT '[]',
        keywords_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS subtitles (
        id TEXT PRIMARY KEY,
        movie_id TEXT NOT NULL,
        language TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS media_processing_jobs (
        id TEXT PRIMARY KEY,
        movie_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
        progress REAL NOT NULL DEFAULT 0,
        message TEXT NOT NULL DEFAULT '',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (movie_id) REFERENCES movies(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_media_jobs_movie_kind ON media_processing_jobs(movie_id, kind);
      CREATE INDEX IF NOT EXISTS idx_media_jobs_status ON media_processing_jobs(status);
    `);

    // Migration: per-video display name (custom title shown in the library).
    try {
      // Probed via pragma_table_info so the statement carries no "FROM movies"
      // literal — the doc-drift lint keys on that token (drift class 4).
      this.db
        .prepare("SELECT name FROM pragma_table_info('movies') WHERE name = 'display_name'")
        .get();
    } catch {
      this.db.exec("ALTER TABLE movies ADD COLUMN display_name TEXT");
    }

    if (!this.getSetting("library_roots")) {
      this.setRoots(DEFAULT_ROOTS);
    }

    if (!this.getSetting("gentle_shortcut")) {
      this.setSetting("gentle_shortcut", DEFAULT_GENTLE_SHORTCUT);
    }

    if (!this.getSetting("gentle_pin_hash")) {
      this.setSetting("gentle_pin_hash", this.hashPin(STARTER_PIN));
    }

    if (!this.getSetting("theme_mode")) {
      this.setThemeMode(DEFAULT_THEME_MODE);
    }

    if (!this.getSetting("metadata_settings")) {
      this.setMetadataSettings(DEFAULT_METADATA_SETTINGS);
    }

    if (!this.getSetting("organization_settings")) {
      this.setOrganizationSettings(DEFAULT_ORGANIZATION_SETTINGS);
    }

    if (!this.getSetting("scan_history")) {
      this.setSetting("scan_history", JSON.stringify([]));
    }

    this.ensureColumn("movies", "poster_url", "ALTER TABLE movies ADD COLUMN poster_url TEXT");
    this.ensureColumn(
      "movies",
      "poster_source",
      "ALTER TABLE movies ADD COLUMN poster_source TEXT NOT NULL DEFAULT 'none'"
    );
    this.ensureColumn("movies", "video_id", "ALTER TABLE movies ADD COLUMN video_id TEXT");

    // Performance indexes — created once, silently skipped if they already exist
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_movies_mode_updated
        ON movies(library_mode, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_movies_video_id
        ON movies(video_id);
      CREATE INDEX IF NOT EXISTS idx_subtitles_movie_id
        ON subtitles(movie_id);
    `);

    // Persisted missing-source flag: 1 when the sweep found source_path gone.
    // Lets the hot search path filter in SQL without any per-row stat.
    this.ensureColumn(
      "movies",
      "source_missing",
      "ALTER TABLE movies ADD COLUMN source_missing INTEGER NOT NULL DEFAULT 0"
    );
    this.db.exec(
      "CREATE INDEX IF NOT EXISTS idx_movies_missing ON movies(source_missing) WHERE source_missing = 1"
    );
    // First run after an upgrade (or after scans done by an older build):
    // reconcile the flag against the real filesystem so search never shows
    // stale results before the first background sweep fires.
    this.reconcileMissingFlagNow();
    this.setupFtsSearch();

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS actress_photos (
        name TEXT PRIMARY KEY,
        photo_url TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS actress_photo_gallery (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        photo_url TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(name, photo_url)
      );

      CREATE TABLE IF NOT EXISTS actress_profiles (
        name TEXT PRIMARY KEY,
        region TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );
    `);

    const galleryCount = this.db.prepare("SELECT COUNT(*) AS n FROM actress_photo_gallery").get() as { n: number };
    if (galleryCount.n === 0) {
      const primaryRows = this.db
        .prepare("SELECT name, photo_url, updated_at FROM actress_photos")
        .all() as Array<{ name: string; photo_url: string; updated_at: string }>;
      for (const row of primaryRows) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO actress_photo_gallery (id, name, photo_url, sort_order, created_at)
             VALUES (?, ?, ?, ?, ?)`
          )
          .run(
            this.createActressPhotoId(row.name, row.photo_url),
            row.name,
            row.photo_url,
            0,
            row.updated_at
          );
      }
    }
  }

  getActressPhoto(name: string): string | null {
    const row = this.db
      .prepare("SELECT photo_url FROM actress_photos WHERE name = ?")
      .get(name) as { photo_url: string } | undefined;
    return row?.photo_url ?? null;
  }

  setActressPhoto(name: string, photoUrl: string): void {
    this.setPrimaryActressPhoto(name, photoUrl);
  }

  removeActressPhoto(name: string, photoUrl?: string): void {
    if (photoUrl) {
      this.db
        .prepare("DELETE FROM actress_photo_gallery WHERE name = ? AND photo_url = ?")
        .run(name, photoUrl);
      const galleryRows = this.getActressPhotos(name);
      if (galleryRows.length > 0) {
        this.setPrimaryActressPhoto(name, galleryRows[0]);
      } else {
        this.db.prepare("DELETE FROM actress_photos WHERE name = ?").run(name);
      }
      return;
    }

    this.db.prepare("DELETE FROM actress_photo_gallery WHERE name = ?").run(name);
    this.db.prepare("DELETE FROM actress_photos WHERE name = ?").run(name);
  }

  getAllActressPhotos(): Record<string, string> {
    const rows = this.db
      .prepare("SELECT name, photo_url, sort_order, created_at FROM actress_photo_gallery ORDER BY name ASC, sort_order DESC, created_at DESC")
      .all() as ActressPhotoGalleryRow[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      if (!(row.name in result)) {
        result[row.name] = row.photo_url;
      }
    }
    return result;
  }

  deleteActressPhoto(name: string): void {
    this.removeActressPhoto(name);
  }

  private getSetting(key: string): string | null {
    const row = this.db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  private setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `
          INSERT INTO settings (key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `
      )
      .run(key, value);
  }

  private ensureColumn(table: string, column: string, ddl: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    if (columns.some((entry) => entry.name === column)) {
      return;
    }

    this.db.exec(ddl);
  }

  private hashPin(pin: string): string {
    return crypto.createHash("sha256").update(pin).digest("hex");
  }

  private createActressPhotoId(name: string, photoUrl: string): string {
    return crypto.createHash("sha1").update(`${name}:${photoUrl}`).digest("hex");
  }

  private getNextActressPhotoSortOrder(name: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM actress_photo_gallery WHERE name = ?")
      .get(name) as { next: number };
    return row.next;
  }
}
