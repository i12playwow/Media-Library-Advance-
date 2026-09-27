"use strict";

// scripts/drill-abi-contract.cjs — the behavioral proof of the ABI contract
// (docs/testing.md rule 3; CONTRIBUTING.md layer 3). It flips the better-sqlite3
// binding between ABIs and proves the contract *by runs*:
//
//   leg 1  npm run rebuild:node (baseline)
//   leg 2  pretest gate green on Node-ABI baseline
//   leg 3  flip to Electron-ABI (postinstall state) via rebuild:electron
//   leg 4  npm test aborts on wrong-ABI binding (gate red, vitest never started)
//   leg 5  the gate leaves the binding untouched (mtime proof — pure gate)
//   leg 6  pretest:e2e self-heals the identical state (healing hook)
//   leg 7  verify:abi:electron proves the healed state directly
//   leg 8  diagnose --fix heals case 1 back to Node-ABI (exit 0, FIX OK)
//   R1/R2  restore: rebuild:node + gate green (UNIT-READY)
//
// Every leg runs in a `finally`-style restore so the machine ends in the
// Node-ABI (unit-ready) state even when a leg fails. Local runs append a
// per-leg history entry to GUARDS-LOG.md (CI appends one summary line per OS
// instead — the scheduled workflow sets CI=1).
//
// This script deliberately rebuilds the binding several times. Don't run it
// concurrently with another test process.

const fs = require("node:fs");
const path = require("node:path");
const {
  getVersions,
  getElectronAbi,
  getBindingState,
  getCommitSha,
  probeBinding,
  runNpm,
} = require("./lib/abi-state.cjs");

const REPO_ROOT = path.resolve(__dirname, "..");
const GUARDS_LOG = path.join(REPO_ROOT, "GUARDS-LOG.md");

function npm(args, timeoutMs = 600000) {
  return runNpm(args, timeoutMs);
}

function bindingMtime() {
  const state = getBindingState();
  return state.present ? state.mtimeMs : null;
}

const { node, betterSqlite3, electron } = getVersions();
const legs = [];
let machineRestored = false;
const t0 = Date.now();

function record(id, label, ok, detail) {
  legs.push({ id, label, ok: Boolean(ok), kind: id.startsWith("R") ? "restore" : "contract", detail });
  const mark = ok ? "✅" : "❌";
  process.stdout.write(`${mark} ${id}. ${label} — ${detail}\n`);
}

