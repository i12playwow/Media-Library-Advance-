# Library counts

The Library totals panel and sidebar use a database summary, not the currently loaded page. Cataloged movies includes registered missing-file entries. Available movies and Missing video files reflect the latest persisted availability check. Normal and Gentle mode totals are cataloged-entry counts; Gentle totals are returned and displayed only while Gentle mode is unlocked.

The display line separately reports poster cards shown, video entries loaded, and movies matching the current search. Copies can share a poster card, so card count can differ from video-entry count. Changing a search or loading more cards does not change the global cataloged totals. Counts refresh after loaded/result totals change and periodically while the view remains open. Older source databases without availability flags display unknown availability rather than reporting that files exist.

Tests: `tests/librarySummary.test.cjs` covers global totals, missing entries, locked-mode privacy, and older schemas. `tests/runtime/library-counts.cjs` verifies a 255-entry Normal catalog with 250 available movies, five missing files, an initial loaded page, and an independent one-result search in an isolated synthetic library.
