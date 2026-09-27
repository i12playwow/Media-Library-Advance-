# MLA+ Copilot Instructions

## Project Overview
MLA+ is a Windows desktop media management app built with **Electron + React + TypeScript + SQLite (better-sqlite3) + FFmpeg**.

- **Main process:** `app/main/` (TypeScript, compiled to `dist/main/`)
- **Renderer process:** `app/renderer/src/` (React + TypeScript, bundled by Vite)
- **Preload script:** `app/main/preload.ts`
- **Database layer:** `app/database/database.ts`
- **Build tool:** Vite (renderer), tsc (main)
- **Packager:** electron-builder → NSIS installer for Windows

## Tech Stack
- Electron 35
- React 18
- TypeScript 5
- better-sqlite3 (synchronous SQLite in main process)
- FFmpeg / FFprobe (via ffmpeg-static / ffprobe-static)
- Vite 6

## Conventions
- Use **TypeScript** strictly — avoid `any` where possible.
- IPC communication goes through the **preload bridge** (`contextBridge`) — never expose Node/Electron APIs directly to the renderer.
- Database access is **main-process only** — renderer must use IPC to query data.
- Prefer **functional React components** with hooks; no class components.
- CSS lives in `app/renderer/src/styles.css` (global) and co-located component files.
- Keep FFmpeg/FFprobe invocations in the main process; stream results back via IPC events.

### Adding a new IPC feature
Every new IPC call requires changes in **three files**:
1. `app/main/main.ts` — register the handler: `ipcMain.handle("domain:action", async (_, ...args) => { ... })`
2. `app/main/preload.ts` — add a method to the `api` object calling `ipcRenderer.invoke("domain:action", ...)`
3. `app/renderer/src/types.d.ts` — extend the `desktopApi` interface on `Window`

IPC channels follow the `domain:action` naming pattern. Existing domains: `app`, `settings`, `movies`, `scan`, `library`, `auth`, `actress`, `player`, `duplicates`, `subtitle`, `shell`.

### Database layer
- `database.ts` stores rows in `snake_case`; all exported types use `camelCase`. Conversion happens in `rowToMovieRecord()` — follow this pattern for any new row types.
- Settings (metadata, organization, player, library roots, subtitle dirs, gentle PIN) are stored as JSON blobs in a key/value `settings` table; `app:getState` loads them all at startup.

## Dev Workflow
```bash
npm run dev          # Start full dev environment (renderer + main + electron)
npm run build        # Build main + renderer
npm run dist         # Build + package into installer
npm run poster:backfill  # One-off: backfill missing posters for all DB movies

# Type-check without emitting (run both after any cross-boundary change)
npx tsc --noEmit -p tsconfig.main.json      # main + services + database + shared
npx tsc --noEmit -p tsconfig.renderer.json  # renderer + shared
```

There is no test suite — type-checking is the primary correctness tool.

## Current Feature Areas

### Pages / Navigation
- **Home** — landing page with sample poster cards and quick-start UI
- **Library** — paginated movie grid with poster display, bulk selection, and mode-move actions
- **Search** — full-text search across the movie library
- **Actresses** — actress roster with photo management (set/refresh photos)
- **Player** — in-app video player with subtitle support (online fetch + download, `.srt/.vtt/.ass/.ssa`), volume/font/color/auto-play/resume settings
- **Settings** — TMDB API token, language/region, auto-fetch posters, library roots, organization templates, subtitle directories

### Library Modes
- **Normal mode** — standard movie library
- **Gentle mode** — PIN-locked secondary library (`auth:unlockGentle`); movies can be moved between modes (`movies:moveMode`, `movies:batchMoveMode`)

### Library Scanning
- Folder picker scan (`movies:pickScan`) and full library rescan (`movies:scan`)
- Automation options: import-only-complete, import-better-quality, auto-resolve duplicates, move/rename, copy-to-library, scan-all-subfolders, resolve-long-path, auto-convert-to-MP4, auto-match subtitle, target library mode
- Real-time progress events (`scan:progress`) with stages: `preparing → discovering → processing → completed/cancelled/error`
- Cancellation support (`scan:cancel`)
- Rejected file reporting (incomplete / corrupt / invalid) and duplicate group resolution (`duplicates:resolve`)
- Manual file add (`movies:addFiles`)

### Metadata & Posters
- TMDB integration via `metadataService.ts` — fetches title, year, poster by video ID
- Poster sources: `none | local | web`
- Ensure/refresh posters for selected movies (`movies:ensurePosters`, `movies:refreshPosters`)
- Backfill all missing posters (`movies:backfillPosters`)
- Actress photos: get, refresh, set from file picker (`actress:*`)

### Organization / File Layout
- Template tokens: `{dvdId}`, `{actress}`, `{title}`, `{year}`, `{studio}`
- Separate path templates for normal and gentle libraries plus a file-name template
- Logic lives in `app/shared/organizationTemplates.ts`; file I/O in `app/services/libraryLayout.ts`
- Writes `.nfo` sidecar files alongside videos

