#!/usr/bin/env node

// Nightly liveness check for the Drift Lint heartbeat
// (.github/workflows/drift-lint.yml).
//
// The heartbeat is an independent daily cron, so the one failure it cannot
// report itself is silence: a disabled schedule, a fire the scheduler drops,
// or a renamed/deleted workflow leaves no red run behind. This script asks the
// Actions API for the newest *scheduled* run and fails the nightly when none
// is fresh enough, which turns that silence into a red CI step.
//
// Manual dispatches deliberately do not count: one proves the workflow can
// run, never that its clock still fires. The token comes from the environment
// and is never printed; the CI job grants Actions: read for this call.

const MAX_AGE_HOURS = 36;
const WORKFLOW_FILE = "drift-lint.yml";
const API_VERSION = "2022-11-28";

function fail(message) {
  console.error(`drift-lint heartbeat: ${message}`);
  process.exitCode = 1;
}

function newestRun(runs) {
  return runs
    .filter((run) => Number.isFinite(Date.parse(run.created_at)))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const api = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/+$/, "");

  if (!repo) return fail("GITHUB_REPOSITORY is not set (expected owner/repo)");
  if (!token) return fail("GITHUB_TOKEN is not set; the check needs Actions: read");

  // Newest first is the API's order, but the answer is re-derived below so a
  // change in ordering cannot make this check quietly read the wrong run.
  const url = `${api}/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?event=schedule&per_page=10`;
  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": API_VERSION,
      },
    });
  } catch (error) {
    return fail(`could not reach ${api}: ${error.message}`);
  }

  if (response.status === 404) {
    return fail(
      `${WORKFLOW_FILE} is not visible in ${repo} (404) — the heartbeat may have been renamed, moved, or deleted`
    );
  }
  if (response.status === 401 || response.status === 403) {
    return fail(
      `GitHub rejected the token (${response.status}); the job needs permissions: actions: read`
    );
  }
  if (!response.ok) {
    return fail(`GitHub returned ${response.status} for ${url}`);
  }

  const body = await response.json();
  const runs = Array.isArray(body.workflow_runs) ? body.workflow_runs : [];
  const run = newestRun(runs);
  if (!run) {
    return fail(`no scheduled ${WORKFLOW_FILE} run was ever recorded in ${repo}`);
  }

  const ageHours = (Date.now() - Date.parse(run.created_at)) / 3_600_000;
  const last = `run #${run.run_number} at ${run.created_at} (${run.conclusion ?? run.status})`;
  const link = run.html_url ? ` — ${run.html_url}` : "";

  if (ageHours > MAX_AGE_HOURS) {
    return fail(
      `the newest scheduled run is ${ageHours.toFixed(1)}h old, beyond the ${MAX_AGE_HOURS}h budget; last seen ${last}${link}`
    );
  }

  console.log(
    `drift-lint heartbeat alive: ${last}, ${ageHours.toFixed(1)}h ago (budget ${MAX_AGE_HOURS}h)${link}`
  );
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
