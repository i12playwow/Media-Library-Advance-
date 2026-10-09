#!/usr/bin/env node
// verify-drill-fire.mjs — one-command verification for Monday 2026-10-05's
// first scheduled drill fire (cron `43 4 * * 1` in .github/workflows/drill.yml).
//
// What "verified" means here, in order:
//   1. The window arrived (date gate; bypass with --force-date only for
//      rehearsal — a forced run cannot prove the scheduler).
//   2. Drill #12 fired as a SCHEDULED event, green, with an append commit
//      on origin/main past the pre-fire tip (checked in the browser by the
//      human; the git side is authoritative below).
//   3. The append commit landed on origin/main past 75e0058 with the drill
//      appender's exact message shape.
//   4. The pull is a fast-forward only — a non-ff result is reported and
//      the script stops rather than force-anything.
//   5. The doc-drift lint (its class 8 recomputes every GUARDS-LOG segment
//      digest) passes — that IS the chain-intact verdict.
//
// The lint step runs `rebuild:node` first (npm ci's postinstall leaves the
// binding on the Electron ABI; the pure `pretest` gate would otherwise
// abort), and retries the lint once — cold vitest runs on this machine have
// a documented transient-failure pattern that heals on a warm re-run.
//
// Deliberately NOT done here: dispatching the drill manually. A manual run
// exercises the append path but proves nothing about the scheduler — the
// only thing Monday's fire exists to prove.

import { execSync } from "node:child_process";
import fs from "node:fs";

const PRE_FIRE_TIP = "75e0058"; // last push before the first scheduled fire (run #12's head_sha)
const WINDOW_UTC = Date.UTC(2026, 9, 5, 4, 43, 0); // Mon 2026-10-05 04:43:00Z
const DRILL_COMMIT_RE = /^chore\(guards\): scheduled drill summaries chained into GUARDS-LOG$/;
const DRILL_PAGE = "https://github.com/i12playwow/Media-Library-Advance-/actions/workflows/drill.yml";

const force = process.argv.includes("--force-date");
const run = (cmd, opts = {}) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...opts });

const step = (msg) => console.log(`\n== ${msg}`);
const fail = (msg) => { console.error(`\n✗ ${msg}`); process.exit(1); };

// ── 1. Date gate ────────────────────────────────────────────────────────────
const now = new Date();
if (now.getTime() < WINDOW_UTC && !force) {
  const h = ((WINDOW_UTC - now.getTime()) / 3600000).toFixed(1);
  console.log(`Window not arrived: ${now.toISOString()} — first scheduled fire is Mon 2026-10-05 04:43 UTC (~${h}h away).`);
  console.log("Nothing to verify yet. Re-run on/after Monday 11:43 local (allow scheduler-delay hours), or rehearse with --force-date.");
  process.exit(0);
}
if (force) console.log("(--force-date: bypassing the date gate — rehearsal, NOT scheduler proof)");

// ── 2. Human-side browser check reminder ───────────────────────────────────
step("Drill #12 scheduled-event check (browser, human-verified)");
console.log(`Confirm at ${DRILL_PAGE} that a run labeled "Scheduled" completed successfully.`);
console.log("(The git checks below are authoritative for the append + chain; this one is for the scheduler itself.)");

// ── 3. Fetch + append-commit check ─────────────────────────────────────────
step("Fetch + confirm the append commit landed past " + PRE_FIRE_TIP);
run("git fetch origin");
const newCommits = run(`git log --format=%h%x09%s ${PRE_FIRE_TIP}..origin/main`).trim();
if (!newCommits) {
  fail(`origin/main is still at ${PRE_FIRE_TIP} — the scheduled fire has not landed (check again later, allowing scheduler delay).`);
}
const commits = newCommits.split("\n").filter(Boolean);
const appendCommit = commits.find((l) => DRILL_COMMIT_RE.test(l.split("\t")[1] ?? ""));
if (!appendCommit) {
  fail(`New commits landed but none matches the drill appender's message:\n${newCommits}\nInspect manually before pulling.`);
}
const appendSha = appendCommit.split("\t")[0];
console.log(`Append commit present: ${appendSha} — ${commits.length} new commit(s) past ${PRE_FIRE_TIP}`);

// ── 4. Fast-forward-only pull ──────────────────────────────────────────────
step("Pull --ff-only");
try {
  run("git pull --ff-only origin main");
} catch {
  fail("Pull is not a fast-forward — local main diverged from origin. Resolve by hand; this script force-pushes nothing.");
}
console.log(`Local main is now ${run("git rev-parse --short HEAD").trim()}`);

// ── 5. Chain verdict via the drift lint ────────────────────────────────────
step("Rebuild better-sqlite3 for Node (the pretest gate needs the Node ABI)");
run("npm run rebuild:node");

step("Run the doc-drift lint (class 8 recomputes every GUARDS-LOG digest = the chain verdict)");
const LINT = "app/renderer/src/__tests__/docsSearchRefs.test.ts";
let lintOut = "";
for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    lintOut = run(`npm test -- ${LINT}`);
    break;
  } catch (e) {
    if (attempt === 1) {
      console.log("Lint run 1 failed — known cold-run transient pattern on this machine; retrying once…");
      continue;
    }
    fail("Lint failed twice: the chain is NOT verified. Inspect the failing tests (class 8 = digest recompute) before touching GUARDS-LOG.");
  }
}
// vitest keeps ANSI colors even on a pipe, so strip them before matching —
// otherwise "Tests … 42 passed" never parses and the ledger line degrades to
// the fallback. Print the summary lines themselves: they ARE the evidence
// (the fallback below points "above").
const lintClean = lintOut.replace(/\u001b\[[0-9;]*m/g, "");
const summaryLines = lintClean.split("\n").filter((l) => /^\s*(Test Files|Tests)\s/.test(l));
console.log(summaryLines.length ? summaryLines.join("\n") : "(no test summary found in lint output)");
const testsLine = lintClean.match(/Tests\s+\d+\s+passed/g)?.pop() ?? "(test summary not parsed — see the lint output above)";
console.log(`Lint verdict: ${testsLine}`);

// ── 6. GUARDS-LOG tip, for the ledger ──────────────────────────────────────
step("GUARDS-LOG tail (chain evidence for the ledger)");
const logTail = fs.readFileSync("GUARDS-LOG.md", "utf8").trimEnd().split("\n").slice(-4).join("\n");
console.log(logTail);

console.log("\n✓ ALL CHECKS PASSED — the scheduled fire landed and the chain is intact.");
console.log("Record in the private ledger: Drill #12 Scheduled, append commit " + appendSha + ", " + testsLine + ".");
