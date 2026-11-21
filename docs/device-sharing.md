# Share to devices

The installed-version build adds a **Share to devices** button beside the desktop search box. Sharing starts off on every launch. Start it to see private local-network links; stop it to disconnect viewers and invalidate the links.

Phones, tablets, and computers on the same Wi-Fi can browse, search, and stream the Normal library. Gentle-library entries are excluded even if the desktop is unlocked. Media paths are never sent in catalog responses. The app exposes GET/HEAD only and serves videos selected by catalog ID, with byte ranges for seeking. Files remain on the PC or external disk. Both MLA+ and those disks must remain available. Browser codec support varies; the playback screen provides a stream URL for compatible players.

The listener uses TCP 48321, falling back to an available port if occupied. Links contain a fresh random 192-bit secret per sharing session. Access is restricted to private-network addresses. Do not publish the link. Windows firewall access should be limited to the app, Private profile, and LocalSubnet.

## Verify

Run `node --test tests/deviceShare.test.cjs` (requires loopback HTTP permission) and `node diagnostics/smoke-sharing.cjs` with a temporary profile to exercise desktop controls, phone playback, and link rotation.

The feature does not mount phone storage, provide SMB, or copy videos to phones. It provides browser streaming.

Poster artwork is delivered through authenticated poster-by-movie-ID routes. Saved image files and data images are supported; public HTTP(S) posters are fetched with bounded size, time, concurrency, and memory caching. Remote redirects are revalidated, private-address hosts are rejected, and phone responses never expose local poster paths. Unavailable artwork keeps a text fallback.

Phone playback has accessible play/pause, a seek timeline, ±10-second buttons, playback speed, mute, volume, and fullscreen controls. The native video player remains the fallback if enhancement fails to initialize. iOS native fullscreen is used when element fullscreen is unavailable. Some phones require hardware volume buttons. Poster artwork uses contain fitting to display its full bounds.
