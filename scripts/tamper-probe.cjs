#!/usr/bin/env node
// tamper-probe.cjs — the weekly drill's behavioral tamper leg.
//
// The structural guards (drift class 8's digest replay, the appender's
// CI_LINE_RE, the write-path pins) prove the chain is VERIFIED correctly;
// none of them proves the UNVERIFIED half is wired: that a tampered log
// actually turns the Settings card red through the real preload bridge.
// The local drill cannot run that leg (rule 5: it maps nothing and must not
// run Electron on Windows), so this probe runs it on CI's Linux runner:
//
//   1. npm run build — dist must match HEAD, the same bar any user gets.
//   2. npm run rebuild:electron && npm run verify:abi:electron — the exact
//      pretest:e2e order (rule 3), so the binding is Electron-ABI for the
//      live FTS5 proof the spec's launch needs.
//   3. Run ONLY the guards-chain spec. The spec carries the whole arc
//      itself: a clean launch must render the committed chain as verified,
//      then it flips one byte of the FIRST drill entry's "rebuild-node ok"
//      detail, re-verifies on demand, and requires the unverified FAILURE
//      through the real preload bridge before restoring the bytes. The
//      probe deliberately does NOT tamper the log itself: a pre-flip would
//      defeat the spec's verified-launch phase and the leg could never go
//      green. The probe's job is a trustworthy verdict on that arc.
//   4. Accept exit code 0 (the spec passed) ONLY if its own output says
//      "1 passed" — the spec is expected to PASS while the app inside it
//      reports the tamper as an UNVERIFIED FAILURE. Any other pair of
//      exit code and pass line is a red leg, including the silent-green
//      failure where the suite goes green without running the leg. On a
//      red leg the captured Playwright report is re-printed in full: a
//      verdict without its evidence is not diagnosable from the job log.
//   5. Snapshot GUARDS-LOG.md before the run and verify byte-exactness
//      unconditionally afterwards (the spec restores in its own finally;
//      this is the belt-and-braces proof). A mismatch is repaired from
//      the snapshot and exits red — the committed log must leave this
//      probe byte-exact, and git's cleanliness proves it again after.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const LOG = path.join(__dirname, "..", "GUARDS-LOG.md");
const SPEC = path.join("tests", "e2e", "guards-chain.spec.ts");

function run(label, args, opts = {}) {
  process.stdout.write(`tamper-probe: ${label}\n`);
  return execFileSync(process.execPath, args, {
    // stdout is captured for the verdict line; stderr streams live so a
    // crashed run is diagnosable in the job log without rerunning anything.
    stdio: opts.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    encoding: "utf8",
  });
}

function runNpm(label, script) {
  process.stdout.write(`tamper-probe: npm run ${script}\n`);
  return execFileSync("npm", ["run", script], {
    shell: process.platform === "win32",
    stdio: "inherit",
  });
}

let snapshot;
let exitCode = 0;
try {
  runNpm("dist must match HEAD", "build");

  // The exact pretest:e2e order (rule 3): rebuild first, then the live gate.
  runNpm("heal to Electron ABI", "rebuild:electron");
  runNpm("prove the Electron ABI", "verify:abi:electron");

  // The spec performs the one-byte canary flip on this file mid-run and
  // restores it in its own finally; the snapshot is this probe's proof
  // that the committed bytes left the run untouched.
  snapshot = fs.readFileSync(LOG, "utf8");

  let output = "";
  let specStatus = 0;
  try {
    output = run("run only the guards-chain spec (it tampers and restores the log itself)", [
      "node_modules/@playwright/test/cli.js",
      "test",
      SPEC,
    ], { capture: true });
  } catch (err) {
    // The spec is expected to PASS — Playwright signals that with exit 0
    // and its stdout summary line. Keep whatever came out either way;
    // stderr has already streamed to the job log as it happened.
    specStatus = err.status ?? 1;
    output = err.stdout ?? "";
  }

  // The verdict the leg actually asserts: the spec's own tamper (one
  // historical byte) must have surfaced as the unverified FAILURE through
  // the real preload bridge while the single-spec suite stayed green.
  // Green output without the pass line is a silent-green failure — the
  // leg's whole reason to exist.
  const passes = (output.match(/(\d+) passed/g) ?? []).map((m) => Number(m.replace(/\D/g, "")));
  const passed = passes.length === 1 && passes[0] === 1 && specStatus === 0;
  process.stdout.write(`tamper-probe: spec status ${specStatus}, playwright output said ${(passes.join(", ") || "nothing")} passed\n`);
  if (!passed) {
    console.error("tamper-probe: leg FAILED — expected the guards-chain spec to pass (1 passed) with the app reporting the tamper as unverified");
    if (output.trim()) {
      console.error("tamper-probe: ----- playwright report (verbatim) -----");
      console.error(output.trimEnd());
      console.error("tamper-probe: ----- end playwright report -----");
    } else {
      console.error("tamper-probe: playwright produced no capturable stdout — check the streamed stderr above");
    }
    exitCode = 1;
  } else {
    process.stdout.write("tamper-probe: leg PASSED — the spec's tampered log was served as unverified FAILURE through the real preload bridge\n");
  }
} catch (err) {
  console.error(`tamper-probe: leg FAILED — ${err.message}`);
  exitCode = 1;
} finally {
  if (snapshot !== undefined) {
    try {
      const after = fs.readFileSync(LOG, "utf8");
      if (after !== snapshot) {
        // The committed log must leave this probe byte-exact. Repair from
        // the snapshot, then still exit red: the mismatch itself is a
        // broken invariant worth a human's attention.
        fs.writeFileSync(LOG, snapshot, "utf8");
        console.error("tamper-probe: log was not byte-exact after the spec — repaired from the snapshot; leg FAILED");
        exitCode = 1;
      } else {
        process.stdout.write("tamper-probe: GUARDS-LOG.md verified byte-exact after the run\n");
      }
    } catch (err) {
      console.error(`tamper-probe: RESTORE CHECK FAILED (${err.message}) — GUARDS-LOG.md may still be tampered on disk`);
      exitCode = 1;
    }
  }
}

process.exit(exitCode);
