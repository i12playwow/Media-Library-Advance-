# Guards log

Append-only history of `npm run drill:abi` runs — the behavioral proof of the
hook-asymmetry contract (docs/testing.md, rule 3). Local prose runs append here
automatically; scheduled CI runs append a one-line summary per OS from Actions
(the full per-leg tables live in the run summary and the 30-day artifacts), so
runner checkouts stay clean. Commit the file after each local drill.

The history is tamper-evident: the log is a sequence of chained segments —
each drill entry, and each batch of CI summary lines — ending with a
`- chain: …` line recording the sha256 of every byte before it plus the
running entry count. Both appenders chain their own writes (the drill for
entries, `scripts/append-drill-log.cjs` for CI summaries), so the file always
ends with a chain line; an unchained tail is itself tamper evidence. Editing,
dropping, or reordering any historical byte breaks every chain line after the
edit. After a *legitimate* rewrite, re-seed the whole chain with
`node scripts/refill-log-chain.cjs` and commit it — visibly, never silently.

How the writer broke, and how the pins grew: commit b5eda7e introduced the
chain and hashed the right boundary (file + entry, LF-normalized) but then
appended the hashed WHOLE instead of the entry — `appendFileSync(GUARDS_LOG,
withEntry + …)` — duplicating the log on every run. No structural pin saw it:
drift class 8 pinned the boundary expression, not the append argument, and the
writer ran only in drills, never between b5eda7e and the first real run ~5.5h
later. Two drill runs caught it; the fix appends only the new bytes and derives
the entry count from the same hashed buffer. The class-8 write-path pins grew
from that lesson — exactly one append site writing only `entry`, exactly one
entry-count site reading the hashed buffer, no writeFileSync, no truncate — and
carry to the CI appender, the refill, and now the drill's behavioral tamper leg
(`scripts/tamper-probe.cjs`), which proves the UNVERIFIED half the structure
cannot: one byte flipped, the real app must serve the unverified FAILURE.

## 2026-09-26T04:49:27.968Z — contract holds (10/10 legs)

- node v26.8.1 · better-sqlite3 12.11.1 · electron 41.1.1 · commit 1b86b34 · win32 · 7s

| # | Leg | Result | Kind | Detail |
|---|---|---|---|---|
| 1 | 1. rebuild:node (baseline) | ✅ | contract | rebuild-node ok |
| 2 | 2. pretest gate green on Node-ABI baseline | ✅ | contract | abi-check ok |
| 3 | 3. flip to Electron-ABI (postinstall state) | ✅ | contract | rebuild-electron ok |
| 4 | 4. npm test aborts on wrong-ABI binding | ✅ | contract | exit 1 with verbatim mismatch, vitest never started |
| 5 | 5. gate leaves the binding untouched (pure gate) | ✅ | contract | mtime 1781544280000 → 1781544280000 |
| 6 | 6. pretest:e2e self-heals the identical state | ✅ | contract | rebuilt for electron + gate green under electron-as-node |
| 7 | 7. verify:abi:electron proves the healed state directly | ✅ | contract | gate green |
| 8 | 8. diagnose --fix heals case 1 back to Node-ABI | ✅ | contract | exit 0, FIX OK, binding rewritten, node gate green |
| 9 | R1. restore: rebuild:node | ✅ | restore | rebuild-node ok |
| 10 | R2. restore: gate green (UNIT-READY) | ✅ | restore | abi-check ok |
- chain: a43167445b1784f1438dfa234cda75e32bee99b447d78d0c0d4187089a278637 · entries 1
- 2026-09-26T07:18:12.129Z · ci · macos-latest · contract holds (10/10 legs) · run https://github.com/Creative-hub554/medialibrary-plus/actions/runs/36226288058 · drill@d1a1882
- 2026-09-26T07:18:12.346Z · ci · ubuntu-latest · contract holds (10/10 legs) · run https://github.com/Creative-hub554/medialibrary-plus/actions/runs/36226288058 · drill@d1a1882
- 2026-09-26T07:18:12.346Z · ci · windows-latest · contract holds (10/10 legs) · run https://github.com/Creative-hub554/medialibrary-plus/actions/runs/36226288058 · drill@d1a1882
- 2026-09-26T07:30:21.761Z · ci · macos-latest · contract holds (10/10 legs) · run https://github.com/Creative-hub554/medialibrary-plus/actions/runs/36226883408 · drill@0eb031e
- 2026-09-26T07:30:21.764Z · ci · ubuntu-latest · contract holds (10/10 legs) · run https://github.com/Creative-hub554/medialibrary-plus/actions/runs/36226883408 · drill@0eb031e
- 2026-09-26T07:30:21.764Z · ci · windows-latest · contract holds (10/10 legs) · run https://github.com/Creative-hub554/medialibrary-plus/actions/runs/36226883408 · drill@0eb031e
- chain: 6fcbef194ba7fdcc279e10c97b39c8ae948c76812b2e3de606b65230fd979e27 · entries 1

