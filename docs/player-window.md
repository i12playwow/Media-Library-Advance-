# Separate player window

The built-in player opens in a separate native app window from Library, actress profiles, the context menu, or Player navigation. It keeps the existing playback, playlist, subtitle, volume, speed, fullscreen and seek controls. Library and actress pages remain visible and retain browsing state. Opening another title reuses the player window; closing it leaves the library open, and closing the main app closes the player.

The main process owns a single BrowserWindow with context isolation, sandboxing and Node integration disabled. IPC validates the requesting webContents, resolves movie IDs through the library, and rejects locked Gentle titles. Locking Gentle closes a player showing a Gentle title. The player cannot create arbitrary new windows or navigate away from its app page.

Verification: tests/runtime/player-window.cjs uses copied synthetic speech videos and an isolated library. It verifies real video playback, Library and actress visibility, reuse, close/reopen, and locked-title rejection.
