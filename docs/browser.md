# In-app browser

The browser is a second `BrowserWindow` (`dist/renderer/in-app-browser/`) whose chrome is a preload-bridged
renderer. Page content lives in `WebContentsView`s added as children of that window's `contentView`, offset
by `CONTENT_TOP` (104 px: a 70 px toolbar plus a 34 px tab strip). Nothing in the chrome scrolls the page
view: the menu and the find bar are overlays pinned under the toolbar.

Opening it is `app:openBrowser` from the main window; every control afterwards goes through the single
`browser:command` channel and comes back as a `browser:state` push.

Because the browser has its own preload (`inAppBrowserPreload.cjs`) and registers `browser:command` from
`app/services/inAppBrowser.cjs` rather than `main.ts`, the `browser:*` prefix is intentionally absent from
the IPC table in `docs/architecture.md` — drift class 6 only scans `app/main/preload.ts` and `main.ts`.

## Feature surface

The browser implements the Brave-style browsing options that Electron can actually honour. Rewards/BAT,
Wallet/crypto and VPN are deliberately out of scope.

| Area | What ships |
| --- | --- |
| Shields | Three levels (`strict`, `standard`, `off`), per-site overrides, categories for ads, trackers, fingerprinting and scripts, live counters, reset |
| Privacy | Third-party cookie signalling (`Sec-GPC`), Do Not Track, permissions denied for every origin, per-tab private partitions, clear-on-exit |
| Browsing | Tabs (12 max), private tabs, duplicate, close others, home, address-or-search input, search-engine choice, HTTPS upgrade |
| Reading | Zoom (25–500 %, remembered per site), find in page, reader mode |
| Library | History (2000 entries, de-duplicated per URL), bookmarks (500) |
| Downloads | Unchanged: link/video discovery, queue, pause/resume, verification-aware resume |

## Storage

Two JSON files in `userData`, both read defensively so a hand-edited file falls back to defaults:

- `browser-settings.json` — `app/services/browserSettings.cjs`. Preferences plus `siteSettings`, keyed by
  lowercased host, capped at 500 entries. `clampZoom` keeps values in 25–500.
- `browser-data.json` — `app/services/browserLibrary.cjs`. History and bookmarks in one file so a single
  atomic write keeps them consistent. `recordVisit` strips the hash, bumps a repeat visit to the top and
  increments `visits`; private tabs never call it.

## Shields

`app/services/adBlocker.cjs` is the engine. `classifyRequest(url, resourceType, pageOrigin, options)`
returns `{ block, category }` in this order:

1. level `off` → allow
2. allowlist (captchas, embeds, video CDNs) → allow
3. non-HTTP(S), `mainFrame`, or same-origin → allow
4. fingerprint pattern → `fingerprint`
5. ad host/pattern → `tracker` if the tracker rule also matches, else `ad`
6. tracker-only match → `tracker`
7. `strict` plus script blocking → `script`

`createShields` registers one `onBeforeRequest` per session, counts per category, and notifies the toolbar
on the first block and then every fifth (individual notifications would swamp the renderer). `attach()` is
idempotent per session, which is how private tabs get the same protection. `shouldBlock` and
`attachAdBlocker` remain as three-argument shims for older call sites.

`upgradeConnection` rewrites `http://` to `https://` except for `localhost`, `127.0.0.1` and `*.local`. It is
applied on navigation only when `upgradeToHttps` is on.

## Validation

- `tests/shields.test.cjs` — categories, level gating, per-switch behaviour, `upgradeConnection`, counting
  and notification throttling.
- `tests/browserSettings.test.cjs`, `tests/browserLibrary.test.cjs` — normalisation, clamping, caps,
  de-duplication, corrupt-file fallback, persistence across instances.
- `scripts/smoke-browser.cjs` — launches the built app against a scratch profile and drives the real IPC
  surface: zoom, shield levels, find bar, search-vs-address navigation, history contents, preferences
  persistence, tab create/duplicate/private/close-others, and the Ctrl+T / Ctrl+F shortcuts.
