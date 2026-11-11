# Bulk library recovery

Double-click **Bulk-Library-Recovery.cmd** in the project folder. The script uses the latest completed integrity audit. It does not delete, rename, or overwrite original video files.

## Suggested order

1. **Preview** creates `recovery-output/plan.csv` and `needs-review.csv`. No catalog changes are made.
2. **Recheck** fully decodes the flagged videos. This can take hours for a large library. Completed checks resume when source size and modification time are unchanged.
3. **Repair copies** attempts a lossless container remux into `recovery-output/videos`. Each output must retain the source duration and pass a full video/audio decode. It does not use error-ignoring re-encoding. Active downloads, changing files, unreadable inputs and insufficient disk space are reported instead. Originals remain in place.
4. Review `recovery-results.csv` and play any proposed replacement. **Apply verified** relinks the library to accepted, unchanged verified copies after a database backup. Close MediaLibrary Plus first.
5. **Clean test entries** removes only the audited tiny diagnostic placeholders from the catalog, after rechecking their paths and size. Their files stay on disk.
6. **Remove missing entries** is optional. It removes audited entries only if their saved source is still absent and the drive is connected. It does not search other folders for a moved copy; relink those first. Close the app first.

A verified copy is fully decodable and has no unexpected duration reduction. It cannot prove that the original download contained the entire intended movie. Missing bytes and missing MP4 indexes usually require a clean download or backup. `needs-review.csv` includes every unresolved media warning; `replacement-needed.csv` selects unreadable inputs and sources explicitly found unrepairable. Review these lists before replacing files; the script has no download URLs or credentials.

## Command line

Run from this project folder:

```powershell
node scripts/bulk-library-recovery.cjs
node scripts/bulk-library-recovery.cjs --recheck
node scripts/bulk-library-recovery.cjs --repair --limit 5
node scripts/bulk-library-recovery.cjs --repair
```

The following explicitly change the catalog and create a backup in `recovery-output/backups`:

```powershell
node scripts/bulk-library-recovery.cjs --apply-verified --apply
node scripts/bulk-library-recovery.cjs --remove-test-entries --apply
node scripts/bulk-library-recovery.cjs --remove-missing-entries --apply
```

Without `--apply`, catalog actions remain preview-only. `--limit` cannot be combined with catalog actions. Repairs always create separate files. Existing output files without matching verification records are left untouched. Repeated repair runs reuse unchanged verified copies.

Use `--output "D:\Recovery"` for a disk with enough space; use the same output folder for later apply/resume commands. `--audit` accepts the latest-audit JSON or an audit directory's `summary.json`. `--catalog` is an explicit override for a different catalog. The default per-operation timeout is 120 minutes; change it with `--timeout-minutes`. `--limit` restricts the number of selected video jobs.

Requirements on this PC: Node.js, the project's installed Node dependencies, and working FFmpeg/FFprobe. An interrupted recovery leaves its state file and reusable outputs. A lock prevents two recovery runs from sharing one output folder; a stopped process's stale lock is recovered on the next run.

The script never automatically restores a database backup. To undo catalog changes, close the app and restore the recorded backup with its SQLite WAL/SHM handling accounted for. Do not copy a backup over a running library.

Validation: `node --test tests/bulkLibraryRecovery.test.cjs` verifies real media repair and decode, preserved source hashes, incomplete-download protection, exclusive output creation, backups, stale-record protection, cleanup and search-index-preserving relinks using isolated data.
