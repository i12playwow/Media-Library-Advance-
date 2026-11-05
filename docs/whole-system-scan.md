# Whole-system scan

Open **Scan library**, choose **Whole system — connected drives, no moving**, review the target mode, and click **Scan whole system (no moving)**. Gentle mode must be unlocked before importing into it.

The dedicated scanner discovers accessible drive roots, walks subfolders, and registers supported video extensions at their original paths. Matching subtitle files are registered for CC indicators. Already cataloged paths are skipped without changing their mode or metadata. It never calls move, rename, delete, convert, online subtitle download, poster-write, or library organization routines. Its summary deliberately contains no duplicate-deletion groups.

Windows/application folders, AppData, recycle bins, node_modules, .git, and symlinks/junctions are skipped. Permission errors are reported while other folders continue. Stop scan works during directory discovery and registration; entries already added remain. The scan does not add drive roots to saved-folder settings, so an ordinary later rescan cannot accidentally reorganize whole drives.

Sources: `app/services/wholeSystemScan.cjs`; the installed-version main/preload and scan-dialog integration is recorded in `scripts/add-whole-system-scan.cjs`. Tests: `node --test tests/wholeSystemScan.test.cjs`, and `node diagnostics/smoke-whole-system.cjs` against temporary drive roots. Live tests verify forced no-move controls, original bytes and paths, subtitle matching, skipping Windows folders, idempotence, and unchanged saved roots. No real whole-drive scan runs as part of installation.

Scan recovery improvements: drive traversal uses up to three workers; folder reads are limited to 12 seconds before that drive is skipped with a warning. Pending reads can be canceled promptly. Heartbeats show live folder counts even while waiting, and the progress bar stays indeterminate until discovery ends. Common application/development cache folders are excluded. The recovery smoke test simulates an indefinitely stalled read and verifies that Stop returns the interface to an idle state.
