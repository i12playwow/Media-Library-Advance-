# Whole-system scan

Open **Scan library**, choose **Whole system — connected drives, no moving**, select options, and click **Scan whole system (no moving)**. Gentle mode must be unlocked before importing into it.

The scanner discovers accessible connected drives and catalogs recognized JAV filenames or immediate movie folders at their original paths. Unidentified files are skipped. Matching local subtitles are registered for CC indicators. Existing movie paths retain their library mode and metadata.

The scan options include:

- **Skip unfinished or damaged videos**: checks download markers, file stability, media metadata, and start/end decoding. Sampling does not guarantee discovery of damage elsewhere in the video.
- **Convert to MP4 — keep original file**: optionally creates and verifies a new MP4 beside the source, preserving the source and refusing to overwrite an existing output.
- **Download from SubtitleCat when no local subtitle matches**: now selectable in whole-system mode. Choose a preferred language. Missing subtitles can be downloaded for new or already cataloged movies in the selected mode. Local subtitles are reused, including matching files not yet registered in the database. Network failures do not discard an imported movie; Stop remains responsive during subtitle searches.
- **Resolve long file paths for new MP4 and subtitle files**: now selectable without enabling file moves. Generated names are shortened, with a stable hash to distinguish names, to fit a 240-character output path budget. Original paths are unchanged. A folder that is itself too deep is reported rather than renamed.
- **Auto-resolve duplicate videos**: optionally keeps one preferred library entry while preserving video files on disk. This mode never returns disk-deletion groups to the ordinary duplicate cleanup dialog.

Windows/application folders, AppData, recycle bins, development caches, and symlinks/junctions are skipped. Permission errors are reported while other folders continue. Traversal uses up to three workers; a directory read that stalls for 12 seconds causes that drive to be skipped for this scan. Progress shows live folder counts while waiting. Stop works during discovery, registration, and subtitle searches; entries already added remain.

Drive roots are not saved as ordinary library folders, preventing a later folder rescan from accidentally organizing entire drives. A whole-system scan does not move or rename existing videos, write poster sidecars, or delete video files.

Implementation: `app/services/wholeSystemScan.cjs`, `app/services/scanSubtitleDownload.cjs`, and `app/services/generatedFilePath.cjs`. Service regressions run with `node --test tests/*.test.cjs`. The live scripts `tests/runtime/subtitle-scan.cjs` and `tests/runtime/long-path-option.cjs` verify selectable controls, caption saving, original-file preservation, and shortened output names with isolated profiles and synthetic media. They do not scan real drive roots.
