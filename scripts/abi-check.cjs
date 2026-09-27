"use strict";

// scripts/abi-check.cjs — the ABI gate (package.json: verify:abi / verify:abi:electron,
// npm pretest). docs/testing.md rule 1: require() alone proves nothing — a green
// verdict here rests on a real better-sqlite3 Database instantiation that runs an
// FTS5 query in this exact runtime. Pure by design (rule 3): this script NEVER
// rebuilds or otherwise touches the binding — on a mismatch it prints the
// offending NODE_MODULE_VERSIONs and exits 1. The healing hook is pretest:e2e
// (scripts/rebuild-electron.cjs), and npm run diagnose:abi -- --fix heals the
// case-1 state on demand.

const { getVersions, getElectronAbi, probeBinding, runFts5ProofUnderElectron, electronRuntimePresent } = require("./lib/abi-state.cjs");

const mode = process.argv.includes("--electron") ? "electron" : "node";

if (process.argv.includes("--run-proof")) {
  require("./lib/abi-state.cjs").runProofHere();
}

const { node, betterSqlite3, electron } = getVersions();
const lines = [];
lines.push(`abi-check (${mode} mode) — node ${node} · better-sqlite3 ${betterSqlite3} · electron ${electron}`);

if (mode === "node") {
  const probe = probeBinding();
  if (probe.kind !== "ok") {
    const expected = getElectronAbi(electron);
    const bindingAbi = probe.bindingAbi ?? "unknown";
    lines.push(`  binding state: ${probe.kind === "abi" ? `wrong ABI (binding NODE_MODULE_VERSION ${bindingAbi})` : "load failure"}`);
    if (probe.message) lines.push(`  detail: ${probe.message}`);
    lines.push(`  expected NODE_MODULE_VERSION ${expected ?? "?"} for Node ${node}`);
    lines.push("");
    lines.push("ABI gate FAILED. The binding is not usable in this runtime. Fix with:");
    lines.push("  npm run rebuild:node");
    lines.push("(This gate is deliberately pure — it never rebuilds on your behalf.)");
    process.stderr.write(`${lines.join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(`${lines.join("\n")}\nABI gate green: better-sqlite3 loads and passes the FTS5 proof under Node.\n`);
  process.exit(0);
}

// ── Electron mode ────────────────────────────────────────────────────────────
// The binding is compiled for Electron's ABI; the gate proves it in the real
// Electron runtime (ELECTRON_RUN_AS_NODE) when that runtime is present, so the
// verdict always rests on a live FTS5 query. Without the runtime, the verdict
// degenerates to a parse-only check, which is reported as such.

const electronAbi = getElectronAbi(electron);
const expectedLine = `expected NODE_MODULE_VERSION ${electronAbi ?? "?"} for electron ${electron}`;

if (!electronRuntimePresent()) {
  // Degraded mode: without the Electron runtime, a binding's Electron-ABI can
  // only be observed as a load failure under Node whose reported
  // NODE_MODULE_VERSION equals the expected Electron ABI. A binding that LOADS
  // under Node is therefore Node-ABI — a false green for this gate whenever
  // the two ABIs differ, so it fails with that diagnosis.
  const probe = probeBinding();
  if (probe.kind === "abi" && electronAbi && probe.bindingAbi === electronAbi) {
    process.stdout.write(`${lines.join("\n")}\nABI gate green (parse-only fallback): the binding reports NODE_MODULE_VERSION ${probe.bindingAbi}, matching ${expectedLine}.\n  note: electron runtime not installed, so no live FTS5 proof was possible.\n`);
    process.exit(0);
  }
  if (probe.kind === "ok" && (!electronAbi || electronAbi === process.versions.modules)) {
    // The ABIs coincide (or the expected ABI is unknown): loading under Node is
    // consistent with the Electron-ABI target. Verdict stays parse-only.
    process.stdout.write(`${lines.join("\n")}\nABI gate green (parse-only fallback): better-sqlite3 loads and passes the FTS5 proof; node and electron ABIs coincide, so this is consistent with ${expectedLine}.\n  note: electron runtime not installed; the match was NOT proven live.\n`);
    process.exit(0);
  }
  if (probe.kind === "ok") {
    lines.push(`  binding state: loads under Node (NODE_MODULE_VERSION ${process.versions.modules}) — that is NOT the Electron ABI.`);
    lines.push(`  ${expectedLine}`);
    lines.push("  note: electron runtime not installed, so the Electron-ABI proof cannot run here.");
    lines.push("  fix: install the electron runtime (npm run start once downloads it), then re-run this gate.");
    process.stderr.write(`${lines.join("\n")}\nABI gate FAILED (parse-only fallback; binding is Node-ABI, not Electron-ABI).\n`);
    process.exit(1);
  }
  lines.push(`  binding state: ${probe.kind === "abi" ? `wrong ABI (binding NODE_MODULE_VERSION ${probe.bindingAbi})` : "load failure"}`);
  if (probe.message) lines.push(`  detail: ${probe.message}`);
  lines.push(`  ${expectedLine}`);
  process.stderr.write(`${lines.join("\n")}\nABI gate FAILED (parse-only fallback; electron runtime not installed).\n`);
  process.exit(1);
}

const proof = runFts5ProofUnderElectron();
if (proof.ok) {
  process.stdout.write(`${lines.join("\n")}\nABI gate green: better-sqlite3 passes the live FTS5 proof under the Electron runtime (${expectedLine}).\n`);
  process.exit(0);
}
process.stderr.write(`${lines.join("\n")}\nABI gate FAILED: ${proof.reason}\n`);
process.exit(1);
