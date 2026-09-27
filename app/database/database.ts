
import crypto from "node:crypto";
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import type {
  MetadataSettings,
  LibraryMode,
  LibraryRoots,
  MovieRecord,
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
  year: number | null;
  video_id: string | null;
  source_path: string;
  folder_path: string;
  library_mode: LibraryMode;
  resolution: string;
  poster_url: string | null;
  poster_source: "none" | "local" | "web";
  actresses_json: string;
  keywords_json: string;
  updated_at: string;
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
  posterSource?: "none" | "local" | "web";
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

export class DatabaseClient {

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

  listMovies(options?: {
    includeGentle?: boolean;
    query?: string;
    limit?: number;
    offset?: number;
  }): MovieRecord[] {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    const includeGentle = options?.includeGentle ?? false;
    const query = options?.query?.trim() ?? "";
    if (!includeGentle) {
      clauses.push("library_mode = 'normal'");
    }

    if (query) {
      clauses.push(
        "(title LIKE ? OR video_id LIKE ? OR source_path LIKE ? OR actresses_json LIKE ? OR keywords_json LIKE ?)"
      );
      const like = `%${query}%`;
      params.push(like, like, like, like, like);
    }

    const sql = [
      "SELECT * FROM movies",
      clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
      "ORDER BY updated_at DESC, title ASC"
    ]
      .filter(Boolean)
      .join(" ");

    const movieRows = this.db.prepare(sql).all(...params) as MovieRow[];
    if (movieRows.length === 0) return [];

    const visibleRows = movieRows.filter((row) => existsSync(row.source_path));
    const limit = options?.limit ?? 200;
    const offset = options?.offset ?? 0;
    const pagedRows = visibleRows.slice(offset, offset + limit);
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

  countMovies(options?: { includeGentle?: boolean; query?: string }): number {
    const clauses: string[] = [];
    const params: string[] = [];
    const includeGentle = options?.includeGentle ?? false;
    const query = options?.query?.trim() ?? "";

    if (!includeGentle) {
      clauses.push("library_mode = 'normal'");
    }
    if (query) {
      clauses.push(
        "(title LIKE ? OR video_id LIKE ? OR source_path LIKE ? OR actresses_json LIKE ? OR keywords_json LIKE ?)"
      );
      const like = `%${query}%`;
      params.push(like, like, like, like, like);
    }

    const sql = [
      "SELECT * FROM movies",
      clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
    ]
      .filter(Boolean)
      .join(" ");

    const rows = this.db.prepare(sql).all(...params) as MovieRow[];
    return rows.filter((row) => existsSync(row.source_path)).length;
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
            updated_at = excluded.updated_at
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

  deleteMovie(id: string): void {
    this.db.prepare("DELETE FROM subtitles WHERE movie_id = ?").run(id);
    this.db.prepare("DELETE FROM movies WHERE id = ?").run(id);
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
  }

  updateMoviePoster(
    id: string,
    posterUrl: string | null,
    posterSource: "none" | "local" | "web"
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
        defaultVolume: typeof parsed.defaultVolume === "number" ? parsed.defaultVolume : d.defaultVolume,
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
      updatedAt: row.updated_at
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
    `);

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
