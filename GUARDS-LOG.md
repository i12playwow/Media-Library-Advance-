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
- chain: 2ea316605d3b34e6caf80d4852203fbaed17ea9c2d3d34035f28dd7ba051bde6 · entries 1
- 2026-09-26T07:18:12.129Z · ci · macos-latest · contract holds (10/10 legs) · run https://github.com/Creative-hub554/medialibrary-plus/actions/runs/36226288058 · drill@d1a1882
- 2026-09-26T07:18:12.346Z · ci · ubuntu-latest · contract holds (10/10 legs) · run https://github.com/Creative-hub554/medialibrary-plus/actions/runs/36226288058 · drill@d1a1882
- 2026-09-26T07:18:12.346Z · ci · windows-latest · contract holds (10/10 legs) · run https://github.com/Creative-hub554/medialibrary-plus/actions/runs/36226288058 · drill@d1a1882
- 2026-09-26T07:30:21.761Z · ci · macos-latest · contract holds (10/10 legs) · run https://github.com/Creative-hub554/medialibrary-plus/actions/runs/36226883408 · drill@0eb031e
- 2026-09-26T07:30:21.764Z · ci · ubuntu-latest · contract holds (10/10 legs) · run https://github.com/Creative-hub554/medialibrary-plus/actions/runs/36226883408 · drill@0eb031e
- 2026-09-26T07:30:21.764Z · ci · windows-latest · contract holds (10/10 legs) · run https://github.com/Creative-hub554/medialibrary-plus/actions/runs/36226883408 · drill@0eb031e
- chain: 7c7ad098e0978de8d9409ae2c6bcf58e7a53d3c20c86ee42bc494f8f05d9788e · entries 1

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
- chain: 4b47164f2e6a0f279da2ad30abd39006cb23b2d3871131bdc6d578d57bd5753b · entries 2

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
- chain: f998f5757b08ea1bb9b55dbc9db7bc0da49988b16963a5d95f2d9d1da24d9a95 · entries 3

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
- chain: 73b258b55f02073791834b182378f76f21f0f675a86081a35a26a0a04b79627c · entries 4

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
- chain: 2beaa5ea9227dd3dbccabce12659a96736af5f74d475bebb59f005cc78f81638 · entries 5

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
- chain: 004dc9a3d433d4fea56e926a67740caa5c5d7f0518e764fcfd9fd5e318a5ab49 · entries 6

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
- chain: 5e3a98e22441ae7fab7de75d50191b74b605393edde4056617987d2d1d6dbd4a · entries 7

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
- chain: 597a00a13f2f7721e8d0a85c1ccfe69e46e54118e6122c29d0b6a38afb617b46 · entries 8

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
- chain: ff47b39be4bf8b9c2439b14bc8a8a76113f0c2731101352bcf7d2ca4e856a8da · entries 9