## 2026-09-26T11:29:41.148Z — contract holds (10/10 legs)

- node v26.8.1 · better-sqlite3 12.11.1 · electron 41.1.1 · commit b7bd582 · win32 · 11s

| # | Leg | Result | Kind | Detail |
|---|---|---|---|---|
| 1 | 1. rebuild:node (baseline) | ✅ | contract | rebuild-node ok |
| 2 | 2. pretest gate green on Node-ABI baseline | ✅ | contract | abi-check ok |
| 3 | 3. flip to Electron-ABI (postinstall state) | ✅ | contract | rebuild-electron ok |
| 4 | 4. npm test aborts on wrong-ABI binding | ✅ | contract | exit 1 with verbatim mismatch, vitest never started |
| 5 | 5. gate leaves the binding untouched (pure gate) | ✅ | contract | mtime 1781544280000 → 1781544280000 |
| 6 | 6. pretest:e2e self-heals the identical state | ✅ | contract | rebuilt for electron + gate green under electron-as-node |
| 7 | 7. verify:abi:electron proves the healed state directly | ✅ | contract | gate green |
| 8 | 8. diagnose --fix heals case 1 back to Node-ABI | ✅ | contract | exit 0, FIX OK, binding rewritten, node gate green |
| 9 | R1. restore: rebuild:node | ✅ | restore | rebuild-node ok |
| 10 | R2. restore: gate green (UNIT-READY) | ✅ | restore | abi-check ok |
- chain: 39680f08675b1da2f2f93a2bd7e30281c92f925db480d7b88e86ba1b0457ddc8 · entries 2

## 2026-09-26T18:53:35.944Z — contract holds (10/10 legs)

- node v26.8.1 · better-sqlite3 12.11.1 · electron 41.1.1 · commit 2742f1e · win32 · 11s

| # | Leg | Result | Kind | Detail |
|---|---|---|---|---|
| 1 | 1. rebuild:node (baseline) | ✅ | contract | rebuild-node ok |
| 2 | 2. pretest gate green on Node-ABI baseline | ✅ | contract | abi-check ok |
| 3 | 3. flip to Electron-ABI (postinstall state) | ✅ | contract | rebuild-electron ok |
| 4 | 4. npm test aborts on wrong-ABI binding | ✅ | contract | exit 1 with verbatim mismatch, vitest never started |
| 5 | 5. gate leaves the binding untouched (pure gate) | ✅ | contract | mtime 1781544280000 → 1781544280000 |
| 6 | 6. pretest:e2e self-heals the identical state | ✅ | contract | rebuilt for electron + gate green under electron-as-node |
| 7 | 7. verify:abi:electron proves the healed state directly | ✅ | contract | gate green |
| 8 | 8. diagnose --fix heals case 1 back to Node-ABI | ✅ | contract | exit 0, FIX OK, binding rewritten, node gate green |
| 9 | R1. restore: rebuild:node | ✅ | restore | rebuild-node ok |
| 10 | R2. restore: gate green (UNIT-READY) | ✅ | restore | abi-check ok |
- chain: 8622d6232f26c4b3b49bc276cedbf7a9d338f30084b4dbff09d2fec02a259411 · entries 3

## 2026-09-27T00:27:28.794Z — contract BROKEN (9/10 legs)

- node v24.19.0 · better-sqlite3 12.11.1 · electron 41.1.1 · commit unknown · win32 · 27s

