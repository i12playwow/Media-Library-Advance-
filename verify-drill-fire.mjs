#!/usr/bin/env node
// verify-drill-fire.mjs — one-command verification of a scheduled drill
// fire (cron `43 4 * * 1` in .github/workflows/drill.yml). Default target:
// the LATEST schedule-triggered run; `--run N` selects a specific drill run
// number (any fire after #12, and #12 itself); `--history N` widens the
// trend window (default 3) that re-proves the append across recent fires.
//
// What "verified" means here, in order:
//   1. The first-fire window (Mon 2026-10-05 04:43 UTC) has arrived — the
//      earliest a scheduled fire could exist (bypass with --force-date only
//      for rehearsal — a forced run cannot prove the scheduler).
//   2. The target drill run fired as a SCHEDULED event, green, on its own
//      head_sha — proven machine-side against the GitHub Actions API (run
//      number, event, status, conclusion, head_sha), URL printed for human
//      eyeball. That head_sha IS the pre-fire tip for step 3, so nothing is
//      hard-pinned to one week.
//   3. The append commit for THAT run landed on origin/main past the fire's
//      head_sha with the drill appender's exact message shape AND the run's
//      own id in its GUARDS-LOG diff — two fires on the same head_sha (no
//      pushes between weeks) must not let last week's append pass this
//      week's check.
//   3b. The same append proof repeats across the last `--history N`
//      scheduled fires (default 3): a single latest-fire check cannot see
//      an older week whose append never landed, so a GREEN fire missing
//      its append prints a ✗ trend line (with its run url) and fails the
//      run. Non-green fires are reported as context only — the chain
//      cannot owe evidence for a fire that never went green.
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
// Failure paths print one readable ✗ line (the child's own stderr streams
// live above it) instead of an execSync stack trace, and every cwd-relative
// operation is anchored to the repo this script lives in, so invoking it
// from any directory behaves identically.
//
// Deliberately NOT done here: dispatching the drill manually. A manual run
// exercises the append path but proves nothing about the scheduler — the
// only thing Monday's fire exists to prove.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WINDOW_UTC = Date.UTC(2026, 9, 5, 4, 43, 0); // Mon 2026-10-05 04:43:00Z — the first scheduled fire
const DRILL_COMMIT_RE = /^chore\(guards\): scheduled drill summaries chained into GUARDS-LOG$/;
const REPO = "i12playwow/Media-Library-Advance-";
const DRILL_PAGE = `https://github.com/${REPO}/actions/workflows/drill.yml`;
const DRILL_RUNS_API = `https://api.github.com/repos/${REPO}/actions/workflows/drill.yml/runs?event=schedule&per_page=100`;

const force = process.argv.includes("--force-date");
// Anchor every cwd-relative operation (git, npm, GUARDS-LOG.md) to the repo
// this script lives in — running from outside the repo root must behave
// exactly like running from inside it.
const repoRoot = path.dirname(fileURLToPath(import.meta.url));
const run = (cmd, opts = {}) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], cwd: repoRoot, ...opts });

const step = (msg) => console.log(`\n== ${msg}`);
// fs.writeSync(2, …): process.exit() can drop an async stderr write when
// stderr is a pipe (POSIX), which would lose the one line saying what failed.
const fail = (msg) => { fs.writeSync(2, `\n✗ ${msg}\n`); process.exit(1); };
// Run a command as a named check. The child's stderr is inherited (already
// visible above the ✗ line), so on failure the only thing missing without
// this wrapper is the context — an uncaught execSync throw would print its
// raw stack trace instead of a verdict.
const runOr = (what, cmd, opts) => {
  try {
    return run(cmd, opts);
  } catch (e) {
    const why = e?.status != null ? `exit ${e.status}` : `signal ${e?.signal ?? "unknown"}`;
    fail(`${what} failed (${why}): ${cmd}`);
  }
};

// `--run N` selects a specific drill run number; default = the latest one.
const runFlagIdx = process.argv.indexOf("--run");
const wantRun = runFlagIdx === -1 ? null : Number.parseInt(process.argv[runFlagIdx + 1] ?? "", 10);
if (runFlagIdx !== -1 && (!Number.isInteger(wantRun) || wantRun < 1)) {
  fail("--run needs a positive integer drill run number, e.g. --run 13");
}

