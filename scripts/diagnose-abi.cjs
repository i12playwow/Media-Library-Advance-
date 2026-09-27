"use strict";

// scripts/diagnose-abi.cjs — tells you which ABI state the better-sqlite3
// binding is in, and with --fix heals the case-1 state (wrong-ABI binding)
// back to Node-ABI, exiting 0 only if the Node gate is green afterwards
// (docs/testing.md rule 6; drill leg 8).
//
//   npm run diagnose:abi           → report only, exit 1 when unit-broken
//   npm run diagnose:abi -- --fix  → heal to Node-ABI, then gate; "FIX OK" on success

const {
  getVersions,
  getElectronAbi,
  probeBinding,
  getBindingState,
  runNpm,
} = require("./lib/abi-state.cjs");

const { node, betterSqlite3, electron } = getVersions();
const fix = process.argv.includes("--fix");
const lines = [`diagnose-abi — node ${node} · better-sqlite3 ${betterSqlite3} · electron ${electron}`];
const before = getBindingState();

const probe = probeBinding();

if (probe.kind === "ok") {
  lines.push("  state: Node-ABI ready (UNIT-READY) — the binding loads and passes the FTS5 proof under Node.");
  lines.push("  note: for the Electron e2e suite, run `npm run rebuild:electron` first (pretest:e2e does this for you).");
  if (fix) {
    lines.push("  --fix: nothing to heal; binding untouched.");
  }
  process.stdout.write(`${lines.join("\n")}\n`);
  process.exit(0);
}

if (probe.kind === "abi" && getElectronAbi(electron) && probe.bindingAbi === String(getElectronAbi(electron))) {
  lines.push(`  state: Electron-ABI binding (NODE_MODULE_VERSION ${probe.bindingAbi}) — the postinstall state.`);
  lines.push("  effect: unit tests under Node will fail the ABI gate; the Electron e2e path works.");
} else {
  lines.push(`  state: broken binding (${probe.kind === "abi" ? `NODE_MODULE_VERSION ${probe.bindingAbi}` : "load failure"})`);
  if (probe.message) lines.push(`  detail: ${probe.message}`);
}
lines.push("  unit-ready target: Node-ABI via `npm run rebuild:node`.");

if (!fix) {
  process.stderr.write(`${lines.join("\n")}\nRun \`npm run diagnose:abi -- --fix\` to heal to Node-ABI.\n`);
  process.exit(1);
}

lines.push("  --fix: running rebuild:node...");
const rebuild = runNpm(["run", "rebuild:node"]);
if (rebuild.status !== 0) {
  process.stderr.write(`${lines.join("\n")}\nFIX FAILED: rebuild:node exited ${rebuild.status}.\n${rebuild.output.slice(-800)}\n`);
  process.exit(1);
}

const gate = runNpm(["run", "verify:abi"]);
const after = getBindingState();
const rewritten =
  before.present && after.present
    ? after.mtimeMs !== before.mtimeMs || after.size !== before.size
    : after.present;
lines.push(`  binding rewritten: ${rewritten ? "yes" : "no"} (mtime ${before.mtimeMs ?? "-"} → ${after.mtimeMs ?? "-"})`);

if (gate.status !== 0) {
  process.stderr.write(`${lines.join("\n")}\nFIX FAILED: Node gate still red after rebuild.\n${gate.output.slice(-800)}\n`);
  process.exit(1);
}

lines.push("FIX OK — binding rewritten, Node gate green (UNIT-READY).");
process.stdout.write(`${lines.join("\n")}\n`);
