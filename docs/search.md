# Search: how movie search actually works

MLA+ has no full-text search engine. Search is SQL `LIKE` matching over five
columns of the `movies` table, owned entirely by `app/database/database.ts` —
`app/services/*` and `app/main/main.ts` never write movie SQL themselves.
This document is linted, not just written: the doc-drift lint
(`app/renderer/src/__tests__/docsSearchRefs.test.ts`) keeps the write-path
table and the read-path table below honest in both directions — every
`movies`-table write site and read site in database.ts — in a class method or
a module-level helper — must be documented here, and every method those
tables name must be a real statement in the code. When they disagree, `npm test` fails
(drift class 4), and the fix is almost always to change the code and the
table **together**.

## The query side

`listMovies` and `countMovies` build their filter from one clause:

```
(title LIKE ? OR video_id LIKE ? OR source_path LIKE ? OR actresses_json LIKE ? OR keywords_json LIKE ?)
```

Five searchable columns: `title`, `video_id`, `source_path`,
`actresses_json`, `keywords_json`. (SQLite's `LIKE` is case-insensitive for
ASCII by default, which is the search "folding" the app offers.) The same
options carry the gentle-mode filter (`includeGentle`, which gates on
`library_mode`) and pagination (`limit`/`offset`). Both query methods share
the clause; neither sorts by relevance — there is no relevance to sort by.

## The write-path table

Every method in `app/database/database.ts` that writes the `movies` table,
what it writes, and what that means for search. If you add a write site and
skip this table, the lint sends you back here.

| Method | Statement | Search-visible columns it touches | Notes |
|---|---|---|---|
| `upsertMovie` | `INSERT INTO movies … ON CONFLICT(id) DO UPDATE` | all five: `title`, `video_id`, `source_path`, `actresses_json`, `keywords_json` | the scanner's and fileService's main entry; the upsert `COALESCE`s incoming `video_id` and `poster_url` against the stored row, and keeps `poster_source` when the incoming poster is null |
| `deleteMovie` | `DELETE FROM subtitles WHERE movie_id = ?` + `DELETE FROM movies WHERE id = ?` | removes the row (and its subtitles) from search entirely | two statements, one method |
| `updateMovieLocation` | `UPDATE movies SET source_path, folder_path, library_mode, updated_at` | `source_path` | `folder_path` and `library_mode` are filters, not searched text |
| `updateMoviePoster` | `UPDATE movies SET poster_url, poster_source, updated_at` | none | posters are deliberately invisible to the search clause |
| `updateMovieVideoId` | `UPDATE movies SET video_id, updated_at` | `video_id` | metadataService's ID-correction path |

That is the complete set: five methods, one insert, three updates, one
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
| `listMovies` | `SELECT * FROM movies` + the five-column `LIKE` clause + `ORDER BY updated_at DESC, title ASC` | all five | the library grid's entry point; filters on `library_mode` unless `includeGentle`, and pages in memory after hiding rows whose file vanished |
| `countMovies` | `SELECT * FROM movies` + the same five-column `LIKE` clause | all five | the same filter family for counts; also hides vanished files before counting |
| `getMovie` | `SELECT * FROM movies WHERE id = ?` | none by clause | single-row detail lookup |
| `findMovieIdBySourcePath` | `SELECT id FROM movies WHERE source_path = ?` | `source_path`, exact match (no `LIKE`) | the dedupe/duplicate-check path |
| `getMovieByVideoId` | `SELECT id, title FROM movies WHERE LOWER(video_id) = LOWER(?)` | `video_id`, case-folded exact match | metadata import's id lookup |

That is the complete set: five readers — two clause-builders, two
single-purpose lookups, one id/title pair-fetch. `deleteMovie` also contains
the string `FROM movies`, but as a `DELETE` — a write-path row, not a read.
Any new `FROM movies` or `JOIN movies` statement in database.ts — class
method or module-level helper — must land in this table or `npm test` fails
(drift class 4); the conservation check fails separately if a read appears
in a shape the lint's unit scanner cannot slice.

## Why no FTS5

FTS5 exists in this repo exactly once: as the ABI gate's synthetic proof
(`scripts/lib/abi-state.cjs` creates a virtual table, inserts, and matches —
rule 1 of the ABI dance, proving the binding *works*, not that the app uses
the feature). The app itself never creates an FTS table. If a real
full-text stack ever lands here, this document is where its write-path table
goes — and the lint's class 4 is the pattern for policing it.