// `--history N` widens the trend window; default = the last 3 scheduled fires.
const historyFlagIdx = process.argv.indexOf("--history");
const historyN = historyFlagIdx === -1 ? 3 : Number.parseInt(process.argv[historyFlagIdx + 1] ?? "", 10);
if (!Number.isInteger(historyN) || historyN < 1) {
  fail("--history needs a positive integer fire window, e.g. --history 5");
}

// ── 1. Date gate ────────────────────────────────────────────────────────────
const now = new Date();
if (now.getTime() < WINDOW_UTC && !force) {
  const h = ((WINDOW_UTC - now.getTime()) / 3600000).toFixed(1);
  console.log(`Window not arrived: ${now.toISOString()} — first scheduled fire is Mon 2026-10-05 04:43 UTC (~${h}h away).`);
  console.log("Nothing to verify yet. Re-run on/after Monday 11:43 local (allow scheduler-delay hours), or rehearse with --force-date.");
  process.exit(0);
}
if (force) console.log("(--force-date: bypassing the date gate — rehearsal, NOT scheduler proof)");

// ── 2. Scheduler proof via the GitHub API ──────────────────────────────────
step("Scheduled-event check (GitHub Actions API)");
const apiHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "verify-drill-fire",
  "X-GitHub-Api-Version": "2022-11-28",
};
const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
if (ghToken) apiHeaders.Authorization = `Bearer ${ghToken}`;
let scheduled;
let schedules = [];
try {
  const res = await fetch(DRILL_RUNS_API, { headers: apiHeaders });
  if (!res.ok) {
    fail(`GitHub API answered ${res.status} ${res.statusText} for the drill's scheduled runs — scheduler proof unavailable.`);
  }
  schedules = ((await res.json()).workflow_runs ?? []).filter((r) => r.event === "schedule");
  scheduled = wantRun ? schedules.find((r) => r.run_number === wantRun) : schedules[0];
  if (!scheduled) {
    fail(wantRun
      ? `No schedule-triggered drill run #${wantRun} found (${schedules.length} scheduled run(s) on record) — nothing to verify. ${DRILL_PAGE}`
      : `No schedule-triggered drill run exists yet — the drill has never fired. ${DRILL_PAGE}`);
  }
} catch (e) {
  fail(`GitHub API unreachable — scheduler proof unavailable (${e?.message ?? e}).`);
}
if (scheduled.event !== "schedule" || scheduled.status !== "completed" || scheduled.conclusion !== "success") {
  fail(`Drill run #${scheduled.run_number} is event=${scheduled.event} status=${scheduled.status} conclusion=${scheduled.conclusion} — not a green scheduled fire. ${scheduled.html_url}`);
}
const preTip = String(scheduled.head_sha ?? "");
if (preTip.length < 7) {
  fail(`Scheduled run #${scheduled.run_number} reports no usable head_sha — cannot anchor the git check.`);
}
console.log(`Drill run #${scheduled.run_number} green: ${scheduled.html_url}`);
console.log(`  event ${scheduled.event}, head ${preTip.slice(0, 7)}, ${scheduled.created_at} → ${scheduled.updated_at} (status=${scheduled.status})`);
console.log(`(Optional human eyeball: ${DRILL_PAGE})`);

// ── 3. Fetch + append-commit check ─────────────────────────────────────────
step(`Fetch + confirm run #${scheduled.run_number}'s append landed past ${preTip.slice(0, 7)}`);
runOr("git fetch", "git fetch origin");
const newCommits = runOr("git log (range from the fire's head_sha)", `git log --format=%H%x09%s ${preTip}..origin/main`).trim();
if (!newCommits) {
  fail(`origin/main is still at ${preTip.slice(0, 7)} — run #${scheduled.run_number}'s append has not landed (check again later, allowing scheduler delay).`);
}
const commits = newCommits.split("\n").filter(Boolean);
const appenderLines = commits.filter((l) => DRILL_COMMIT_RE.test(l.split("\t")[1] ?? ""));
if (!appenderLines.length) {
  fail(`New commits landed but none matches the drill appender's message:\n${newCommits}\nInspect manually before pulling.`);
}
// The append belonging to THIS run: its GUARDS-LOG diff carries the run's
// own URL/id — same-head_sha weeks and manual dispatch appends can't pass
// this run's check by accident.
let appendCommit = null;
for (const line of appenderLines) {
  const sha = line.split("\t")[0];
  const patch = runOr("git show (append diff)", `git show --format= --unified=0 ${sha} -- GUARDS-LOG.md`);
  if (patch.includes(`runs/${scheduled.id}`)) { appendCommit = line; break; }
}
if (!appendCommit) {
  fail(`An appender-shaped commit exists past ${preTip.slice(0, 7)}, but none references scheduled run #${scheduled.run_number} (id ${scheduled.id}) — run #${scheduled.run_number}'s append has not landed (check again later).`);
}
const appendSha = appendCommit.split("\t")[0].slice(0, 7);
console.log(`Append commit present: ${appendSha} — ${commits.length} commit(s) past ${preTip.slice(0, 7)}, run #${scheduled.run_number} line confirmed in its diff`);

