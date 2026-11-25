# Search: how movie search actually works

Search is SQL matching over five columns of the `movies` table, owned
entirely by `app/database/database.ts` — `app/services/*` and
`app/main/main.ts` never write movie SQL themselves. This document is
linted, not just written: the doc-drift lint
(`app/renderer/src/__tests__/docsSearchRefs.test.ts`) keeps the write-path
table and the read-path table below honest in both directions — every
`movies`-table write site and read site in database.ts — in a class method or
a module-level helper — must be documented here, and every method those
tables name must be a real statement in the code. When they disagree, `npm test` fails
(drift class 4), and the fix is almost always to change the code and the
table **together**.

## The query side

`listMovies`, `countMovies` and `countMoviesByMode` share one clause builder,
`applySearchClause`. With the FTS5 trigram index (`movie_search`) available,
queries of 3+ characters run as a quoted MATCH phrase:

```
rowid IN (SELECT rowid FROM movie_search WHERE movie_search MATCH ?)
```

The query is wrapped as an FTS5 string literal (`ftsPhraseQuery`, embedded
double quotes doubled), and the trigram tokenizer gives it case-insensitive
substring semantics — the same behavior the LIKE path has. Shorter queries,
and every query on a SQLite build without FTS5, fall back to:

```
(title LIKE ? OR video_id LIKE ? OR source_path LIKE ? OR actresses_json LIKE ? OR keywords_json LIKE ?)
```

Five searchable columns: `title`, `video_id`, `source_path`,
`actresses_json`, `keywords_json`. (SQLite's `LIKE` is case-insensitive for
ASCII by default, which is the search "folding" the app offers.) The same
options carry the gentle-mode filter (`includeGentle`, which gates on
`library_mode`) and pagination (`limit`/`offset`). All three query methods share
the clause builder; none of them sorts by relevance — there is no relevance
to sort by.

All three hot paths also filter on the persisted `source_missing = 0` flag
(see the missing-file sweep below), so entries whose source file has
disappeared are excluded in SQL instead of a per-row `existsSync` pass.

## The write-path table

Every method in `app/database/database.ts` that writes the `movies` table,
what it writes, and what that means for search. If you add a write site and
skip this table, the lint sends you back here.

| Method | Statement | Search-visible columns it touches | Notes |
|---|---|---|---|
| `upsertMovie` | `INSERT INTO movies … ON CONFLICT(id) DO UPDATE` | all five: `title`, `video_id`, `source_path`, `actresses_json`, `keywords_json` | the scanner's and fileService's main entry; the upsert `COALESCE`s incoming `video_id`, `poster_url`, `studio` and `series` against the stored row, keeps `poster_source` when the incoming poster is null, and clears the stale `source_missing` flag (a scan only registers files that exist); `studio`/`series` are NFO-supplied labels shown on library cards and are never part of the FTS text |
| `deleteMovie` | `SELECT rowid FROM movies WHERE id = ?` + `DELETE FROM subtitles WHERE movie_id = ?` + `DELETE FROM movies WHERE id = ?` | removes the row (and its subtitles) from search entirely | fetches the rowid first so the FTS row can be unindexed |
| `updateMovieMode` | `UPDATE movies SET library_mode, updated_at` | none | moves a catalog record between libraries while preserving its source path |
| `updateMovieLocation` | `UPDATE movies SET source_path, folder_path, library_mode, updated_at` | `source_path` | `folder_path` and `library_mode` are filters, not searched text; re-indexes the row because `source_path` feeds the search text |
| `updateMovieStudioSeries` | `UPDATE movies SET studio = COALESCE(?, studio), series = COALESCE(?, series), updated_at = ?` | none | studio/series are card labels, not searched text; the `COALESCE` keeps a previously stored value when the argument is null, so an empty edit cannot erase what the NFO scan wrote |
| `updateMoviePoster` | `UPDATE movies SET poster_url, poster_source, updated_at` | none | posters are deliberately invisible to the search clause; `poster_source` carries the specific web source (`javdatabase`/`javbus`/`imdb`/`tmdb`, legacy `web`, or `local`) so the UI can attribute each cover |
| `updateMovieVideoId` | `UPDATE movies SET video_id, updated_at` | `video_id` | metadataService's ID-correction path |
| `setMovieDisplayName` | `UPDATE movies SET display_name, updated_at` | none | per-video display-name override; a blank name is stored as `NULL` so the tile falls back to the original title |
| `sweepMissingMovies` | `SELECT * FROM movies` (stat pass) + `UPDATE movies SET source_missing = ?, updated_at` per changed row, one transaction | none (the flag is a filter, not searched text) | the missing-file sweep: fresh-stats every source path, persists the outcome into `source_missing`, and re-syncs the search index if any write path drifted |

That is the complete set: eight methods, one insert, six updates, one
delete-pair. The remaining `UPDATE`/`DELETE` statements in database.ts touch
other tables (`subtitles`, `settings`, `actress_*`) and are out of this
table's scope — the lint keys on `movies`-table statements specifically.
Both tables also pin each listed method's complete string-literal
inventory (double-quoted and template literals alike): a statement that
gains a literal it did not document — a widened `WHERE`, an extra clause —
fails `npm test` even when the documented SQL still appears inside it.

## The read-path table

The query side has its own table, enforced the same way: every statement in
database.ts that selects from or joins the `movies` table, what it fetches,
and how it relates to search.

