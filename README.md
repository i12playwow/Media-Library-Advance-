# MediaLibrary Plus

[![CI](https://github.com/Creative-hub554/medialibrary-plus/actions/workflows/ci.yml/badge.svg)](https://github.com/Creative-hub554/medialibrary-plus/actions/workflows/ci.yml)
[![ABI Contract Drill](https://github.com/Creative-hub554/medialibrary-plus/actions/workflows/drill.yml/badge.svg)](https://github.com/Creative-hub554/medialibrary-plus/actions/workflows/drill.yml)

MediaLibrary Plus is a Windows desktop app for organizing and browsing local video libraries, with a focus on JAV collections. It scans folders, filters supported video files, generates poster-based browsing views, organizes files into Normal and Gentle Mode workspaces, and provides a built-in player with subtitle support.

## What the app does

- Scans local folders for video files
- Filters supported media before importing
- Builds a browsable video library with poster cards
- Organizes content into Normal Mode and Gentle Mode
- Moves and renames video files using configurable templates
- Groups imported titles by actress
- Plays videos inside the app with subtitle search and local subtitle loading
- Manages library roots, subtitle folders, poster generation, and player preferences from Settings
- Supports TMDB title-based metadata fallback when the non-commercial use checkbox is enabled

## Main screens

### Home

- Start scans for Normal Mode or Gentle Mode
- Choose scan options before import
- Import only complete files
- Prefer better-quality files when duplicates are found
- Convert supported media to MP4 during import
- Move and rename files during import
- Auto-match local subtitle files during scanning
- Resolve long paths during organization
- Import directly into Normal Mode or Gentle Mode

### Library

- Browse all imported titles as poster cards
- Search titles by name, video ID, actress, or keyword with relevance-ranked results
- Switch between Normal Mode and Gentle Mode collections
- Batch select multiple titles
- Move selected videos between modes
- Regenerate posters for selected titles
- Select titles missing poster images
- Sort the library by actress, import date, DVD ID, recent additions, oldest, and newest
- Zoom the card grid in and out for denser or larger browsing

### Actresses

- View the library grouped by actress
- See actress profile images when available
- Refresh actress photos
- Open a context menu for actress profile actions
- Browse titles for a selected actress
- Filter actress browsing by Normal Mode, Gentle Mode, or all titles
- Adjust the actress card grid density

### Player

- Play imported videos inside the app
- Seek backward and forward with mouse and buttons
- Switch to fullscreen
- Control volume, mute, and playback speed
- Play the next or previous title in the library
- Load local subtitle files
- Search SubtitleCat by video ID or title
- Filter online subtitle search results by language
- Download and apply subtitles while watching
- Remember playback position when enabled in settings

### Settings

- Set Normal Mode and Gentle Mode library roots
- Choose library storage folders
- Configure the Gentle Mode unlock shortcut
- Set movie renaming and folder structure templates
- Configure subtitle folders and subtitle scanning
- Adjust player defaults like volume, subtitle size, and subtitle color
- Manage metadata poster settings
- Paste your TMDB v4 read access token in `Settings > Web posters > TMDB v4 read access token`
- Configure TMDB usage under its free non-commercial terms and attribution requirement
- Use light/dark app styling from the interface

## How the library works

- The app scans local video files from configured roots
- It validates files before import
- It prefers complete and higher-quality files when duplicates exist
- It parses video IDs and metadata from filenames
- It can fetch posters and actress metadata from online sources
- TMDB fallback is optional and requires explicit non-commercial use acknowledgment
- It generates local poster frames when needed
- It stores library records in a local SQLite database
- It keeps Normal Mode and Gentle Mode collections separate

## Library organization

MediaLibrary Plus uses configurable naming templates so imported files can be moved into a consistent folder structure. The app can organize files by title, actress, year, video ID, and other tokens defined in Settings.

Typical behavior:

- Scan local media
- Parse metadata from filenames
- Determine the target mode
- Move and rename the video
- Move matching subtitle files
- Write library metadata files where configured
- Clean up empty folders after moves

## Subtitle support

- Auto-match local subtitle files during import
- Import subtitle files from configured subtitle directories
- Search online subtitles from SubtitleCat
- Download subtitles in the selected language
- Apply downloaded subtitles in the built-in player

## Search

The library search box looks across titles, video IDs, file paths, actresses, and keywords. Results are ranked by relevance rather than import date alone.

- Multi-word queries match titles containing any of the words, and titles matching more of the words rank higher
- Ranking tiers, highest first: exact or whole title match → title contains the words → video ID match → actress match → keyword match → file path-only match
- Titles that tie within a tier fall back to import recency (newest first), then title A–Z
- Query terms of 1–2 characters use a simpler substring match because the full-text index (FTS5 trigram) only indexes terms of 3+ characters
- Matching text is highlighted on each result card so you can see why a title matched
- A Relevance / Date toggle above the library grid switches result ordering: Relevance uses the ranking above, Date restores pure import recency (the choice is remembered between sessions)
- A query uses at most 8 distinct words; repeated and extra words are ignored

Implementation notes for contributors: the ranking ladder lives in `app/database/database.ts` (`rankAndPage`), matched rows are fetched through the FTS5 index, and per-keystroke latency is tracked by `scripts/benchmark-file-exists-cache.mjs`. A full deep-dive — index lifecycle, integrity sweep, and the missing-file flag — is in [docs/search.md](docs/search.md).

## Gentle Mode

Gentle Mode is protected by a shortcut-based unlock flow.

- Default unlock shortcut: `Ctrl+Alt+D`
- Unlock applies to the current app session
- Gentle Mode content stays separate from Normal Mode content
- Gentle files are only fully accessible after unlock

## Development

```bash
npm install
npm run dev
```

For contributors: start with [CONTRIBUTING.md](CONTRIBUTING.md) — what the
enforcement stack checks and when. Code maps: [docs/architecture.md](docs/architecture.md)
(processes, IPC, data flows), [docs/testing.md](docs/testing.md) (the
two-runtime ABI dance), and [docs/search.md](docs/search.md) (search
internals).

## Scripts

- `npm run dev` - start the Electron development flow
- `npm run build` - type-check and build the app
- `npm start` - launch the packaged Electron app
- `npm test` - run the ABI gate (`pretest`), then the Vitest unit suite
- `npm run test:e2e` - Electron-ABI rebuild + gate (`pretest:e2e`), then build and the Playwright end-to-end suite

## Notes

- The app is Windows-first and uses Electron
- It stores its local database in the Electron user-data directory
- Metadata and poster fetching rely on online services and can fail if those services are unavailable
- TMDB usage is intended for free non-commercial projects with attribution
- Some UI items described in the product vision may still be partial or roadmap-only