try {
  // ── Leg 1: rebuild:node (baseline) ────────────────────────────────────────
  const r1 = npm(["run", "rebuild:node"]);
  record("1", "rebuild:node (baseline)", r1.status === 0 && /rebuild:node ok/.test(r1.output), "rebuild-node ok");

  // ── Leg 2: pretest gate green on Node-ABI baseline ───────────────────────
  const r2 = npm(["run", "verify:abi"]);
  record("2", "pretest gate green on Node-ABI baseline", r2.status === 0, "abi-check ok");

  // ── Leg 3: flip to Electron-ABI (postinstall state) ──────────────────────
  const r3 = npm(["run", "rebuild:electron"]);
  const r3probe = probeBinding();
  const flipped =
    r3.status === 0 &&
    r3probe.kind === "abi" &&
    r3probe.bindingAbi !== process.versions.modules;
  record("3", "flip to Electron-ABI (postinstall state)", flipped, "rebuild-electron ok");

  // ── Leg 4: npm test aborts on wrong-ABI binding ──────────────────────────
  const mtimeBefore4 = bindingMtime();
  const r4 = npm(["test"]);
  const vitestNeverStarted = !/\bvitest\b.*\bRUN\b|Test Files/i.test(r4.output);
  record(
    "4",
    "npm test aborts on wrong-ABI binding",
    r4.status === 1 && /ABI gate FAILED/i.test(r4.output) && vitestNeverStarted,
    "exit 1 with verbatim mismatch, vitest never started"
  );

  // ── Leg 5: the gate leaves the binding untouched (pure gate) ─────────────
  const mtimeAfter4 = bindingMtime();
  record(
    "5",
    "gate leaves the binding untouched (pure gate)",
    mtimeBefore4 !== null && mtimeBefore4 === mtimeAfter4,
    `mtime ${mtimeBefore4} → ${mtimeAfter4}`
  );

  // ── Leg 6: pretest:e2e self-heals the identical state ────────────────────
  // Proven by the healing hook's own Electron-mode gate exit code — do NOT
  // probe the binding in this process: a successful load maps the .node file
  // here, and Windows would then block the finally-block rebuild below.
  const r6 = npm(["run", "pretest:e2e"]);
  const healedForElectron = r6.status === 0;
  record("6", "pretest:e2e self-heals the identical state", healedForElectron, "rebuilt for electron + gate green under electron-as-node");

  // ── Leg 7: verify:abi:electron proves the healed state directly ──────────
  const r7 = npm(["run", "verify:abi:electron"]);
  record("7", "verify:abi:electron proves the healed state directly", r7.status === 0, "gate green");

  // ── Leg 8: diagnose --fix heals case 1 back to Node-ABI ──────────────────
  // "FIX OK" is only printed after diagnose's own Node gate ran green in a
  // child process — same reason as leg 6: no in-process probe here, or the
  // finally-block rebuild hits a Windows file lock on the mapped binding.
  const r8 = npm(["run", "diagnose:abi", "--", "--fix"]);
  const fixOk = r8.status === 0 && /FIX OK/.test(r8.output) && /gate green/.test(r8.output);
  record("8", "diagnose --fix heals case 1 back to Node-ABI", fixOk, "exit 0, FIX OK, binding rewritten, node gate green");
} finally {
  // ── Restore: leave the machine unit-ready no matter what happened ────────
  // One retry on the rebuild: npm occasionally exits nonzero on transient
  // Windows file-lock/EPERM hiccups right after a previous rebuild; the
  // restore's job is a unit-ready machine, not to propagate that flake.
  let rr1 = npm(["run", "rebuild:node"]);
  if (rr1.status !== 0) {
    process.stdout.write("  restore: rebuild:node exited nonzero, retrying once...\n");
    rr1 = npm(["run", "rebuild:node"]);
  }
  record(
    "R1",
    "restore: rebuild:node",
    rr1.status === 0 && /rebuild:node ok/.test(rr1.output),
    rr1.status === 0 ? "rebuild-node ok" : `rebuild-node failed (exit ${rr1.status}): ${rr1.output.trim().slice(-300).replace(/\s+/g, " ")}`
  );
  const rr2 = npm(["run", "verify:abi"]);
  record("R2", "restore: gate green (UNIT-READY)", rr2.status === 0, "abi-check ok");
  machineRestored = rr1.status === 0 && rr2.status === 0;
}

const passed = legs.filter((l) => l.ok).length;
const total = legs.length;
const allOk = passed === total;

// ── Append to GUARDS-LOG.md (local runs only; CI appends summary lines) ─────
if (!process.env.CI) {
  const now = new Date().toISOString();
  const elapsedSeconds = Math.max(1, Math.round((Date.now() - t0) / 1000));
  const entry = [
    "",
    `## ${now} — contract ${allOk ? "holds" : "BROKEN"} (${passed}/${total} legs)`,
    "",
    `- node ${node} · better-sqlite3 ${betterSqlite3} · electron ${electron} · commit ${getCommitSha()} · ${process.platform} · ${elapsedSeconds}s`,
    "",
    "| # | Leg | Result | Kind | Detail |",
    "|---|---|---|---|---|",
    ...legs.map((l, i) => `| ${i + 1} | ${l.id}. ${l.label} | ${l.ok ? "✅" : "❌"} | ${l.kind} | ${l.detail} |`),
    "",
  ].join("\n");
  // Tamper-evident chain: the chain line records the sha256 of every byte
  // before IT — the pre-append file PLUS this entry's own bytes — LF-
  // normalized, plus the running entry count. Editing, dropping, or
  // reordering history breaks every chain line after the edit, and
  // docsSearchRefs.test.ts's drift class 8 verifies the chain on every npm
  // test. scripts/refill-log-chain.cjs re-seeds after a legitimate rewrite.
  const normalized = fs.readFileSync(GUARDS_LOG, "utf8").replace(/\r\n/g, "\n");
  const withEntry = normalized + entry;
  const digest = require("node:crypto").createHash("sha256").update(withEntry, "utf8").digest("hex");
  const entryCount = (withEntry.match(/^## /gm) || []).length;
  fs.appendFileSync(GUARDS_LOG, withEntry + `- chain: ${digest} · entries ${entryCount}\n`, "utf8");
  process.stdout.write(`\nappended drill entry to GUARDS-LOG.md\n`);
}

process.stdout.write(`\ncontract ${allOk ? "holds" : "BROKEN"} (${passed}/${total} legs)\n`);
process.exit(allOk ? 0 : 1);
