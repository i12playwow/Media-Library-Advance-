"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseClient = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const organizationTemplates_1 = require("../shared/organizationTemplates");
const pinRateLimiter_1 = require("../services/pinRateLimiter");
const DEFAULT_ROOTS = {
    normal: [],
    gentle: []
};
const DEFAULT_METADATA_SETTINGS = {
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
const GENTLE_PIN_LIMITER_KEY = "gentle-pin";
const MAX_SCAN_HISTORY_ENTRIES = 10;
const MAX_PLAYBACK_CHECKPOINTS = 200;
class DatabaseClient {
    getGentleShortcut() {
        return this.getSetting("gentle_shortcut") || DEFAULT_GENTLE_SHORTCUT;
    }
    setGentleShortcut(shortcut) {
        this.setSetting("gentle_shortcut", shortcut);
    }
    getGentlePin() {
        // Returns the hashed PIN (for internal use)
        return this.getSetting("gentle_pin_hash") || "";
    }
    setGentlePin(pin) {
        this.setSetting("gentle_pin_hash", this.hashPin(pin));
    }
    /** Normalize a PIN string to NFKC before hashing/verifying, so visually
     *  identical Unicode input always hashes to the same digest. */
    normalizePin(pin) {
        return pin.normalize("NFKC");
    }
    getThemeMode() {
        const value = this.getSetting("theme_mode");
        return value === "light" ? "light" : "dark";
    }
    setThemeMode(themeMode) {
        this.setSetting("theme_mode", themeMode);
    }
    getActressPhotos(name) {
        const rows = this.db
            .prepare("SELECT photo_url FROM actress_photo_gallery WHERE name = ? ORDER BY sort_order DESC, created_at DESC")
            .all(name);
        return rows.map((row) => row.photo_url);
    }
    getActressRegions() {
        const rows = this.db
            .prepare("SELECT name, region FROM actress_profiles ORDER BY name ASC")
            .all();
        const result = {};
        for (const row of rows) {
            if (typeof row.name === "string" && typeof row.region === "string" && row.region.trim()) {
                result[row.name] = row.region;
            }
        }
        return result;
    }
    getActressRegion(name) {
        const row = this.db
            .prepare("SELECT region FROM actress_profiles WHERE name = ?")
            .get(name);
        return row?.region?.trim() ? row.region : null;
    }
    setActressRegion(name, region) {
        const normalized = region.trim();
        if (!normalized) {
            this.db.prepare("DELETE FROM actress_profiles WHERE name = ?").run(name);
            return;
        }
        this.db
            .prepare(`INSERT INTO actress_profiles (name, region, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET region = excluded.region, updated_at = excluded.updated_at`)
            .run(name, normalized, new Date().toISOString());
    }
    addActressPhoto(name, photoUrl) {
        const now = new Date().toISOString();
        const nextSortOrder = this.getNextActressPhotoSortOrder(name);
        const id = this.createActressPhotoId(name, photoUrl);
        this.db
            .prepare(`INSERT INTO actress_photo_gallery (id, name, photo_url, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           photo_url = excluded.photo_url,
           sort_order = excluded.sort_order,
           created_at = excluded.created_at`)
            .run(id, name, photoUrl, nextSortOrder, now);
    }
    setPrimaryActressPhoto(name, photoUrl) {
        const now = new Date().toISOString();
        this.addActressPhoto(name, photoUrl);
        this.db
            .prepare(`INSERT INTO actress_photos (name, photo_url, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET photo_url = excluded.photo_url, updated_at = excluded.updated_at`)
            .run(name, photoUrl, now);
    }
    db;
    /** Persisted missing-source flag: 1 when the sweep found source_path gone.
     *  Lets the hot search path filter in SQL without any per-row stat; the
     *  sweep keeps it current and caches exist only for getMovie correctness. */
    missingSweepTimer = null;
    static MISSING_SWEEP_INTERVAL_MS = 30_000;
    static MISSING_SWEEP_STARTUP_DELAY_MS = 20_000;
    /** Settings-table keys for the health snapshot shown in Settings. */
    static MISSING_SWEEP_LAST_KEY = "missing_sweep_last_at";
    static FTS_LAST_REBUILD_KEY = "fts_last_rebuild_at";
    static SWEEP_HISTORY_KEY = "missing_sweep_history";
    /** Newest-first sweep samples kept for the health readout. 10 × 30s ≈ a
     *  5-minute window — enough to see churn without growing forever. */
    static SWEEP_HISTORY_CAP = 10;
    /** Cache for existsSync(source_path) lookups, used by getMovie only since
     *  list/count filter via the persisted source_missing flag. Entries expire
     *  after a short TTL, and any in-app write that changes a source path
     *  invalidates immediately. */
    fileExistsCache = new Map();
    pinRateLimiter = new pinRateLimiter_1.PinRateLimiter();
    /** True when the FTS5 trigram index is set up; when false, search falls
     *  back to the LIKE path. */
    ftsAvailable = false;
    /** Whether the FTS5 trigram search index is active on this database.
     *  Diagnostic/testing accessor — search behavior is identical either way
     *  (the LIKE fallback produces the same user-visible results). */
    hasFtsIndex() {
        return this.ftsAvailable;
    }
    /** Test-support hook: force a movie's updated_at so tests can control
     *  recency ordering independently of insertion order. Not used by the app. */
    setMovieUpdatedAtForTest(id, isoTimestamp) {
        this.db
            .prepare("UPDATE movies SET updated_at = ? WHERE id = ?")
            .run(isoTimestamp, id);
    }
    /** Test-support hook: run raw SQL against the underlying database, for
     *  tests that need to simulate out-of-band writes (e.g. a future write
     *  path forgetting to re-index FTS). Not used by the app. */
    runRawSqlForTest(sql) {
        this.db.exec(sql);
    }
    static MIN_FTS_QUERY_LENGTH = 3;
    /** Control characters snippet() emits around the matched text; the
     *  renderer's highlighter splits on these. Private-use, never collide
     *  with real library text. */
    static SNIPPET_OPEN = "\u0001";
    static SNIPPET_CLOSE = "\u0002";
    static SNIPPET_ELLIPSIS = "\u0003";
    /** SQL expression for the indexed FTS text. Must stay byte-identical to
     *  buildFtsText(), which maintains the same value from TypeScript on every
     *  movie write — the integrity check compares the two to detect drift. */
    static FTS_TEXT_SQL = "title || ' ' || COALESCE(video_id, '') || ' ' || source_path || ' ' || actresses_json || ' ' || keywords_json";
    /** Escape LIKE wildcards in user input; paired with ESCAPE '\\'. */
    static escapeLikeParam(value) {
        return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    }
    fileExistsCacheLastSweep = 0;
    static FILE_EXISTS_CACHE_TTL_MS = 15_000;
    static FILE_EXISTS_CACHE_MAX_ENTRIES = 50_000;
    constructor(dbPath) {
        this.db = new better_sqlite3_1.default(dbPath);
        this.db.pragma("journal_mode = WAL");
        this.db.pragma("synchronous = NORMAL"); // safe with WAL, much faster than FULL
        this.db.pragma("cache_size = -65536"); // 64 MB page cache
        this.db.pragma("temp_store = MEMORY"); // temp tables stay in RAM
        this.db.pragma("mmap_size = 268435456"); // 256 MB memory-mapped I/O
        this.migrate();
    }
    listMovies(options) {
        const includeGentle = options?.includeGentle ?? false;
        const query = options?.query?.trim() ?? "";
        const limit = options?.limit ?? 200;
        const offset = options?.offset ?? 0;
        const sortRecency = (options?.sortOrder ?? "rank") === "recency";
        const filter = this.buildSearchFilter(includeGentle, query, options?.mode);
        const baseClauses = [];
        const baseParams = [];
        if (!includeGentle) {
            baseClauses.push("library_mode = 'normal'");
        }
        baseClauses.push(...filter.clauses);
        // On the FTS path the MATCH parameter is bound once, to the explicit
        // `WHERE movies_fts MATCH ?` below — filter.params exists for the count
        // path's IN-subquery form and must not be bound again here.
        baseParams.push(...(filter.ftsMatchClause ? [] : filter.params));
        // Score-and-sort happens in TypeScript (buildRankOrderBy's SQL ladder
        // measured ~50ms p50 at 10k rows — ~36 CASE probes per matched row —
        // while scoring the same rows in JS costs ~2ms). The SQL exists only to
        // fetch the MATCH/LIKE set; ordering and paging are JS-side.
        let visibleRows;
        let matchText = null;
        if (this.ftsAvailable &&
            query.length >= DatabaseClient.MIN_FTS_QUERY_LENGTH &&
            filter.matchText !== null) {
            // JOIN form: SQLite drives from the FTS match set and fetches movies
            // by rowid primary key. The EXISTS alternative scans every movie and
            // re-runs MATCH per row — measured 8.0s vs 21ms at 10k rows on a
            // broad match (scripts/fts-fetch-probe.mjs) — and is never used.
            const sql = [
                "SELECT m.rowid AS _rowid, m.* FROM movies m",
                "JOIN movies_fts ON movies_fts.rowid = m.rowid",
                "WHERE movies_fts MATCH ?",
                baseClauses.length ? "AND " + baseClauses.join(" AND ") : "",
                sortRecency ? "ORDER BY m.updated_at DESC, m.title ASC LIMIT ? OFFSET ?" : ""
            ]
                .filter(Boolean)
                .join(" ");
            if (sortRecency) {
                // Date toggle: let SQLite order and page the match set — no fetch-
                // and-sort of every matched row, and no snippet position changes
                // (the per-page snippet pass below still runs with MATCH context).
                visibleRows = this.db
                    .prepare(sql)
                    .all(filter.matchText, ...baseParams, limit, offset);
            }
            else {
                const rows = this.db
                    .prepare(sql)
                    .all(filter.matchText, ...baseParams);
                visibleRows = DatabaseClient.rankAndPage(rows, filter.terms, limit, offset);
            }
            matchText = query;
        }
        else if (filter.terms.length === 0) {
            // No query: plain recency order, paged in SQL — nothing to rank.
            const sql = [
                "SELECT * FROM movies",
                baseClauses.length ? `WHERE ${baseClauses.join(" AND ")}` : "",
                "ORDER BY updated_at DESC, title ASC",
                "LIMIT ? OFFSET ?"
            ]
                .filter(Boolean)
                .join(" ");
            visibleRows = this.db
                .prepare(sql)
                .all(...baseParams, limit, offset);
        }
        else if (sortRecency) {
            // LIKE path with the date toggle on: recency order, paged in SQL.
            const sql = [
                "SELECT * FROM movies",
                baseClauses.length ? `WHERE ${baseClauses.join(" AND ")}` : "",
                "ORDER BY updated_at DESC, title ASC",
                "LIMIT ? OFFSET ?"
            ]
                .filter(Boolean)
                .join(" ");
            visibleRows = this.db
                .prepare(sql)
                .all(...baseParams, limit, offset);
        }
        else {
            const rows = this.db
                .prepare([
                "SELECT * FROM movies",
                baseClauses.length ? `WHERE ${baseClauses.join(" AND ")}` : ""
            ]
                .filter(Boolean)
                .join(" "))
                .all(...baseParams);
            visibleRows = DatabaseClient.rankAndPage(rows, filter.terms, limit, offset);
        }
        // Snippets are computed only for the final page. The lookup must keep
        // MATCH in the WHERE — without it FTS5 has no hit positions and returns
        // an arbitrary, unmarked window (probed: 0/50 rows marked vs 50/50 with
        // MATCH). `rowid = ?` seeks straight to the row so it stays cheap.
        if (visibleRows.length > 0 && matchText !== null) {
            const snippetStmt = this.db.prepare("SELECT snippet(movies_fts, 0, ?, ?, ?, 12) AS _snippet FROM movies_fts WHERE rowid = ? AND movies_fts MATCH ?");
            for (const row of visibleRows) {
                const hit = snippetStmt.get(DatabaseClient.SNIPPET_OPEN, DatabaseClient.SNIPPET_CLOSE, DatabaseClient.SNIPPET_ELLIPSIS, row._rowid ?? null, filter.matchText ?? "");
                if (hit?._snippet) {
                    row._snippet = hit._snippet;
                }
            }
        }
        if (visibleRows.length === 0)
            return [];
        const movieIds = visibleRows.map((r) => r.id);
        const placeholders = movieIds.map(() => "?").join(",");
        const subtitleRows = this.db
            .prepare(`SELECT * FROM subtitles WHERE movie_id IN (${placeholders}) ORDER BY language ASC`)
            .all(...movieIds);
        const subtitlesByMovie = new Map();
        for (const row of subtitleRows) {
            const bucket = subtitlesByMovie.get(row.movie_id) ?? [];
            bucket.push({ id: row.id, language: row.language, path: row.path });
            subtitlesByMovie.set(row.movie_id, bucket);
        }
        return visibleRows.map((row) => this.hydrateMovie(row, subtitlesByMovie.get(row.id) ?? [], matchText !== null ? (row._snippet ?? null) : this.buildFallbackSnippet(row, query)));
    }
    /** Builds the WHERE fragments for listMovies/countMovies. Queries of
     *  >= 3 chars use the FTS5 trigram index (case-insensitive substring match
     *  over title/video_id/path/actresses/keywords); shorter queries and
     *  non-FTS databases fall back to LIKE. source_missing is always filtered
     *  via the persisted flag — no per-row stat on the hot path. */
    buildSearchFilter(includeGentle, query, mode) {
        const clauses = [];
        const params = [];
        if (!includeGentle) {
            clauses.push("library_mode = 'normal'");
        }
        if (mode === "normal") clauses.push("library_mode = 'normal'");
        if (mode === "gentle") clauses.push("library_mode = 'gentle'");
        clauses.push("source_missing = 0");
        const trimmed = query.trim();
        if (!trimmed) {
            return { clauses, params, matchText: null, terms: [], ftsMatchClause: null };
        }
        const terms = DatabaseClient.parseSearchTerms(trimmed);
        if (this.ftsAvailable) {
            // Trigrams cannot match terms shorter than MIN_FTS_QUERY_LENGTH, so
            // only long terms enter the boolean MATCH; short terms stay rank-only
            // (rows missing them are still returned, just sorted lower).
            const ftsTerms = terms.filter((t) => t.length >= DatabaseClient.MIN_FTS_QUERY_LENGTH);
            if (ftsTerms.length > 0) {
                // OR so partial matches (any term) are returned; the ranking then
                // sorts movies matching MORE terms above movies matching fewer.
                const matchText = ftsTerms.map((t) => this.matchPhrase(t)).join(" OR ");
                return {
                    clauses,
                    params: [matchText],
                    matchText,
                    terms,
                    ftsMatchClause: "rowid IN (SELECT rowid FROM movies_fts WHERE movies_fts MATCH ?)"
                };
            }
        }
        // LIKE path (short queries and non-FTS builds): each term gets its own
        // OR-group so multi-word queries still return partial matches; the
        // ranking sorts rows matching more terms above rows matching fewer.
        for (const term of terms) {
            clauses.push("(title LIKE ? ESCAPE '\\' OR video_id LIKE ? ESCAPE '\\' OR actresses_json LIKE ? ESCAPE '\\' OR keywords_json LIKE ? ESCAPE '\\')");
            const like = `%${DatabaseClient.escapeLikeParam(term)}%`;
            params.push(like, like, like, like);
        }
        return { clauses, params, matchText: null, terms, ftsMatchClause: null };
    }
    /** Wrap a term in double quotes so punctuation-heavy tokens (e.g.
     *  "IPX-787") parse as a single trigram phrase; escape embedded quotes. */
    matchPhrase(term) {
        return `"${term.trim().replace(/"/g, '""')}"`;
    }
    /** Upper bound on ranked terms per query; keeps the generated ORDER BY
     *  (7 binds and 7 expressions per term) bounded for pathological input. */
    static MAX_SEARCH_TERMS = 8;
    /** Split a raw query into whitespace-separated search terms, deduped
     *  case-insensitively and capped at MAX_SEARCH_TERMS. */
    static parseSearchTerms(query) {
        const seen = new Set();
        const terms = [];
        for (const raw of query.trim().split(/\s+/)) {
            if (!raw)
                continue;
            const key = raw.toLowerCase();
            if (seen.has(key))
                continue;
            seen.add(key);
            terms.push(raw);
            if (terms.length >= DatabaseClient.MAX_SEARCH_TERMS)
                break;
        }
        return terms;
    }
    /** Rank matched rows and slice one page, in TypeScript. The SQL-ladder
     *  equivalent measured ~50ms p50 at 10k rows (~36 CASE probes per matched
     *  row) and generated bind layouts that silently mis-ranked when the
     *  per-key needle counts drifted; scoring here costs ~2ms for the same
     *  rows and cannot desync from its parameters.
     *
     *  Key ladder:
     *  1. number of DISTINCT terms matched ANYWHERE (DESC; multi-term only —
     *     for one term every matched row trivially contains it) — term
     *     coverage dominates: a movie matching more words always wins,
     *     regardless of recency or where its weaker term hit;
     *  2. number of terms matched in the TITLE (DESC);
     *  3. title quality sum across terms (exact 4 / substring 2 / miss 0);
     *  4-7. per-column term-hit counts (video ID, actresses, keywords, path);
     *  8-9. updated_at DESC, title ASC tie-breakers.
     *  With a single term this collapses to the previous single-term tier
     *  ladder exactly. */
    static rankAndPage(rows, terms, limit, offset) {
        if (terms.length === 0) {
            return rows;
        }
        const lower = terms.map((t) => t.toLowerCase());
        const hit = (haystack, needle) => haystack.includes(needle);
        const scored = rows.map((row) => {
            const title = row.title.toLowerCase();
            const video = (row.video_id ?? "").toLowerCase();
            const actresses = row.actresses_json.toLowerCase();
            const keywords = row.keywords_json.toLowerCase();
            const sourcePath = row.source_path.toLowerCase();
            let anywhere = 0;
            let titleCoverage = 0;
            let titleScore = 0;
            let videoScore = 0;
            let actressScore = 0;
            let keywordScore = 0;
            let pathScore = 0;
            for (const needle of lower) {
                const inTitle = hit(title, needle);
                const inVideo = video !== "" && hit(video, needle);
                const inActress = hit(actresses, needle);
                const inKeyword = hit(keywords, needle);
                const inPath = hit(sourcePath, needle);
                if (inTitle || inVideo || inActress || inKeyword || inPath)
                    anywhere += 1;
                if (inTitle) {
                    titleCoverage += 1;
                    titleScore += title === needle ? 4 : 2;
                }
                if (inVideo)
                    videoScore += 1;
                if (inActress)
                    actressScore += 1;
                if (inKeyword)
                    keywordScore += 1;
                if (inPath)
                    pathScore += 1;
            }
            return { row, anywhere, titleCoverage, titleScore, videoScore, actressScore, keywordScore, pathScore };
        });
        scored.sort((a, b) => b.anywhere - a.anywhere ||
            b.titleCoverage - a.titleCoverage ||
            b.titleScore - a.titleScore ||
            b.videoScore - a.videoScore ||
            b.actressScore - a.actressScore ||
            b.keywordScore - a.keywordScore ||
            b.pathScore - a.pathScore ||
            b.row.updated_at.localeCompare(a.row.updated_at) ||
            a.row.title.localeCompare(b.row.title));
        return scored
            .slice(offset, offset + limit)
            .map((entry) => entry.row);
    }
    /** Synthesize a marker-bearing excerpt for the LIKE path (short queries
     *  and SQLite builds without FTS5), matching the snippet() output shape
     *  the renderer's highlighter consumes. */
    buildFallbackSnippet(row, query) {
        const trimmed = query.trim();
        if (!trimmed) {
            return null;
        }
        const haystacks = [
            row.title,
            row.video_id ?? "",
            row.source_path,
            row.actresses_json,
            row.keywords_json
        ];
        // Prefer marking the whole query (e.g. a multi-word title phrase), then
        // fall back to whichever individual term actually hit this row.
        const candidates = [trimmed, ...DatabaseClient.parseSearchTerms(trimmed)];
        for (const candidate of candidates) {
            const lower = candidate.toLowerCase();
            for (const haystack of haystacks) {
                const index = haystack.toLowerCase().indexOf(lower);
                if (index >= 0) {
                    const start = Math.max(0, index - 16);
                    const end = Math.min(haystack.length, index + candidate.length + 16);
                    return ((start > 0 ? DatabaseClient.SNIPPET_ELLIPSIS : "") +
                        haystack.slice(start, index) +
                        DatabaseClient.SNIPPET_OPEN +
                        haystack.slice(index, index + candidate.length) +
                        DatabaseClient.SNIPPET_CLOSE +
                        haystack.slice(index + candidate.length, end) +
                        (end < haystack.length ? DatabaseClient.SNIPPET_ELLIPSIS : ""));
                }
            }
        }
        return null;
    }
    /** Create the FTS5 trigram search index and keep it in sync from
     *  TypeScript (no triggers / special FTS commands — those vary across
     *  SQLite builds). Falls back to LIKE search when FTS5 is unavailable. */
    setupFtsSearch() {
        try {
            this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS movies_fts USING fts5(search_text, tokenize='trigram')");
            this.ftsAvailable = true;
            this.ensureFtsIndexIntegrity();
        }
        catch {
            // No FTS5 support — LIKE fallback stays active.
            this.ftsAvailable = false;
        }
    }
    /** Replace the FTS row for one movie (no-op when FTS is unavailable). */
    ftsIndexMovie(movieId) {
        if (!this.ftsAvailable) {
            return;
        }
        const row = this.db
            .prepare("SELECT rowid, title, video_id, source_path, actresses_json, keywords_json FROM movies WHERE id = ?")
            .get(movieId);
        if (!row) {
            return;
        }
        const searchText = this.buildFtsText(row.title, row.video_id, row.source_path, row.actresses_json, row.keywords_json);
        this.db.prepare("DELETE FROM movies_fts WHERE rowid = ?").run(row.rowid);
        this.db.prepare("INSERT INTO movies_fts(rowid, search_text) VALUES (?, ?)").run(row.rowid, searchText);
    }
    /** Remove a movie's row from the FTS index (call after DELETE FROM movies). */
    ftsUnindexMovieRowid(rowid) {
        if (!this.ftsAvailable || rowid === undefined) {
            return;
        }
        this.db.prepare("DELETE FROM movies_fts WHERE rowid = ?").run(rowid);
    }
    buildFtsText(title, videoId, sourcePath, actressesJson, keywordsJson) {
        return `${title} ${videoId ?? ""} ${sourcePath} ${actressesJson} ${keywordsJson}`;
    }
    rebuildFtsIndex() {
        this.db.prepare("DELETE FROM movies_fts").run();
        this.db
            .prepare(`INSERT INTO movies_fts(rowid, search_text)
         SELECT rowid, ${DatabaseClient.FTS_TEXT_SQL}
         FROM movies`)
            .run();
    }
    /** Re-sync movies_fts when it has drifted from movies. The index is
     *  maintained per-write from TypeScript (this SQLite build rejects FTS
     *  triggers and special commands), so any future write path that forgets
     *  ftsIndexMovie/ftsUnindexMovieRowid surfaces here: rows whose indexed
     *  text no longer matches the movie (title/path/actresses changed without
     *  re-indexing) and rows for movies that no longer exist. Runs inside the
     *  periodic sweep and once at startup. Returns true when a rebuild
     *  happened, and persists the rebuild timestamp for getFtsHealth(). */
    ensureFtsIndexIntegrity() {
        if (!this.ftsAvailable) {
            return false;
        }
        // Fast path: unequal counts always mean drift (deleted or extra rows),
        // and lets the common healthy case skip the row-level comparison below.
        const counts = this.db
            .prepare("SELECT (SELECT COUNT(*) FROM movies) AS m, (SELECT COUNT(*) FROM movies_fts) AS f")
            .get();
        if (counts.m !== counts.f) {
            return this.rebuildFtsIndexNow();
        }
        // Equal counts can still hide stale text or swapped rowids, so compare
        // the indexed text against the canonical expression per row.
        const drifted = this.db
            .prepare(`SELECT m.rowid AS rowid
         FROM movies m
         LEFT JOIN movies_fts f ON f.rowid = m.rowid
         WHERE f.rowid IS NULL OR f.search_text IS NOT ${DatabaseClient.FTS_TEXT_SQL}`)
            .all();
        if (drifted.length === 0) {
            return false;
        }
        return this.rebuildFtsIndexNow();
    }
    /** Full index rebuild, on demand: re-indexes every movie and stamps
     *  fts_last_rebuild_at for getFtsHealth(). Exposed so Settings can repair
     *  immediately instead of waiting for the next sweep. Returns false when
     *  FTS is unavailable (the LIKE fallback needs no index). */
    rebuildFtsIndexNow() {
        if (!this.ftsAvailable) {
            return false;
        }
        this.rebuildFtsIndex();
        this.setSetting(DatabaseClient.FTS_LAST_REBUILD_KEY, new Date().toISOString());
        return true;
    }
    /** Health snapshot of the search index for the Settings screen: row
     *  counts plus persisted last-sweep/last-rebuild timestamps. Reads the
     *  same state the integrity check maintains, so Settings can show whether
     *  the index is live (FTS5) or running the LIKE fallback. */
    getFtsHealth() {
        const movieCount = this.db.prepare("SELECT COUNT(*) AS c FROM movies").get().c;
        if (!this.ftsAvailable) {
            // No movies_fts table exists on this build — querying it would throw.
            return {
                available: false,
                movieCount,
                ftsCount: 0,
                lastSweepAt: this.getSetting(DatabaseClient.MISSING_SWEEP_LAST_KEY),
                lastRebuildAt: this.getSetting(DatabaseClient.FTS_LAST_REBUILD_KEY),
                recentSweeps: this.readSweepHistory()
            };
        }
        const ftsCount = this.db.prepare("SELECT COUNT(*) AS c FROM movies_fts").get().c;
        return {
            available: true,
            movieCount,
            ftsCount,
            lastSweepAt: this.getSetting(DatabaseClient.MISSING_SWEEP_LAST_KEY),
            lastRebuildAt: this.getSetting(DatabaseClient.FTS_LAST_REBUILD_KEY),
            recentSweeps: this.readSweepHistory()
        };
    }
    countMovies(options) {
        const clauses = [];
        const params = [];
        const includeGentle = options?.includeGentle ?? false;
        const query = options?.query?.trim() ?? "";
        const filter = this.buildSearchFilter(includeGentle, query, options?.mode);
        clauses.push(...filter.clauses);
        if (filter.ftsMatchClause) {
            clauses.push(filter.ftsMatchClause);
        }
        params.push(...filter.params);
        const sql = [
            "SELECT COUNT(*) AS n FROM movies",
            clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
        ]
            .filter(Boolean)
            .join(" ");
        // Flag-based filtering: a pure SQL count, no per-row stat.
        return this.db.prepare(sql).get(...params).n;
    }
    /** Movies whose source file no longer exists on disk. Always performs a
     *  fresh stat (bypasses the fileExistsCache) so the result is authoritative
     *  — used by the consistency sweep, not the hot search path. */
    listMissingMovies() {
        const rows = this.db
            .prepare("SELECT * FROM movies ORDER BY updated_at DESC")
            .all();
        return rows
            .filter((row) => !(0, node_fs_1.existsSync)(row.source_path))
            .map((row) => this.hydrateMovie(row, this.getSubtitles(row.id)));
    }
    /** Fresh-stat every source path exactly once, persist the outcome into the
     *  source_missing flag in one transaction (only changed rows are written),
     *  and reconcile the fileExistsCache in both directions. Returns the
     *  missing movies, hydrated from the same stat pass. */
    sweepMissingMovies() {
        const sweepStarted = Date.now();
        const rows = this.db
            .prepare("SELECT * FROM movies")
            .all();
        const freshMissing = new Set();
        const changed = [];
        const missingRows = [];
        for (const row of rows) {
            const missing = !(0, node_fs_1.existsSync)(row.source_path);
            if (missing) {
                freshMissing.add(row.source_path);
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
        for (const [path, entry] of this.fileExistsCache) {
            // Stale in either direction: cache says exists but file is gone, or
            // cache says missing but file is back.
            if (entry.exists === freshMissing.has(path)) {
                this.fileExistsCache.delete(path);
            }
        }
        // Safety net for the trigger-less FTS maintenance: re-sync the search
        // index if any write path drifted from it. Cheap when healthy (count
        // equality short-circuits the row comparison).
        try {
            this.ensureFtsIndexIntegrity();
        }
        catch {
            // Advisory — a transient failure here must never break the sweep.
        }
        const finishedAt = new Date().toISOString();
        this.setSetting(DatabaseClient.MISSING_SWEEP_LAST_KEY, finishedAt);
        this.recordSweepSample(finishedAt, Date.now() - sweepStarted, changed.length);
        return missingRows.map((row) => this.hydrateMovie(row, this.getSubtitles(row.id)));
    }
    /** Append one sweep sample to the capped history on the settings table,
     *  newest first, so getFtsHealth() can show whether the library is stable
     *  or churning. Corrupt entries are ignored; the write is best-effort —
     *  a settings-table failure must not fail the sweep itself. */
    recordSweepSample(finishedAt, durationMs, changedRows) {
        try {
            const samples = [
                { at: finishedAt, durationMs, changedRows },
                ...this.readSweepHistory()
            ];
            this.setSetting(DatabaseClient.SWEEP_HISTORY_KEY, JSON.stringify(samples.slice(0, DatabaseClient.SWEEP_HISTORY_CAP)));
        }
        catch {
            // Advisory — the sweep already happened; recording it is optional.
        }
    }
    readSweepHistory() {
        const raw = this.getSetting(DatabaseClient.SWEEP_HISTORY_KEY);
        if (!raw) {
            return [];
        }
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return [];
            }
            // Accept only well-formed samples; one bad entry drops the whole
            // history read (the next sweep overwrites it with a fresh window).
            return parsed.filter((s) => typeof s === "object" && s !== null &&
                typeof s.at === "string" &&
                typeof s.durationMs === "number" &&
                typeof s.changedRows === "number");
        }
        catch {
            return [];
        }
    }
    /** One-shot flag reconciliation (used at startup); returns nothing. */
    reconcileMissingFlagNow() {
        this.sweepMissingMovies();
    }
    /** Start the periodic background sweep that keeps source_missing current.
     *  Called from the main process once the window exists. */
    sweepMissingMoviesAsync() { return require("../services/libraryMaintenance.cjs").sweepMissingMoviesAsync(this); }
    startMissingSweepTimer() {
        if (this.missingSweepTimer) {
            return;
        }
        this.missingSweepTimer = setInterval(() => {
            try {
                this.sweepMissingMoviesAsync().catch(() => {});
            }
            catch {
                // The sweep is advisory; never let it crash the interval.
            }
        }, DatabaseClient.MISSING_SWEEP_INTERVAL_MS);
    }
    stopMissingSweepTimer() {
        if (this.missingSweepTimer) {
            clearInterval(this.missingSweepTimer);
            this.missingSweepTimer = null;
        }
    }
    /** Drop every cached existsSync result. Called when a scan starts or
     *  finishes so library views reflect fresh disk state — scans add, move,
     *  and delete many files, and per-path invalidation can't anticipate them
     *  all (e.g. files deleted outside the app mid-scan). */
    clearFileExistsCache() {
        this.fileExistsCache.clear();
        this.fileExistsCacheLastSweep = 0;
    }
    getMovie(id) {
        const row = this.db
            .prepare("SELECT * FROM movies WHERE id = ?")
            .get(id);
        if (!row) {
            return null;
        }
        if (!this.cachedFileExists(row.source_path)) {
            return null;
        }
        const subtitles = this.getSubtitles(id);
        return this.hydrateMovie(row, subtitles);
    }
    findMovieIdBySourcePath(sourcePath) {
        const row = this.db
            .prepare("SELECT id FROM movies WHERE source_path = ?")
            .get(sourcePath);
        return row?.id ?? null;
    }
    upsertMovie(movie) {
        const previous = this.db
            .prepare("SELECT source_path, rowid FROM movies WHERE id = ?")
            .get(movie.id);
        const now = new Date().toISOString();
        this.db
            .prepare(`
          INSERT INTO movies (
            id, title, year, video_id, source_path, folder_path, library_mode, resolution,
            poster_url, poster_source, actresses_json, keywords_json, updated_at, source_missing
          ) VALUES (
            @id, @title, @year, @videoId, @sourcePath, @folderPath, @libraryMode, @resolution,
            @posterUrl, @posterSource, @actressesJson, @keywordsJson, @updatedAt, 0
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
        `)
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
        this.invalidateFileExistsCache(previous?.source_path, movie.sourcePath);
    }
    replaceSubtitles(movieId, subtitles) {
        const deleteStatement = this.db.prepare("DELETE FROM subtitles WHERE movie_id = ?");
        const insertStatement = this.db.prepare(`
        INSERT INTO subtitles (id, movie_id, language, path)
        VALUES (@id, @movieId, @language, @path)
      `);
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
    deleteMovie(id) {
        const row = this.db
            .prepare("SELECT source_path, rowid FROM movies WHERE id = ?")
            .get(id);
        this.db.prepare("DELETE FROM subtitles WHERE movie_id = ?").run(id);
        this.db.prepare("DELETE FROM movies WHERE id = ?").run(id);
        this.ftsUnindexMovieRowid(row?.rowid);
        this.invalidateFileExistsCache(row?.source_path);
    }
    /** Point a movie at a new on-disk location after its file moved. Updates
     *  source_path and folder_path, invalidates both fileExistsCache entries,
     *  and remaps subtitle rows that referenced the old folder (relative-name
     *  matches — the common move-the-whole-folder case). Returns false when
     *  the movie does not exist. */
    relinkMissingMovie(movie, input) {
        return this.db.transaction(() => {
            const current = this.db.prepare("SELECT source_path, updated_at, source_missing FROM movies WHERE id = ?").get(movie.id);
            if (!current?.source_missing || current.source_path !== movie.sourcePath || current.updated_at !== movie.updatedAt) return false;
            const occupied = this.db.prepare("SELECT 1 FROM movies WHERE source_path = ? COLLATE NOCASE AND id <> ?").get(input.sourcePath, movie.id);
            return !occupied && this.relinkMovieSourcePath(movie.id, input);
        })();
    }
    relinkMovieSourcePath(id, input) {
        const row = this.db
            .prepare("SELECT source_path, folder_path FROM movies WHERE id = ?")
            .get(id);
        if (!row) {
            return false;
        }
        const now = new Date().toISOString();
        this.db
            .prepare(`
          UPDATE movies
          SET source_path = ?, folder_path = ?, updated_at = ?, source_missing = 0
          WHERE id = ?
        `)
            .run(input.sourcePath, input.folderPath, now, id);
        const subtitles = this.db
            .prepare("SELECT id, path FROM subtitles WHERE movie_id = ?")
            .all(id);
        for (const subtitle of subtitles) {
            const nextSubtitlePath = input.verifiedSubtitles
                ? input.verifiedSubtitles.get(subtitle.path)
                : subtitle.path.startsWith(row.folder_path)
                    ? node_path_1.default.join(input.folderPath, node_path_1.default.relative(row.folder_path, subtitle.path))
                    : null;
            if (nextSubtitlePath) {
                this.db
                    .prepare("UPDATE subtitles SET path = ? WHERE id = ?")
                    .run(nextSubtitlePath, subtitle.id);
            }
        }
        this.ftsIndexMovie(id);
        this.invalidateFileExistsCache(row.source_path, input.sourcePath);
        return true;
    }
    updateMovieMode(id, mode) {
      this.db.prepare("UPDATE movies SET library_mode = ?, updated_at = ? WHERE id = ?").run(mode, new Date().toISOString(), id);
    }

    updateMovieLocation(id, input) {
        const previous = this.db
            .prepare("SELECT source_path FROM movies WHERE id = ?")
            .get(id);
        this.db
            .prepare(`
          UPDATE movies
          SET source_path = ?, folder_path = ?, library_mode = ?, updated_at = ?, source_missing = 0
          WHERE id = ?
        `)
            .run(input.sourcePath, input.folderPath, input.libraryMode, new Date().toISOString(), id);
        // source_path is part of the indexed FTS text — keep the index current
        // (the sweep's integrity check is the backstop, not the primary sync).
        this.ftsIndexMovie(id);
        this.invalidateFileExistsCache(previous?.source_path, input.sourcePath);
    }
    updateMoviePoster(id, posterUrl, posterSource) {
        this.db
            .prepare(`
          UPDATE movies
          SET poster_url = ?, poster_source = ?, updated_at = ?
          WHERE id = ?
        `)
            .run(posterUrl, posterSource, new Date().toISOString(), id);
    }
    updateMovieVideoId(id, videoId) {
        this.db
            .prepare(`
          UPDATE movies
          SET video_id = ?, updated_at = ?
          WHERE id = ?
        `)
            .run(videoId, new Date().toISOString(), id);
        // video_id is part of the indexed FTS text — keep the index current
        // (the sweep's integrity check is the backstop, not the primary sync).
        this.ftsIndexMovie(id);
    }
    getRoots() {
        const raw = this.getSetting("library_roots");
        if (!raw) {
            return { ...DEFAULT_ROOTS };
        }
        try {
            const parsed = JSON.parse(raw);
            return {
                normal: Array.isArray(parsed.normal)
                    ? parsed.normal.filter((value) => typeof value === "string" && value.trim().length > 0)
                    : typeof parsed.normal === "string"
                        ? [parsed.normal]
                        : [],
                gentle: Array.isArray(parsed.gentle)
                    ? parsed.gentle.filter((value) => typeof value === "string" && value.trim().length > 0)
                    : typeof parsed.gentle === "string"
                        ? [parsed.gentle]
                        : []
            };
        }
        catch {
            return { ...DEFAULT_ROOTS };
        }
    }
    setRoots(roots) {
        const normalized = {
            normal: Array.from(new Set(Array.isArray(roots.normal) ? roots.normal.filter((value) => typeof value === "string" && value.trim().length > 0) : [])),
            gentle: Array.from(new Set(Array.isArray(roots.gentle) ? roots.gentle.filter((value) => typeof value === "string" && value.trim().length > 0) : []))
        };
        this.setSetting("library_roots", JSON.stringify(normalized));
    }
    getSubtitleDirs() {
        const raw = this.getSetting("subtitle_dirs");
        if (!raw)
            return [];
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.filter((d) => typeof d === "string") : [];
        }
        catch {
            return [];
        }
    }
    setSubtitleDirs(dirs) {
        this.setSetting("subtitle_dirs", JSON.stringify(Array.from(new Set(dirs))));
    }
    getMovieByVideoId(videoId) {
        const row = this.db
            .prepare("SELECT id, title FROM movies WHERE LOWER(video_id) = LOWER(?)")
            .get(videoId);
        return row ?? null;
    }
    upsertSubtitle(movieId, subtitlePath, language) {
        const id = this.createSubtitleId(movieId, subtitlePath);
        this.db
            .prepare(`INSERT INTO subtitles (id, movie_id, language, path) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET language = excluded.language, path = excluded.path`)
            .run(id, movieId, language, subtitlePath);
    }
    /** Rate-limited PIN verification gate. Failed attempts are counted in a
     *  single global sliding window (independent of which PIN was tried — a
     *  per-PIN window would let an attacker probe every candidate once); too
     *  many failures lock out verification entirely (before any hashing work)
     *  so a 4-digit starter PIN cannot be brute-forced through the UI. A
     *  successful verification resets the count. */
    attemptGentlePinVerify(pin) {
        const decision = this.pinRateLimiter.attempt(GENTLE_PIN_LIMITER_KEY, Date.now());
        if (!decision.allowed) {
            return { ok: false, message: (0, pinRateLimiter_1.formatLockoutMessage)(decision.retryAfterMs) };
        }
        if (this.verifyGentlePin(pin)) {
            this.pinRateLimiter.reset(GENTLE_PIN_LIMITER_KEY);
            return { ok: true, message: "Gentle library unlocked with PIN." };
        }
        return { ok: false, message: (0, pinRateLimiter_1.formatRemainingAttemptsMessage)(decision.remainingAttempts) };
    }
    /** Verify a PIN against the stored hash. Supports both the current scrypt
     *  format (`scrypt$N$r$p$salt$hash`) and the legacy unsalted SHA-256 format,
     *  which is transparently re-hashed to scrypt on the first successful login. */
    verifyGentlePin(pin) {
        const storedHash = this.getSetting("gentle_pin_hash");
        if (!storedHash) {
            return false;
        }
        const normalized = this.normalizePin(pin);
        if (storedHash.startsWith("scrypt$")) {
            return this.verifyScryptPin(normalized, storedHash);
        }
        // Legacy format: unsalted SHA-256 hex digest.
        const legacyMatch = storedHash ===
            node_crypto_1.default.createHash("sha256").update(normalized, "utf8").digest("hex");
        if (!legacyMatch) {
            return false;
        }
        // Transparent upgrade: replace the weak legacy hash with a scrypt one.
        try {
            this.setGentlePin(normalized);
        }
        catch {
            // Upgrading the stored hash is best-effort; verification still succeeds.
        }
        return true;
    }
    getStarterPinHint() {
        return STARTER_PIN;
    }
    getMetadataSettings() {
        const raw = this.getSetting("metadata_settings");
        if (!raw) {
            return { ...DEFAULT_METADATA_SETTINGS };
        }
        try {
            const parsed = JSON.parse(raw);
            return {
                tmdbReadAccessToken: typeof parsed.tmdbReadAccessToken === "string"
                    ? parsed.tmdbReadAccessToken
                    : DEFAULT_METADATA_SETTINGS.tmdbReadAccessToken,
                language: typeof parsed.language === "string" && parsed.language.trim()
                    ? parsed.language
                    : DEFAULT_METADATA_SETTINGS.language,
                region: typeof parsed.region === "string" && parsed.region.trim()
                    ? parsed.region
                    : DEFAULT_METADATA_SETTINGS.region,
                autoFetchWebPosters: typeof parsed.autoFetchWebPosters === "boolean"
                    ? parsed.autoFetchWebPosters
                    : DEFAULT_METADATA_SETTINGS.autoFetchWebPosters,
                tmdbNonCommercialUse: typeof parsed.tmdbNonCommercialUse === "boolean"
                    ? parsed.tmdbNonCommercialUse
                    : DEFAULT_METADATA_SETTINGS.tmdbNonCommercialUse,
                sourceProfile: parsed.sourceProfile === "adult-first" ||
                    parsed.sourceProfile === "mainstream-first" ||
                    parsed.sourceProfile === "local-only"
                    ? parsed.sourceProfile
                    : DEFAULT_METADATA_SETTINGS.sourceProfile
            };
        }
        catch {
            return { ...DEFAULT_METADATA_SETTINGS };
        }
    }
    setMetadataSettings(settings) {
        this.setSetting("metadata_settings", JSON.stringify(settings));
    }
    getOrganizationSettings() {
        const raw = this.getSetting("organization_settings");
        if (!raw) {
            return { ...organizationTemplates_1.DEFAULT_ORGANIZATION_SETTINGS };
        }
        try {
            const parsed = JSON.parse(raw);
            return {
                normalPathTemplate: typeof parsed.normalPathTemplate === "string" && parsed.normalPathTemplate.trim()
                    ? parsed.normalPathTemplate
                    : organizationTemplates_1.DEFAULT_ORGANIZATION_SETTINGS.normalPathTemplate,
                gentlePathTemplate: typeof parsed.gentlePathTemplate === "string" && parsed.gentlePathTemplate.trim()
                    ? parsed.gentlePathTemplate
                    : organizationTemplates_1.DEFAULT_ORGANIZATION_SETTINGS.gentlePathTemplate,
                fileNameTemplate: typeof parsed.fileNameTemplate === "string" && parsed.fileNameTemplate.trim()
                    ? parsed.fileNameTemplate
                    : organizationTemplates_1.DEFAULT_ORGANIZATION_SETTINGS.fileNameTemplate,
                normalLibraryPath: typeof parsed.normalLibraryPath === "string" ? parsed.normalLibraryPath : "",
                gentleLibraryPath: typeof parsed.gentleLibraryPath === "string" ? parsed.gentleLibraryPath : ""
            };
        }
        catch {
            return { ...organizationTemplates_1.DEFAULT_ORGANIZATION_SETTINGS };
        }
    }
    setOrganizationSettings(settings) {
        this.setSetting("organization_settings", JSON.stringify(settings));
    }
    static DEFAULT_PLAYER_SETTINGS = {
        defaultVolume: 1,
        subtitleFontSize: 20,
        subtitleColor: "#ffffff",
        autoPlayNext: false,
        rememberPosition: true,
        seekDuration: 10,
        videoFilterPreset: "none",
        videoFilterStrength: 50
    };
    getPlayerSettings() {
        const raw = this.getSetting("player_settings");
        if (!raw)
            return { ...DatabaseClient.DEFAULT_PLAYER_SETTINGS };
        try {
            const parsed = JSON.parse(raw);
            const d = DatabaseClient.DEFAULT_PLAYER_SETTINGS;
            return {
                defaultVolume: typeof parsed.defaultVolume === "number" ? parsed.defaultVolume : d.defaultVolume,
                subtitleFontSize: typeof parsed.subtitleFontSize === "number" ? parsed.subtitleFontSize : d.subtitleFontSize,
                subtitleColor: typeof parsed.subtitleColor === "string" ? parsed.subtitleColor : d.subtitleColor,
                autoPlayNext: typeof parsed.autoPlayNext === "boolean" ? parsed.autoPlayNext : d.autoPlayNext,
                rememberPosition: typeof parsed.rememberPosition === "boolean" ? parsed.rememberPosition : d.rememberPosition,
                seekDuration: typeof parsed.seekDuration === "number" ? parsed.seekDuration : d.seekDuration,
                videoFilterPreset: parsed.videoFilterPreset === "vivid" ||
                    parsed.videoFilterPreset === "warm" ||
                    parsed.videoFilterPreset === "cool" ||
                    parsed.videoFilterPreset === "mono" ||
                    parsed.videoFilterPreset === "sepia"
                    ? parsed.videoFilterPreset
                    : d.videoFilterPreset,
                videoFilterStrength: typeof parsed.videoFilterStrength === "number"
                    ? Math.max(0, Math.min(100, parsed.videoFilterStrength))
                    : d.videoFilterStrength
            };
        }
        catch {
            return { ...DatabaseClient.DEFAULT_PLAYER_SETTINGS };
        }
    }
    setPlayerSettings(settings) {
        this.setSetting("player_settings", JSON.stringify(settings));
    }
    getPlaybackCheckpoint(movieId) {
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
    savePlaybackCheckpoint(movieId, positionSeconds) {
        const checkpoints = this.getPlaybackCheckpoints();
        const entry = {
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
    clearPlaybackCheckpoint(movieId) {
        const checkpoints = this.getPlaybackCheckpoints();
        if (!checkpoints[movieId]) {
            return;
        }
        delete checkpoints[movieId];
        this.setPlaybackCheckpoints(checkpoints);
    }
    getScanHistory() {
        const raw = this.getSetting("scan_history");
        if (!raw) {
            return [];
        }
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) {
                return [];
            }
            return parsed
                .filter((entry) => {
                if (!entry || typeof entry !== "object")
                    return false;
                const candidate = entry;
                return typeof candidate.createdAt === "string" && !!candidate.summary;
            })
                .slice(0, MAX_SCAN_HISTORY_ENTRIES);
        }
        catch {
            return [];
        }
    }
    appendScanHistory(summary) {
        const history = this.getScanHistory();
        history.unshift({
            createdAt: new Date().toISOString(),
            summary
        });
        this.setSetting("scan_history", JSON.stringify(history.slice(0, MAX_SCAN_HISTORY_ENTRIES)));
    }
    createSubtitleId(movieId, subtitlePath) {
        return node_crypto_1.default
            .createHash("sha1")
            .update(`${movieId}:${subtitlePath}`)
            .digest("hex");
    }
    createMovieId(sourcePath) {
        return node_crypto_1.default.createHash("sha1").update(sourcePath).digest("hex");
    }
    close() {
        this.db.close();
    }
    getSubtitles(movieId) {
        const rows = this.db
            .prepare("SELECT * FROM subtitles WHERE movie_id = ? ORDER BY language ASC")
            .all(movieId);
        return rows.map((row) => ({
            id: row.id,
            language: row.language,
            path: row.path
        }));
    }
    hydrateMovie(row, subtitles, matchSnippet = null) {
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
            updatedAt: row.updated_at,
            ...(matchSnippet ? { matchSnippet } : {})
        };
    }
    safeJsonArray(value) {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        }
        catch {
            return [];
        }
    }
    getPlaybackCheckpoints() {
        const raw = this.getSetting("player_playback_checkpoints");
        if (!raw) {
            return {};
        }
        try {
            const parsed = JSON.parse(raw);
            const normalized = {};
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
        }
        catch {
            return {};
        }
    }
    setPlaybackCheckpoints(checkpoints) {
        const trimmedEntries = Object.entries(checkpoints)
            .sort((left, right) => right[1].updatedAt.localeCompare(left[1].updatedAt))
            .slice(0, MAX_PLAYBACK_CHECKPOINTS);
        this.setSetting("player_playback_checkpoints", JSON.stringify(Object.fromEntries(trimmedEntries)));
    }
    migrate() {
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
            this.setGentlePin(STARTER_PIN.normalize("NFKC"));
        }
        if (!this.getSetting("theme_mode")) {
            this.setThemeMode(DEFAULT_THEME_MODE);
        }
        if (!this.getSetting("metadata_settings")) {
            this.setMetadataSettings(DEFAULT_METADATA_SETTINGS);
        }
        if (!this.getSetting("organization_settings")) {
            this.setOrganizationSettings(organizationTemplates_1.DEFAULT_ORGANIZATION_SETTINGS);
        }
        if (!this.getSetting("scan_history")) {
            this.setSetting("scan_history", JSON.stringify([]));
        }
        this.ensureColumn("movies", "poster_url", "ALTER TABLE movies ADD COLUMN poster_url TEXT");
        this.ensureColumn("movies", "poster_source", "ALTER TABLE movies ADD COLUMN poster_source TEXT NOT NULL DEFAULT 'none'");
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
        this.ensureColumn("movies", "source_missing", "ALTER TABLE movies ADD COLUMN source_missing INTEGER NOT NULL DEFAULT 0");
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_movies_missing ON movies(source_missing) WHERE source_missing = 1");
        // First run after an upgrade (or after scans done by an older build):
        // reconcile the flag against the real filesystem so search never shows
        // stale results before the first background sweep fires. Idempotent and
        // proportional to library size; acceptable at construction time.
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
        const galleryCount = this.db.prepare("SELECT COUNT(*) AS n FROM actress_photo_gallery").get();
        if (galleryCount.n === 0) {
            const primaryRows = this.db
                .prepare("SELECT name, photo_url, updated_at FROM actress_photos")
                .all();
            for (const row of primaryRows) {
                this.db
                    .prepare(`INSERT OR IGNORE INTO actress_photo_gallery (id, name, photo_url, sort_order, created_at)
             VALUES (?, ?, ?, ?, ?)`)
                    .run(this.createActressPhotoId(row.name, row.photo_url), row.name, row.photo_url, 0, row.updated_at);
            }
        }
    }
    getActressPhoto(name) {
        const row = this.db
            .prepare("SELECT photo_url FROM actress_photos WHERE name = ?")
            .get(name);
        return row?.photo_url ?? null;
    }
    setActressPhoto(name, photoUrl) {
        this.setPrimaryActressPhoto(name, photoUrl);
    }
    removeActressPhoto(name, photoUrl) {
        if (photoUrl) {
            this.db
                .prepare("DELETE FROM actress_photo_gallery WHERE name = ? AND photo_url = ?")
                .run(name, photoUrl);
            const galleryRows = this.getActressPhotos(name);
            if (galleryRows.length > 0) {
                this.setPrimaryActressPhoto(name, galleryRows[0]);
            }
            else {
                this.db.prepare("DELETE FROM actress_photos WHERE name = ?").run(name);
            }
            return;
        }
        this.db.prepare("DELETE FROM actress_photo_gallery WHERE name = ?").run(name);
        this.db.prepare("DELETE FROM actress_photos WHERE name = ?").run(name);
    }
    getAllActressPhotos() {
        const rows = this.db
            .prepare("SELECT name, photo_url, sort_order, created_at FROM actress_photo_gallery ORDER BY name ASC, sort_order DESC, created_at DESC")
            .all();
        const result = {};
        for (const row of rows) {
            if (!(row.name in result)) {
                result[row.name] = row.photo_url;
            }
        }
        return result;
    }
    deleteActressPhoto(name) {
        this.removeActressPhoto(name);
    }
    getSetting(key) {
        const row = this.db
            .prepare("SELECT value FROM settings WHERE key = ?")
            .get(key);
        return row?.value ?? null;
    }
    setSetting(key, value) {
        this.db
            .prepare(`
          INSERT INTO settings (key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `)
            .run(key, value);
    }
    ensureColumn(table, column, ddl) {
        const columns = this.db.prepare(`PRAGMA table_info(${table})`).all();
        if (columns.some((entry) => entry.name === column)) {
            return;
        }
        this.db.exec(ddl);
    }
    static SCRYPT_KEYLEN = 32;
    static SCRYPT_COST = 16384; // N — ~16 MiB memory per hash
    static SCRYPT_BLOCK_SIZE = 8; // r
    static SCRYPT_PARALLELIZATION = 1; // p
    /** Hash a PIN with scrypt (Node's memory-hard KDF, no native deps needed).
     *  Format: `scrypt$N$r$p$saltB64$hashB64` — everything needed to verify
     *  later is embedded in the stored string, so parameter changes stay
     *  self-describing. */
    /** Cached existsSync for movie source paths (see field docs). */
    cachedFileExists(sourcePath) {
        const now = Date.now();
        if (now - this.fileExistsCacheLastSweep > DatabaseClient.FILE_EXISTS_CACHE_TTL_MS) {
            this.fileExistsCacheLastSweep = now;
            for (const [key, entry] of this.fileExistsCache) {
                if (now - entry.checkedAt > DatabaseClient.FILE_EXISTS_CACHE_TTL_MS) {
                    this.fileExistsCache.delete(key);
                }
            }
        }
        const cached = this.fileExistsCache.get(sourcePath);
        if (cached && now - cached.checkedAt <= DatabaseClient.FILE_EXISTS_CACHE_TTL_MS) {
            return cached.exists;
        }
        const exists = (0, node_fs_1.existsSync)(sourcePath);
        this.fileExistsCache.set(sourcePath, { exists, checkedAt: now });
        if (this.fileExistsCache.size > DatabaseClient.FILE_EXISTS_CACHE_MAX_ENTRIES) {
            // Drop oldest-inserted entries (Map preserves insertion order).
            for (const key of this.fileExistsCache.keys()) {
                this.fileExistsCache.delete(key);
                if (this.fileExistsCache.size <= DatabaseClient.FILE_EXISTS_CACHE_MAX_ENTRIES) {
                    break;
                }
            }
        }
        return exists;
    }
    /** Drop cache entries for paths whose on-disk existence may just have changed. */
    invalidateFileExistsCache(...sourcePaths) {
        for (const sourcePath of sourcePaths) {
            if (sourcePath) {
                this.fileExistsCache.delete(sourcePath);
            }
        }
    }
    hashPin(pin) {
        const salt = node_crypto_1.default.randomBytes(16);
        const derived = node_crypto_1.default.scryptSync(this.normalizePin(pin), salt, DatabaseClient.SCRYPT_KEYLEN, {
            N: DatabaseClient.SCRYPT_COST,
            r: DatabaseClient.SCRYPT_BLOCK_SIZE,
            p: DatabaseClient.SCRYPT_PARALLELIZATION,
            maxmem: 256 * DatabaseClient.SCRYPT_COST * DatabaseClient.SCRYPT_BLOCK_SIZE
        });
        return [
            "scrypt",
            DatabaseClient.SCRYPT_COST,
            DatabaseClient.SCRYPT_BLOCK_SIZE,
            DatabaseClient.SCRYPT_PARALLELIZATION,
            salt.toString("base64"),
            derived.toString("base64")
        ].join("$");
    }
    /** Constant-time comparison of a candidate PIN against a stored scrypt hash. */
    verifyScryptPin(normalizedPin, storedHash) {
        const parts = storedHash.split("$");
        if (parts.length !== 6 || parts[0] !== "scrypt") {
            return false;
        }
        const [, nRaw, rRaw, pRaw, saltB64, expectedB64] = parts;
        const N = Number.parseInt(nRaw, 10);
        const r = Number.parseInt(rRaw, 10);
        const p = Number.parseInt(pRaw, 10);
        if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
            return false;
        }
        try {
            const salt = Buffer.from(saltB64, "base64");
            const expected = Buffer.from(expectedB64, "base64");
            const derived = node_crypto_1.default.scryptSync(normalizedPin, salt, expected.length, {
                N,
                r,
                p,
                maxmem: 256 * N * r
            });
            return node_crypto_1.default.timingSafeEqual(derived, expected);
        }
        catch {
            // Malformed stored hash or KDF failure — treat as verification failure.
            return false;
        }
    }
    createActressPhotoId(name, photoUrl) {
        return node_crypto_1.default.createHash("sha1").update(`${name}:${photoUrl}`).digest("hex");
    }
    getNextActressPhotoSortOrder(name) {
        const row = this.db
            .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM actress_photo_gallery WHERE name = ?")
            .get(name);
        return row.next;
    }
}
exports.DatabaseClient = DatabaseClient;
