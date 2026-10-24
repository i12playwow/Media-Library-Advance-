"use strict";

// scripts/verify-all.cjs — both suites in one command (package.json verify:all).
//
// The suites need opposite ABIs (docs/testing.md, "The ABI dance"): Vitest runs
// against the Node-ABI binding, Playwright launches Electron with the
// Electron-ABI one. This wrapper owns the flip so a full local verification is
// one command and always ends in the same state:
//
//   e2e       npm run test:e2e    pretest:e2e heals to Electron, then Playwright
//   rebuild   npm run rebuild:node  Electron → Node, unconditional
//   gate      npm run verify:abi    proves the Node state actually landed
//   unit      npm test              (its pure pretest gate re-proves it, then Vitest)
//
// The Node rebuild runs even when the e2e leg failed, so a red run still ends
// unit-ready; only a failed Node gate skips the unit leg, because `npm test`'s
// pure pretest gate would stop at the same place. Exit 0 only when every leg
// that ran passed.

const { getVersions, runNpm } = require("./lib/abi-state.cjs");

const LEG_TIMEOUT_MS = 30 * 60 * 1000;
const versions = getVersions();
const legs = [];

function runLeg(name, abi, npmArgs) {
  const started = Date.now();
  process.stdout.write(`\n== ${name} · ${abi} ==\n`);
  const res = runNpm(npmArgs, LEG_TIMEOUT_MS, { stdio: "inherit" });
  const ms = Date.now() - started;
  const ok = res.status === 0;
  legs.push({ name, abi, ok, ms });
  if (!ok) {
    const why = res.status === null ? "timed out or was signalled" : `exit ${res.status}`;
    process.stderr.write(`\n✗ ${name} failed (${why})\n`);
  }
  return ok;
}

function pad(value, width) {
  return String(value).padEnd(width);
}

process.stdout.write(
  `verify:all — node ${versions.node} · better-sqlite3 ${versions.betterSqlite3} · electron ${versions.electron}\n` +
    "sequence: e2e (Electron ABI) → rebuild:node → verify:abi → unit (Node ABI)\n"
);

runLeg("e2e suite", "Electron ABI", ["run", "test:e2e"]);
runLeg("rebuild:node", "Electron → Node", ["run", "rebuild:node"]);

const gateOk = runLeg("verify:abi", "Node ABI (proven)", ["run", "verify:abi"]);

if (gateOk) {
  runLeg("unit suite", "Node ABI", ["test"]);
} else {
  // The pure pretest gate would fail on the identical state; skipping is
  // reported as SKIP, never as a pass (docs/testing.md rule 2).
  legs.push({ name: "unit suite", abi: "Node ABI", ok: false, ms: 0, skipped: true });
  process.stderr.write(
    "\n! unit suite skipped — the binding is not proven Node-ABI. Run `npm run diagnose:abi` for the current state.\n"
  );
}

const nameWidth = legs.reduce((width, leg) => Math.max(width, leg.name.length), 0);

process.stdout.write(`\n${"-".repeat(nameWidth + 34)}\n`);
for (const leg of legs) {
  const verdict = leg.skipped ? "SKIP" : leg.ok ? "PASS" : "FAIL";
  const seconds = leg.skipped ? "  —  " : `${(leg.ms / 1000).toFixed(1).padStart(5)}s`;
  process.stdout.write(`  ${pad(leg.name, nameWidth)}  ${verdict}  ${seconds}  ${leg.abi}\n`);
}

const failed = legs.filter((leg) => !leg.ok);
if (gateOk) {
  process.stdout.write(
    "\nFinal state: Node-ABI binding, unit-ready. The Electron-facing entry points rebuild for Electron themselves.\n"
  );
} else {
  process.stdout.write(
    "\nFinal state: NOT verified — the Node gate failed. Run `npm run diagnose:abi` to report the binding state.\n"
  );
}

process.exit(failed.length === 0 ? 0 : 1);
