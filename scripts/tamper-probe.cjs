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
//   3. Snapshot GUARDS-LOG.md, flip one byte of the FIRST drill entry's
//      "rebuild-node ok" detail, prove the flip took, and run ONLY the
//      guards-chain spec — the tamper is the point, so the other two specs
//      would only spend minutes.
//   4. Accept exit code 0 (the spec passed) ONLY if its own output says
//      "1 passed" — the spec is expected to PASS while the app inside it
//      reports the tamper as an UNVERIFIED FAILURE. Any other pair of
//      exit code and pass line is a red leg, including the silent-green
//      failure where the suite goes green without running the leg.
//   5. Restore the snapshot bytes unconditionally. The committed log must
//      leave this probe byte-exact; a restore failure is a red exit, and
//      git's own cleanliness is the belt-and-braces proof afterwards.

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const LOG = path.join(__dirname, "..", "GUARDS-LOG.md");
const SPEC = path.join("tests", "e2e", "guards-chain.spec.ts");
const CANARY = "rebuild-node ok";
const SABOTAGED = "rebuild-node oK";

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

let original;
let exitCode = 0;
try {
  runNpm("dist must match HEAD", "build");

  // The exact pretest:e2e order (rule 3): rebuild first, then the live gate.
  runNpm("heal to Electron ABI", "rebuild:electron");
  runNpm("prove the Electron ABI", "verify:abi:electron");

  original = fs.readFileSync(LOG, "utf8");
  const tampered = original.replace(CANARY, SABOTAGED);
  if (tampered === original) {
    console.error(`tamper-probe: canary "${CANARY}" not found in GUARDS-LOG.md — refusing to run without a tamper`);
    process.exit(1);
  }
  fs.writeFileSync(LOG, tampered, "utf8");
  process.stdout.write(`tamper-probe: GUARDS-LOG.md tampered (${CANARY} -> ${SABOTAGED})\n`);

  let output = "";
  let specStatus = 0;
  try {
    output = run("run only the guards-chain spec under the tamper", [
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

  // The verdict the leg actually asserts: the app under test must have
  // reported the tamper as an unverified FAILURE (the spec's Phase 3),
  // and the single-spec suite must be green. Green output without the
  // pass line is a silent-green failure — the leg's whole reason to exist.
  const passes = (output.match(/(\d+) passed/g) ?? []).map((m) => Number(m.replace(/\D/g, "")));
  const passed = passes.length === 1 && passes[0] === 1 && specStatus === 0;
  process.stdout.write(`tamper-probe: spec status ${specStatus}, playwright output said ${(passes.join(", ") || "nothing")} passed\n`);
  if (!passed) {
    console.error("tamper-probe: leg FAILED — expected the guards-chain spec to pass (1 passed) with the app reporting the tamper as unverified");
    exitCode = 1;
  } else {
    process.stdout.write("tamper-probe: leg PASSED — tampered log was served as unverified FAILURE through the real preload bridge\n");
  }
} catch (err) {
  console.error(`tamper-probe: leg FAILED — ${err.message}`);
  exitCode = 1;
} finally {
  if (original !== undefined) {
    try {
      fs.writeFileSync(LOG, original, "utf8");
      const restored = fs.readFileSync(LOG, "utf8");
      if (restored !== original) {
        console.error("tamper-probe: restore verification mismatch — the log is not byte-exact");
        exitCode = 1;
      } else {
        process.stdout.write("tamper-probe: GUARDS-LOG.md restored byte-exact\n");
      }
    } catch (err) {
      console.error(`tamper-probe: RESTORE FAILED (${err.message}) — GUARDS-LOG.md may still be tampered on disk`);
      exitCode = 1;
    }
  }
}

process.exit(exitCode);
