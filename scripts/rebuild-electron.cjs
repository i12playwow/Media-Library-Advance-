"use strict";

// scripts/rebuild-node.cjs and scripts/rebuild-electron.cjs — the two ABI
// rebuild commands. Each uses the authoritative mechanism for its direction:
//   rebuild:node     → `npm rebuild better-sqlite3`: the package's own install
//                      script fetches/builds the binding for THIS Node's
//                      NODE_MODULE_VERSION (the unit-test-ready state).
//   rebuild:electron → `electron-builder install-app-deps` (the same command
//                      package.json runs on postinstall): installs the
//                      Electron-ABI binding (the postinstall state).
//
// scripts/diagnose-abi.cjs detects which state the binding is in and runs the
// matching script; pretest:e2e runs rebuild:electron before the Electron-mode
// gate so the e2e path self-heals (docs/testing.md rule 3).

const { spawnSync } = require("node:child_process");
const { runNpm } = require("./lib/abi-state.cjs");

const mode = process.argv[1] && /rebuild-electron\.cjs$/.test(process.argv[1]) ? "electron" : "node";

const args = mode === "electron"
  ? ["exec", "electron-builder", "--", "install-app-deps"]
  : ["rebuild", "better-sqlite3"];

process.stdout.write(`rebuilding better-sqlite3 for ${mode} ABI...\n`);

const res = runNpm(args);

if (res.status !== 0) {
  process.stderr.write(`rebuild:${mode} failed (exit ${res.status ?? "signal"}).\n`);
  process.exit(res.status ?? 1);
}

process.stdout.write(`rebuild:${mode} ok\n`);
