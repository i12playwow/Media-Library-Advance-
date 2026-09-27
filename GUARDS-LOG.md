# Guards log

Append-only history of `npm run drill:abi` runs — the behavioral proof of the
hook-asymmetry contract (docs/testing.md, rule 3). Local prose runs append here
automatically; scheduled CI runs append a one-line summary per OS from Actions
(the full per-leg tables live in the run summary and the 30-day artifacts), so
runner checkouts stay clean. Commit the file after each local drill.

The history is tamper-evident: every entry ends with a `- chain: …` line
recording the sha256 of every byte before it plus the running entry count —
written by the drill's append, verified on every `npm test` (drift class 8).
Editing, dropping, or reordering any historical byte breaks every chain line
after the edit. After a *legitimate* rewrite, re-seed the whole chain with
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
- 2026-09-26T07:18:12.129Z · ci · macos-latest · contract holds (10/10 legs) · run https://github.com/Creative-hub554/medialibrary-plus/actions/runs/36226288058 · drill@d1a1882
- 2026-09-26T07:18:12.346Z · ci · ubuntu-latest · contract holds (10/10 legs) · run https://github.com/Creative-hub554/medialibrary-plus/actions/runs/36226288058 · drill@d1a1882
- 2026-09-26T07:18:12.346Z · ci · windows-latest · contract holds (10/10 legs) · run https://github.com/Creative-hub554/medialibrary-plus/actions/runs/36226288058 · drill@d1a1882
- 2026-09-26T07:30:21.761Z · ci · macos-latest · contract holds (10/10 legs) · run https://github.com/Creative-hub554/medialibrary-plus/actions/runs/36226883408 · drill@0eb031e
- 2026-09-26T07:30:21.764Z · ci · ubuntu-latest · contract holds (10/10 legs) · run https://github.com/Creative-hub554/medialibrary-plus/actions/runs/36226883408 · drill@0eb031e
- 2026-09-26T07:30:21.764Z · ci · windows-latest · contract holds (10/10 legs) · run https://github.com/Creative-hub554/medialibrary-plus/actions/runs/36226883408 · drill@0eb031e

- chain: a83e40d75d4a85e0bb6528d8131b87079b12eb56e380dc25bff8d1d7d7627a25 · entries 1


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

- chain: b992b7c3d2254685e8d523e247bb68f6b9f8f71ec06f23c74e0a0bdb867c1f1c · entries 2


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

- chain: bcb624710c73c73d8a4109dacbd555e3567e59ed47733ca4f84f65eb22734d91 · entries 3


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

- chain: f851da60ad4cabf15344f00427f2447d9c201d947c7519e62af64a7601a2c361 · entries 4


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

- chain: 86399619f11fdfc38867052f1c0a389cae97f9b7f98b24b2d6cf48582d3240d5 · entries 5


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

- chain: 3a08cae440a2c6c7eaaa3a5c0aa38652d05b868cbc3b0b3b8258c76905bd6951 · entries 6


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

- chain: c48f84ba3c679c37398e0f9bbb40408acea63a15498f539f9f75c380b46a00a0 · entries 7


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

- chain: 744df69214b441c2e048a6bcb6dc06b18dcbf50280cc78b37923f58111151ed7 · entries 8


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

- chain: bb1efd5d45588ea9b078f62b5a828f73a7f1da637968c95ab29140fb4cb4ce7d · entries 9