| # | Leg | Result | Kind | Detail |
|---|---|---|---|---|
| 1 | 1. rebuild:node (baseline) | ✅ | contract | rebuild-node ok |
| 2 | 2. pretest gate green on Node-ABI baseline | ✅ | contract | abi-check ok |
| 3 | 3. flip to Electron-ABI (postinstall state) | ✅ | contract | rebuild-electron ok |
| 4 | 4. npm test aborts on wrong-ABI binding | ✅ | contract | exit 1 with verbatim mismatch, vitest never started |
| 5 | 5. gate leaves the binding untouched (pure gate) | ✅ | contract | mtime 1781544280000 → 1781544280000 |
| 6 | 6. pretest:e2e self-heals the identical state | ✅ | contract | rebuilt for electron + gate green under electron-as-node |
| 7 | 7. verify:abi:electron proves the healed state directly | ✅ | contract | gate green |
| 8 | 8. diagnose --fix heals case 1 back to Node-ABI | ✅ | contract | exit 0, FIX OK, binding rewritten, node gate green |
| 9 | R1. restore: rebuild:node | ❌ | restore | rebuild-node ok |
| 10 | R2. restore: gate green (UNIT-READY) | ✅ | restore | abi-check ok |
- chain: a4dbe58568eada1cf2f6d1c513cb3be215677245ee6ef8217696a049caa646b4 · entries 4

## 2026-09-27T00:29:35.375Z — contract BROKEN (9/10 legs)

- node v24.19.0 · better-sqlite3 12.11.1 · electron 41.1.1 · commit unknown · win32 · 42s

| # | Leg | Result | Kind | Detail |
|---|---|---|---|---|
| 1 | 1. rebuild:node (baseline) | ✅ | contract | rebuild-node ok |
| 2 | 2. pretest gate green on Node-ABI baseline | ✅ | contract | abi-check ok |
| 3 | 3. flip to Electron-ABI (postinstall state) | ✅ | contract | rebuild-electron ok |
| 4 | 4. npm test aborts on wrong-ABI binding | ✅ | contract | exit 1 with verbatim mismatch, vitest never started |
| 5 | 5. gate leaves the binding untouched (pure gate) | ✅ | contract | mtime 1781544280000 → 1781544280000 |
| 6 | 6. pretest:e2e self-heals the identical state | ✅ | contract | rebuilt for electron + gate green under electron-as-node |
| 7 | 7. verify:abi:electron proves the healed state directly | ✅ | contract | gate green |
| 8 | 8. diagnose --fix heals case 1 back to Node-ABI | ✅ | contract | exit 0, FIX OK, binding rewritten, node gate green |
| 9 | R1. restore: rebuild:node | ❌ | restore | rebuild-node failed (exit 1) |
| 10 | R2. restore: gate green (UNIT-READY) | ✅ | restore | abi-check ok |
- chain: 1efbf3a2d1333f304d2793698ac287271b8e5ca15591c60b5947fe56c693eea3 · entries 5

## 2026-09-27T00:31:59.869Z — contract holds (10/10 legs)

- node v24.19.0 · better-sqlite3 12.11.1 · electron 41.1.1 · commit unknown · win32 · 13s

| # | Leg | Result | Kind | Detail |
|---|---|---|---|---|
| 1 | 1. rebuild:node (baseline) | ✅ | contract | rebuild-node ok |
| 2 | 2. pretest gate green on Node-ABI baseline | ✅ | contract | abi-check ok |
| 3 | 3. flip to Electron-ABI (postinstall state) | ✅ | contract | rebuild-electron ok |
| 4 | 4. npm test aborts on wrong-ABI binding | ✅ | contract | exit 1 with verbatim mismatch, vitest never started |
| 5 | 5. gate leaves the binding untouched (pure gate) | ✅ | contract | mtime 1781544280000 → 1781544280000 |
| 6 | 6. pretest:e2e self-heals the identical state | ✅ | contract | rebuilt for electron + gate green under electron-as-node |
| 7 | 7. verify:abi:electron proves the healed state directly | ✅ | contract | gate green |
| 8 | 8. diagnose --fix heals case 1 back to Node-ABI | ✅ | contract | exit 0, FIX OK, binding rewritten, node gate green |
| 9 | R1. restore: rebuild:node | ✅ | restore | rebuild-node ok |
| 10 | R2. restore: gate green (UNIT-READY) | ✅ | restore | abi-check ok |
- chain: 380181f39b7aed7ee652b1cd3c95390ca6f0ce72d856627401c31a2e287a35ce · entries 6

## 2026-09-27T12:45:46.665Z — contract holds (10/10 legs)

- node v24.19.0 · better-sqlite3 12.11.1 · electron 41.1.1 · commit unknown · win32 · 19s

