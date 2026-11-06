# Maintained installed runtime

The desktop updates in this work folder are version 1.0.24. The installed release was newer than the original TypeScript checkout, so `installed-update/` retains the complete working runtime alongside the source edits. Its JavaScript, renderer assets, package metadata, icons, and Sub-Gen script are intentionally versioned; dependencies, native binaries, user databases, test media, and installer archives are excluded.

The root TypeScript project remains useful for unit tests and source development. Its build is not a replacement for the maintained runtime snapshot: some previously installed features are present only in that snapshot. Port them back into the TypeScript project before replacing the deployed application with a root build.

Recent behavior:

- Folder and connected-drive scans catalog files in place, with cancellable drive reads and live progress. JAV identification uses codes in filenames or immediate parent folders and skips unidentified names; it does not classify video contents.
- The Library groups copies into one poster card, offers a copies toggle, and loads further pages automatically. The missing-file review renders 50 entries at a time.
- Device sharing provides a private local-network browser player with posters and subtitle controls. Gentle mode remains protected.
- Optional MP4 conversion preserves the original and verifies the output. Import validation checks download markers, changing file size/timestamps, media metadata, and start/end decoding. Sampled checks cannot guarantee detection of damage elsewhere in a file.
- Media processing finds a working FFmpeg/FFprobe executable, including the existing Windows WinGet installation when bundled executables cannot run. Sub-Gen uses its managed Python environment and existing models.

## Verification

Run `npm test`, `npx tsc -b --pretty false`, and `node --test tests/*.test.cjs`. Phone-sharing tests require localhost access.

The live regression scripts are `tests/runtime/missing-pagination.cjs`, `tests/runtime/duplicate-posters.cjs`, `tests/runtime/infinite-scroll.cjs`, and `tests/runtime/video-import.cjs`. Each accepts a runtime folder or app archive as its first argument and uses an isolated profile under `diagnostics/`. Set `MLA_TEST_EXECUTABLE` to the installed executable to test an installed release; otherwise the scripts use the development Electron dependency. Set `EXPECT_PAGED=1` for the missing-file pagination assertions. The video-import check generates synthetic media and checks conversion, source preservation, unfinished/corrupt file rejection, and overwrite protection.

Before packaging, install the snapshot's dependencies with the Electron-compatible native ABI. Package `installed-update/` with `@electron/asar`, unpacking native `.node`, `.exe`, and `.dll` files. Keep new packages and installation backups under ignored `diagnostics/`. Do not package a user profile, library database, model download, or generated test video.

The root build runs scripts/copy-runtime-assets.cjs after TypeScript and Vite so CommonJS service helpers and renderer support assets accompany the compiled output. Playwright discovers only .spec.ts files; run the Node service tests separately.