### Video ID Extraction
- `app/shared/videoId.ts` — parses DVD/video IDs from filenames (e.g. `ABC-123`)

### Subtitle Management
- Subtitle directories: add/remove/scan (`subtitle:addDir`, `subtitle:removeDir`, `subtitle:scan`)
- Online subtitle search and download via player IPC (`player:fetchSubtitles`, `player:downloadSubtitle`)
- Supported formats: `.srt`, `.vtt`, `.ass`, `.ssa`

### Database (`app/database/database.ts`)
- SQLite via `better-sqlite3` (synchronous, main-process only)
- Stores movies, actresses, subtitles, settings (metadata, organization, player, library roots, subtitle dirs, gentle-mode PIN)

### Services (`app/services/`)
- `libraryScanner.ts` — discovers, probes, deduplicates, and imports video files
- `metadataService.ts` — TMDB poster/metadata fetching; actress photo fetching
- `ffmpegService.ts` — video probing (ffprobe) and conversion (ffmpeg)
- `fileService.ts` — file system utilities (move, copy, long-path handling)
- `libraryLayout.ts` — builds target paths from templates, writes `.nfo` files

## Key Implementation Details

### `app/services/libraryScanner.ts` + `app/main/main.ts`
- **`registerLocalFiles()`** — imports existing video files into the library *in-place* (no move/copy), registered via `movies:addFiles` IPC handler
- `DEFAULT_SCAN_OPTIONS` exported from scanner and used as the default in `movies:scan`
- `extractVideoIdCandidates` used for multi-candidate video ID extraction

### `app/services/fileService.ts`
- `moveFile()` has **retry logic** (5× with 300 ms back-off) for `EBUSY`/`EPERM` on Windows
- Cross-device (`EXDEV`) and permission (`EPERM`/`EACCES`) errors fall back to copy+delete
- `cleanupDirectory()` ignores `Thumbs.db`, `desktop.ini`, `.DS_Store` before deciding to `rm -rf`
- `moveMovieToMode()` wraps `moveFile()` with user-friendly error messages (EPERM, EACCES, ENOSPC)

### `app/database/database.ts`
- **SQLite performance pragmas**: `synchronous = NORMAL`, `cache_size = 64 MB`, `temp_store = MEMORY`, `mmap_size = 256 MB`
- **Indexes** on `movies(library_mode, updated_at DESC)`, `movies(video_id)`, `subtitles(movie_id)`

### `app/renderer/src/App.tsx`
- **Player improvements**: fullscreen toggle, config panel (click-outside-to-close), volume/mute/rate synced imperatively to `<video>`, playback position memory (`rememberPosition`)
- **Auto-resolve duplicates**: `autoResolveDuplicateGroups(groups, gentleUnlocked)` helper called by both `handleScanSaved` and `handleConfirmScanOptions`; reports `blocked` count for gentle-library files that need unlock
- Subtitle scraping from **subtitlecat.com** — HTML-parsed rows with regex for download URLs, language, title

## UI Patterns
- **Single-file renderer** — all pages and components live in `App.tsx` (large file, ~3000+ lines); no component subdirectory yet
- State is managed with `useState` / `useRef` at the top-level `App()` component
- `useDeferredValue` used for search input to avoid blocking renders
- `startTransition` used for non-urgent state updates (e.g. page navigation)
- Posters rendered with a CSS gradient fallback when `posterUrl` is null (`getPosterFallbackBackground`)
- Drag threshold (`MIN_DRAG_THRESHOLD = 5px`) to distinguish click vs drag in the library grid
- Player config panel uses `mousedown` outside-click detection anchored to `playerConfigRef`
- IPC calls use `async/await` directly in event handlers; errors shown via `setStatusMessage`
- Player subtitle state uses two paired variables: `playerSubTrackUrl` (blob URL) and `playerSubTrackLang` (BCP-47 code, e.g. `"en"`, `"ja"`); both are set together in `applySubtitle(content, lang)`
- Shared async logic extracted into helper functions inside `App()` (e.g. `autoResolveDuplicateGroups`) rather than duplicated across handlers

## Notes
- `ffmpeg-static` and `ffprobe-static` are unpacked from asar — paths must be resolved via `process.resourcesPath` in production.
- The app targets **Windows only** (NSIS installer).
- All renderer state lives in the single top-level `App()` component — `App.tsx` is intentionally large (~3000+ lines); component extraction is a future refactor.
- `player:downloadSubtitle` handles both `file:` (local, read via `fs.readFileSync`) and `http(s):` (remote, fetched via Node `fetch`) — Node's `fetch` does **not** support the `file:` protocol.
- `subtitle:scan` IPC handler is **async** — it uses `fs.promises.readdir` / `fs.promises.copyFile` / `fs.promises.unlink` to avoid blocking the main process on large subtitle directories.