| # | Leg | Result | Kind | Detail |
|---|---|---|---|---|
| 1 | 1. rebuild:node (baseline) | ✅ | contract | rebuild-node ok |
| 2 | 2. pretest gate green on Node-ABI baseline | ✅ | contract | abi-check ok |
| 3 | 3. flip to Electron-ABI (postinstall state) | ✅ | contract | rebuild-electron ok |
| 4 | 4. npm test aborts on wrong-ABI binding | ✅ | contract | exit 1 with verbatim mismatch, vitest never started |
| 5 | 5. gate leaves the binding untouched (pure gate) | ✅ | contract | mtime 1781544280000 → 1781544280000 |
| 6 | 6. pretest:e2e self-heals the identical state | ✅ | contract | rebuilt for electron + gate green under electron-as-node |
| 7 | 7. verify:abi:electron proves the healed state directly | ✅ | contract | gate green |
| 8 | 8. diagnose --fix heals case 1 back to Node-ABI | ✅ | contract | exit 0, FIX OK, binding rewritten, node gate green |
| 9 | R1. restore: rebuild:node | ✅ | restore | rebuild-node ok |
| 10 | R2. restore: gate green (UNIT-READY) | ✅ | restore | abi-check ok |
- chain: 5c4d1e31549f55ab6f25e4c0ede3e75c50b7e225a57ef4826d6b6dbc38e8bb4e · entries 7

## 2026-09-27T17:35:20.857Z — contract holds (10/10 legs)

- node v24.19.0 · better-sqlite3 12.11.1 · electron 41.1.1 · commit unknown · win32 · 54s

| # | Leg | Result | Kind | Detail |
|---|---|---|---|---|
| 1 | 1. rebuild:node (baseline) | ✅ | contract | rebuild-node ok |
| 2 | 2. pretest gate green on Node-ABI baseline | ✅ | contract | abi-check ok |
| 3 | 3. flip to Electron-ABI (postinstall state) | ✅ | contract | rebuild-electron ok |
| 4 | 4. npm test aborts on wrong-ABI binding | ✅ | contract | exit 1 with verbatim mismatch, vitest never started |
| 5 | 5. gate leaves the binding untouched (pure gate) | ✅ | contract | mtime 1781544280000 → 1781544280000 |
| 6 | 6. pretest:e2e self-heals the identical state | ✅ | contract | rebuilt for electron + gate green under electron-as-node |
| 7 | 7. verify:abi:electron proves the healed state directly | ✅ | contract | gate green |
| 8 | 8. diagnose --fix heals case 1 back to Node-ABI | ✅ | contract | exit 0, FIX OK, binding rewritten, node gate green |
| 9 | R1. restore: rebuild:node | ✅ | restore | rebuild-node ok |
| 10 | R2. restore: gate green (UNIT-READY) | ✅ | restore | abi-check ok |
- chain: e5dc3259022f80d5b9a9cbfd6dc2bbf658eca1e8fac0a8f72b5cea193538d9c1 · entries 8

## 2026-09-27T19:20:52.341Z — contract holds (10/10 legs)

- node v24.19.0 · better-sqlite3 12.11.1 · electron 41.1.1 · commit 0db0838 · win32 · 41s

| # | Leg | Result | Kind | Detail |
|---|---|---|---|---|
| 1 | 1. rebuild:node (baseline) | ✅ | contract | rebuild-node ok |
| 2 | 2. pretest gate green on Node-ABI baseline | ✅ | contract | abi-check ok |
| 3 | 3. flip to Electron-ABI (postinstall state) | ✅ | contract | rebuild-electron ok |
| 4 | 4. npm test aborts on wrong-ABI binding | ✅ | contract | exit 1 with verbatim mismatch, vitest never started |
| 5 | 5. gate leaves the binding untouched (pure gate) | ✅ | contract | mtime 1781544280000 → 1781544280000 |
| 6 | 6. pretest:e2e self-heals the identical state | ✅ | contract | rebuilt for electron + gate green under electron-as-node |
| 7 | 7. verify:abi:electron proves the healed state directly | ✅ | contract | gate green |
| 8 | 8. diagnose --fix heals case 1 back to Node-ABI | ✅ | contract | exit 0, FIX OK, binding rewritten, node gate green |
| 9 | R1. restore: rebuild:node | ✅ | restore | rebuild-node ok |
| 10 | R2. restore: gate green (UNIT-READY) | ✅ | restore | abi-check ok |
- chain: a33c457feec879146bc4e34f2f3245ee3e576f3d9cadd25f812c35e1b11336b9 · entries 9

## 2026-09-28T01:03:46.265Z — contract holds (10/10 legs)

- node v24.19.0 · better-sqlite3 12.11.1 · electron 41.1.1 · commit 2e014e3 · win32 · 21s