// ── 3b. Trend: the same append proof across the last N fires ───────────────
// A single green fire can hide an older hole: if an earlier week's append
// never landed, this week's append still satisfies step 3. The trend repeats
// the check across the newest `--history N` scheduled fires (default 3) so a
// gap is visible as a line; any GREEN fire missing its append fails the run.
// Non-green fires are context only — the chain cannot owe evidence for a
// fire that never went green.
step(`Trend: the last ${historyN} scheduled fire(s)`);
const trendWindow = schedules.slice(0, historyN); // newest first
let greenFires = 0;
let greenLanded = 0;
for (const fire of [...trendWindow].reverse()) {
  const label = `run #${fire.run_number} (${String(fire.created_at).slice(0, 10)}, head ${String(fire.head_sha).slice(0, 7)})`;
  const green = fire.event === "schedule" && fire.status === "completed" && fire.conclusion === "success";
  if (!green) {
    console.log(`  ⚠ ${label} — not green (status=${fire.status}, conclusion=${fire.conclusion}); context only`);
    continue;
  }
  greenFires++;
  const head = String(fire.head_sha ?? "");
  if (head.length < 7) fail(`Scheduled run #${fire.run_number} reports no usable head_sha — cannot anchor the trend.`);
  const range = runOr("git log (trend range)", `git log --format=%H%x09%s ${head}..origin/main`).trim();
  const candidates = range
    .split("\n")
    .filter(Boolean)
    .map((l) => l.split("\t"))
    .filter(([, subject]) => DRILL_COMMIT_RE.test(subject ?? ""));
  let landed = null;
  for (const [sha] of candidates) {
    const patch = runOr("git show (trend append diff)", `git show --format= --unified=0 ${sha} -- GUARDS-LOG.md`);
    if (patch.includes(`runs/${fire.id}`)) { landed = sha.slice(0, 7); break; }
  }
  if (!landed) {
    console.log(`  ✗ ${label} — green fire, but no append referencing it ever landed past ${head.slice(0, 7)}`);
    fail(`Trend regression: scheduled run #${fire.run_number} (id ${fire.id}) is green, yet its append is missing from origin/main — the chain has that week's evidence missing. Check ${fire.html_url}`);
  }
  greenLanded++;
  console.log(`  ✓ ${label} — append ${landed}`);
}
console.log(`Trend: ${greenLanded}/${greenFires} green fire(s) in the window have their own append landed (${trendWindow.length} of ${schedules.length} scheduled fire(s) on record).`);

// ── 4. Fast-forward-only pull ──────────────────────────────────────────────
step("Pull --ff-only");
try {
  run("git pull --ff-only origin main");
} catch {
  fail("Pull is not a fast-forward — local main diverged from origin. Resolve by hand; this script force-pushes nothing.");
}
console.log(`Local main is now ${runOr("git rev-parse", "git rev-parse --short HEAD").trim()}`);

// ── 5. Chain verdict via the drift lint ────────────────────────────────────
step("Rebuild better-sqlite3 for Node (the pretest gate needs the Node ABI)");
runOr("npm run rebuild:node", "npm run rebuild:node");

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
const logPath = path.join(repoRoot, "GUARDS-LOG.md");
let logTail;
try {
  logTail = fs.readFileSync(logPath, "utf8").trimEnd().split("\n").slice(-4).join("\n");
} catch (e) {
  fail(`Cannot read ${logPath} (${e?.code ?? e?.message ?? e}) — is this script still inside its repo?`);
}
console.log(logTail);

console.log("\n✓ ALL CHECKS PASSED — drill run #" + scheduled.run_number + " landed, every green fire in the last " + trendWindow.length + "-fire window has its append, and the chain is intact.");
console.log("Record in the private ledger: Drill #" + scheduled.run_number + " Scheduled, append commit " + appendSha + ", " + testsLine + ".");
