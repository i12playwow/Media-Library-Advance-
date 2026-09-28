# Architecture: the IPC surface

MLA+ is an Electron app with a strict channel contract between the renderer
and the main process. The renderer never touches Node or the database; it
talks over `contextBridge` (`app/main/preload.ts` exposes `window.desktopApi`,
typed in `app/renderer/src/types.d.ts`), and `app/main/main.ts` answers.
This document is linted, not just written: the doc-drift lint
(`app/renderer/src/__tests__/docsSearchRefs.test.ts`) keeps its IPC surface
table honest in both directions — every prefix used in code must be
documented here, every prefix documented here must be used, and every named
channel must be real (registered with `ipcMain.handle` in main.ts). The
lint scans comment-stripped source — a commented-out handler, send, or
subscription is not evidence of a live channel — and a conservation check
requires every channel opening (`ipcMain.handle`, `invoke`, `send`,
subscription `on`) to carry a literal `prefix:name`, so a wrapper or
dynamic-channel refactor fails loudly instead of silently dropping the
surface out of the lint's view. When the
code and this table disagree, `npm test` fails, and the fix is almost always
to change the code and the doc **together**.

## The surface at a glance

The renderer calls `ipcRenderer.invoke(channel, ...)` through
`window.desktopApi`; main answers with `ipcMain.handle(channel, ...)`.
Main pushes unsolicited updates the other way with
`webContents.send(channel, ...)`; the renderer subscribes via
`desktopApi.on*` wrappers (`ipcRenderer.on`). Every channel name is
`prefix:action`. The prefixes (drift class 6 checks both directions against
this table):

| Prefix | Owns | Channels |
|---|---|---|
| `settings:*` | preferences and metadata/organization settings | `settings:getGentleShortcut`, `settings:setGentleShortcut`, `settings:verifyGentlePin`, `settings:getThemeMode`, `settings:setThemeMode`, `settings:saveMetadata`, `settings:saveOrganization`, `settings:pickLibraryFolder` |
| `gentle:*` | gentle mode state changes | `gentle:toggle` (invoke), `gentle:unlockResult` (push) |
| `auth:*` | the same gentle gate, named for who may call it | `auth:unlockGentle` (PIN), `auth:toggleGentle` (shortcut) |
| `app:*` | whole-shell snapshot | `app:getState` |
| `movies:*` | the library itself | `movies:list`, `movies:listAll`, `movies:count`, `movies:pickScan`, `movies:scan`, `movies:addFiles`, `movies:ensurePosters`, `movies:refreshPosters`, `movies:backfillPosters`, `movies:moveMode`, `movies:batchMoveMode` |
| `scan:*` | scan lifecycle | `scan:cancel` (invoke), `scan:progress` (push) |
| `library:*` | library roots | `library:addRoot` |
| `shell:*` | OS integration | `shell:openFile`, `shell:showInFolder` |
| `actress:*` | actress photos and regions | `actress:getPhotos`, `actress:getRegions`, `actress:getRegion`, `actress:refreshPhotos`, `actress:removePhoto`, `actress:listPhotos`, `actress:setPrimaryPhoto`, `actress:setRegion`, `actress:setPhoto` |
| `player:*` | playback | `player:fetchSubtitles`, `player:downloadSubtitle`, `player:installSubtitle`, `player:getSettings`, `player:saveSettings`, `player:getPlaybackCheckpoint`, `player:savePlaybackCheckpoint`, `player:clearPlaybackCheckpoint`, `player:getFileUrl`, `player:convertToMp4` |
| `subtitle:*` | subtitle generation and local subtitle directories | `subtitle:addDir`, `subtitle:removeDir`, `subtitle:scan`, `subtitle:generateForMovie`, `subtitle:getModelAvailability`, `subtitle:downloadModel`, `subtitle:previewOutput`, `subtitle:modelDownloadProgress` (push) |
| `duplicates:*` | duplicate resolution | `duplicates:resolve` |
| `guards:*` | guards-chain integrity state for the Settings page | `guards:getChainState`, `guards:listSegments` |

13 prefixes, 56 invoke channels (one `ipcMain.handle` each, all in main.ts),
3 push channels (one `webContents.send` each, all in main.ts, subscribed via
`onScanProgress`, `onGentleUnlockResult`, and
`onSubtitleModelDownloadProgress`).

Two invariants worth knowing beyond the table:

- **Every named channel is real.** Each of the 56 invoke channels has a
  matching `ipcMain.handle` in `app/main/main.ts` — the lint fails if an
  expose dangles or a handle has no expose. (Recreating this doc surfaced
  real rot: the `subtitle:addDir` / `subtitle:removeDir` / `subtitle:scan`
  handlers had been lost from main.ts while the renderer still called them,
  and `gentle:toggled` was a push channel main never sent — the handlers
  were rebuilt, the dead channel removed.)
- **Push channels are the only unsolicited traffic.** `gentle:unlockResult`
  (shortcut/PIN state changes), `scan:progress`, and
  `subtitle:modelDownloadProgress`. One subscription (`App.tsx`'s
  `onGentleUnlockResult`) reacts to gentle state; there is no second
  gentle push channel.

## Where behavior lives

- `app/main/main.ts` — every `ipcMain.handle`, the gentle-mode session
  state (`gentleUnlocked`, refiltering `movies:list` via `includeGentle`),
  the `MLA_USER_DATA_DIR` override (the e2e profile mechanism), and the
  three `webContents.send` push channels.
- `app/database/database.ts` — the single owner of the `movies` table's
  SQL (see [search.md](search.md) for the query side and the write-path
  table); `app/services/*` — scanner, file moves, metadata.
- `app/shared/contracts.ts` — the payload types (`AppShellState`,
  `MovieRecord`, `PlayerSettings`, the subtitle generation contract).
- `app/renderer/src/hooks/*` — the renderer's IPC clients:
  `useBootstrap` (initial `app:getState`), `useLibrary` (`movies:list` /
  `movies:count` and the gentle refilter), `useKeyboardShortcuts`
  (`auth:toggleGentle` on Ctrl+Alt+D), `useSettings`.
