# Subtitle controls during playback

Both players use the same subtitle workspace. Open **Subtitles** or **CC** on desktop, or **Subtitles** in the phone player. Saved SRT/VTT files appear first. Online search has one title/ID field, one language selector, and one Search action. Results offer **Download & apply**.

Applying captions does not reload the video or change its playback position. New downloads are saved with an exclusive filename beside the video and registered in the library. Existing files are not overwritten. If saving fails, captions still apply for the current session and the panel shows that they were not saved. Turn off disables captions without deleting files.

Subtitle downloads are restricted to search results for the selected movie. Phone endpoints retain Normal-library-only access and the sharing-link gate. Saving from phones requires a same-origin authenticated POST. Local subtitle paths are never accepted from the phone. The implementation rejects oversized files and downloads without timed captions.

Sources: `app/services/subtitleWorkspace.cjs`, `app/services/subtitleCat.ts`, `app/renderer/subtitle-workspace/`, and the phone integration in `app/renderer/device-share/`.

Build the installed-version staging directory with `node scripts/prepare-subtitle-workspace.cjs`. Verify with `node --test tests/subtitleWorkspace.test.cjs tests/deviceShare.test.cjs` and `node diagnostics/smoke-subtitle-workspace.cjs`. Live tests use deterministic mocked web results and temporary caption files; they verify both interfaces, saving, rendering captions, continuing playback, filtering language, and switching captions off. SubtitleCat availability and third-party results depend on its live service.

Speed improvements: up to five detail pages load concurrently while preserving ranked result order. Successful searches are cached for five minutes with a 64-query cap and shared in-flight requests. Desktop and phone workers share a bounded ten-minute caption-byte cache (at most eight files, two MiB per file). Reapplying a successfully saved result reuses it while its file still exists. Empty searches and failed downloads are not cached. The controlled 60 ms/request benchmark measured 403 ms before and 164 ms after, with the same five results; a repeated search issued zero requests. Live service timing depends on SubtitleCat and the connection.