| Method | Statement | Reads the search columns? | Notes |
|---|---|---|---|
| `applySearchClause` | the FTS MATCH subquery or the five-column `LIKE` clause | all five | the shared clause builder for the three hot paths below; a registered unit of its own so the lint can pin both branches |
| `listMovies` | `SELECT * FROM movies` + `source_missing = 0` + the shared search clause + `ORDER BY updated_at DESC, title ASC` | all five | the library grid's entry point; filters on `library_mode` unless `includeGentle`, then pages in memory |
| `countMovies` | `SELECT * FROM movies` + `source_missing = 0` + the shared search clause | all five | the same filter family for counts |
| `countMoviesByMode` | `SELECT * FROM movies` + `source_missing = 0` + the shared search clause | all five | one scan reports the whole `total`/`normal`/`gentle` split for the sidebar's library snapshot; its `total` equals `countMovies` for the same options |
| `getMovie` | `SELECT * FROM movies WHERE id = ?` | none by clause | single-row detail lookup |
| `findMovieIdBySourcePath` | `SELECT id FROM movies WHERE source_path = ?` | `source_path`, exact match (no `LIKE`) | the dedupe/duplicate-check path |
| `getMovieByVideoId` | `SELECT id, title FROM movies WHERE LOWER(video_id) = LOWER(?)` | `video_id`, case-folded exact match | metadata import's id lookup |
| `listNoPosterNonAvIds` | `SELECT id, title, source_path FROM movies WHERE (poster_url IS NULL OR poster_url = '') AND video_id IS NULL` (+ optional `library_mode = 'normal'`) | `title` is fetched, but filtered on poster/video_id/mode, not searched text | poster regeneration's candidate list for non-AV entries |
| `listMissingMovies` | `SELECT * FROM movies ORDER BY updated_at DESC` | none by clause | fresh-stat review list; the missing filter runs as a JS `existsSync` pass after the fetch |
| `sweepMissingMovies` | `SELECT * FROM movies` | none by clause | one full fetch so every source path is stat'ed exactly once; also writes the flag (write-path table) |
| `relinkMovieSourcePath` | `SELECT source_path, folder_path FROM movies WHERE id = ?` + the FTS maintenance reads (rowid fetch, count probe, drift-join) | `source_path`, `folder_path` fetched, not searched text | absorbs the private FTS helpers (`ftsIndexMovie`, `ftsUnindexMovieRowid`, `setupFtsSearch`, `ensureFtsIndexIntegrity`) because the lint's unit scanner folds `private` members into the preceding visible unit |
| `rebuildFtsIndexNow` | `INSERT INTO movie_search(rowid, search_text) SELECT rowid, ${FTS_TEXT_SQL} FROM movies` | all five, via the indexed text expression | full re-index; `DELETE FROM movie_search` (the index, not `movies`) precedes it |
| `getFtsHealth` | `SELECT COUNT(*) AS c FROM movies` | none | Settings health readout; pairs with a `movie_search` COUNT probe |

That is the complete set: thirteen readers — the shared clause builder, three
clause-builder callers, five single-purpose lookups, the sweep pair, and the
three index-maintenance readers. `deleteMovie` also contains the string
`FROM movies` (its rowid fetch) plus a `DELETE FROM movies` — the delete is a
write-path row; the rowid fetch is registered on the write row's fragments.
Any new `FROM movies` or `JOIN movies` statement in database.ts — class
method or module-level helper — must land in this table or `npm test` fails
(drift class 4); the conservation check fails separately if a read appears
in a shape the lint's unit scanner cannot slice.

## The FTS5 search index

The app maintains one FTS5 virtual table, `movie_search` — a `search_text`
column tokenized with `trigram`, created lazily in `setupFtsSearch` when the
SQLite build supports it (this better-sqlite3 build does; the ABI gate in
`scripts/lib/abi-state.cjs` proves the same). Its content is the canonical
concatenation of the five searchable columns (`FTS_TEXT_SQL`), maintained
per write: `upsertMovie`, `updateMovieLocation`, `deleteMovie`, and
`relinkMovieSourcePath` re-index the affected rowid directly, and the
periodic sweep runs `ensureFtsIndexIntegrity` as a safety net that rebuilds
the whole table when counts or text drift. When FTS5 is unavailable the
index is never created and search transparently uses the LIKE path — search
behavior is identical either way.

## The missing-file sweep

A background sweep (`sweepMissingMovies`, every 30 seconds, started by the
main process) fresh-stats every row's `source_path` exactly once and
persists the outcome into the `movies.source_missing` flag — one partial
index (`idx_movies_missing`) keeps flagged rows cheap to exclude. Flagged
entries vanish from `listMovies`/`countMovies`/`countMoviesByMode` in SQL,
replacing the old per-row `existsSync` filtering. The Settings page's
Library health panel surfaces the sweep timestamps, history, and per-movie
relink/forget actions (`movies:relinkMissing` / `movies:forgetMissing`).

Library mode switch: `listMovies`, `countMovies` and `countMoviesByMode` accept an optional `mode` of `normal` or `gentle`. They add `library_mode = 'normal'` or `library_mode = 'gentle'` before pagination. The independent Gentle lock still applies, so requesting locked Gentle returns no rows. Counts use the same mode filter.