| # | Leg | Result | Kind | Detail |
|---|---|---|---|---|
| 1 | 1. rebuild:node (baseline) | ✅ | contract | rebuild-node ok |
| 2 | 2. pretest gate green on Node-ABI baseline | ✅ | contract | abi-check ok |
| 3 | 3. flip to Electron-ABI (postinstall state) | ✅ | contract | rebuild-electron ok |
| 4 | 4. npm test aborts on wrong-ABI binding | ✅ | contract | exit 1 with verbatim mismatch, vitest never started |
| 5 | 5. gate leaves the binding untouched (pure gate) | ✅ | contract | mtime 1781544280000 → 1781544280000 |
| 6 | 6. pretest:e2e self-heals the identical state | ✅ | contract | rebuilt for electron + gate green under electron-as-node |
| 7 | 7. verify:abi:electron proves the healed state directly | ✅ | contract | gate green |
| 8 | 8. diagnose --fix heals case 1 back to Node-ABI | ✅ | contract | exit 0, FIX OK, binding rewritten, node gate green |
| 9 | R1. restore: rebuild:node | ✅ | restore | rebuild-node ok |
| 10 | R2. restore: gate green (UNIT-READY) | ✅ | restore | abi-check ok |
- chain: 7a49009ed030caca2a2cafad740c07fa581e8517c5cd41d7fdf398b332339acb · entries 10

## 2026-09-28T01:21:53.807Z — contract holds (10/10 legs)

- node v24.19.0 · better-sqlite3 12.11.1 · electron 41.1.1 · commit 56854a1 · win32 · 13s

| # | Leg | Result | Kind | Detail |
|---|---|---|---|---|
| 1 | 1. rebuild:node (baseline) | ✅ | contract | rebuild-node ok |
| 2 | 2. pretest gate green on Node-ABI baseline | ✅ | contract | abi-check ok |
| 3 | 3. flip to Electron-ABI (postinstall state) | ✅ | contract | rebuild-electron ok |
| 4 | 4. npm test aborts on wrong-ABI binding | ✅ | contract | exit 1 with verbatim mismatch, vitest never started |
| 5 | 5. gate leaves the binding untouched (pure gate) | ✅ | contract | mtime 1781544280000 → 1781544280000 |
| 6 | 6. pretest:e2e self-heals the identical state | ✅ | contract | rebuilt for electron + gate green under electron-as-node |
| 7 | 7. verify:abi:electron proves the healed state directly | ✅ | contract | gate green |
| 8 | 8. diagnose --fix heals case 1 back to Node-ABI | ✅ | contract | exit 0, FIX OK, binding rewritten, node gate green |
| 9 | R1. restore: rebuild:node | ✅ | restore | rebuild-node ok |
| 10 | R2. restore: gate green (UNIT-READY) | ✅ | restore | abi-check ok |
- chain: 5b65b810fca524be51930d4f0669b0ab9e586f7ac5bd82d04cdd784140e3ea17 · entries 11
- 2026-10-02T00:20:33.000Z · ci · macos-latest · contract holds (10/10 legs) · run https://github.com/i12playwow/Media-Library-Advance-/actions/runs/36945421215 · drill@1a1b8fd
- 2026-10-02T00:20:38.000Z · ci · ubuntu-latest · contract holds (10/10 legs) · tamper holds · run https://github.com/i12playwow/Media-Library-Advance-/actions/runs/36945421215 · drill@1a1b8fd
- 2026-10-02T00:20:50.000Z · ci · windows-latest · contract holds (10/10 legs) · run https://github.com/i12playwow/Media-Library-Advance-/actions/runs/36945421215 · drill@1a1b8fd
- chain: f144f2c26ce0132a651fb8c6cc7ce5dfda2ae4f031f8e0f3e816983a92013349 · entries 11
- 2026-10-02T01:12:29.000Z · ci · macos-latest · contract holds (10/10 legs) · run https://github.com/i12playwow/Media-Library-Advance-/actions/runs/36949763894 · drill@4a5ea3d
- 2026-10-02T01:12:53.000Z · ci · ubuntu-latest · contract holds (10/10 legs) · tamper holds · run https://github.com/i12playwow/Media-Library-Advance-/actions/runs/36949763894 · drill@4a5ea3d
- 2026-10-02T01:13:01.000Z · ci · windows-latest · contract holds (10/10 legs) · run https://github.com/i12playwow/Media-Library-Advance-/actions/runs/36949763894 · drill@4a5ea3d
- chain: 3a120f66387ef6c7171eca587ac7a6b2b79a524718b903f30c9f9882954d1cd8 · entries 11
