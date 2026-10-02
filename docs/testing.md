# Testing: the two-runtime ABI dance

MLA+ runs its JavaScript in two different runtimes against one native module:

- **Node** runs the Vitest unit suite (`npm test`).
- **Electron** runs the app and the Playwright e2e suite (`npm run test:e2e`).

`better-sqlite3` is compiled for one `NODE_MODULE_VERSION` at a time. On a
current machine those are **137 for Node 24** and **145 for Electron 41** — a
binding built for one is unloadable in the other. Everything in this document
follows from that one fact, and every contract stated here is enforced by
something in the repo (see the "State of the guards" table in
[CONTRIBUTING.md](../CONTRIBUTING.md)).

## The suites

| Suite | Command | What it covers |
|---|---|---|
| ABI gate | `npm run verify:abi` (via `pretest`) | better-sqlite3 loads **and works** in the current runtime |
| Unit + component | `npm test` (gate + Vitest) | utils, videoId, components, DB/fileService integration, doc-citation lints |
| End-to-end | `npm run test:e2e` (`pretest:e2e` + build + Playwright) | the real Electron app against a throwaway profile |

## The ABI dance

The binding is flipped between ABIs by design; the scripts own the dance so
you never juggle it by hand:

| npm script | Script | Does |
|---|---|---|
| `rebuild:node` | `scripts/rebuild-node.cjs` | `npm rebuild better-sqlite3` — the package's own install logic fetches/builds the binding for **this Node** (unit-ready state) |
| `rebuild:electron` | `scripts/rebuild-electron.cjs` | `electron-builder install-app-deps` — the same command `postinstall` runs, installing the **Electron-ABI** binding (postinstall state) |
| `verify:abi` | `scripts/abi-check.cjs` | the Node-mode gate (pure — see rule 3) |
| `verify:abi:electron` | `scripts/abi-check.cjs --electron` | the Electron-mode gate (live proof — see rule 4) |
| `diagnose:abi` | `scripts/diagnose-abi.cjs` | report the current state; with `--fix`, heal to Node-ABI |

Shared state helpers (the FTS5 proof, ABI probing, npm runner) live in
`scripts/lib/abi-state.cjs`; no script in the dance ever mutates the binding
except the two `rebuild:*` scripts and `diagnose --fix`.

## The rules

**Rule 1 — `require()` alone proves nothing.** A green gate must instantiate a
real database and run FTS5 (CREATE VIRTUAL TABLE … fts5, INSERT, MATCH), not
merely load the `.node` file. `scripts/abi-check.cjs` does exactly that.

**Rule 2 — Skipped is not verified.** The sanity/citation tests
(`docsSearchRefs.test.ts`, the doc-drift lint) never conditionally skip; a test
that can silently skip proves nothing on a machine where it never runs. This
rule is enforced as drift class 10: the lint scans its own source (comments
stripped) and fails when any `it()` block carries no `expect()` on a real
value, and a module-level check throws — aborting collection — if any
skip/only/todo marker appears anywhere in the file, including on the
class-10 check itself (a marker there would otherwise silence its own
enforcer).

**Rule 3 — The hooks are asymmetric.** `pretest` is a **pure gate**: it never
rebuilds, never touches the binding — on a mismatch it prints the offending
`NODE_MODULE_VERSION`s and exits 1. `pretest:e2e` **self-heals**: it runs
`rebuild:electron` first, then the Electron-mode gate. The asymmetry is
deliberate: unit tests should surface a machine problem instead of silently
repairing it, while the e2e flow is allowed to spend the rebuild time because
it always needs the Electron ABI. Drill legs 4/5 vs 6 prove both behaviors on
the identical broken state.

**Rule 4 — The Electron-mode gate proves the binding live when it can.**
`verify:abi:electron` spawns the real Electron binary with
`ELECTRON_RUN_AS_NODE=1` (with `scripts/abi-check.cjs --run-proof` as the
child entrypoint) and runs the same FTS5 proof there, so a green verdict rests
on the binding actually working in Electron's runtime. Only when the Electron
runtime is **not installed** does the gate degrade to a parse-only fallback —
reported as such on success — and that fallback is deliberately strict: if the
binding *loads under Node* while `node-abi` says the Electron ABI differs, the
gate **fails** ("binding is Node-ABI, not Electron-ABI"), because a
Node-loadable binding is evidence *against* the Electron ABI whenever the two
ABIs differ. Install the Electron runtime (one `npm run start` downloads it)
and the gate proves the state live. This rule is enforced as drift class 9:
the lint pins the `ELECTRON_RUN_AS_NODE` spawn, the `--run-proof` child
entrypoint, the FTS5-only green verdict, the `electronRuntimePresent` gate on
the fallback, and the fallback's quoted failure message — in script source.

**Rule 5 — The drill never loads the binding in its own process on Windows.**

**Rule 5 — The drill never loads the binding in its own process on Windows.**
A *successful* load of `better_sqlite3.node` maps the file into the loading
process until exit. The drill's `finally` block rebuilds the binding; if the
drill process itself holds the file mapped, Windows refuses to replace it and
the restore legs fail (`rebuild-node failed (exit 1)`) even though the binding
is perfectly usable — observed for real as a 9/10 drill run. So the drill
never calls a load-succeeding probe after a rebuild: leg 6 is judged by
`pretest:e2e`'s own exit code, leg 8 by `diagnose --fix`'s `FIX OK` output
(only printed after its child Node gate ran green). The one in-process probe
(leg 3) is safe *because* it expects a load **failure** — a wrong-ABI load
maps nothing. If you extend the drill, keep post-rebuild verdicts in child
processes. Drift class 9 pins this structure: `probeBinding` may appear
exactly once in the drill, before the `finally` block, and legs 6/8 must be
judged by child exit codes.

**Rule 6 — Heal on demand, report honestly otherwise.** `npm run
diagnose:abi` reports the current state and exits 1 when the binding is not
unit-ready; `diagnose:abi -- --fix` heals the case-1 state (wrong-ABI
binding) via `rebuild:node` and exits **0 only if the Node gate is green
afterwards**, printing `FIX OK` with a binding-rewritten proof (mtime/size).
A unit-ready binding is reported as such and left untouched by `--fix`.
Drift class 9 pins the heal order (`rebuild:node` → `verify:abi` → `FIX OK`),
the exit-0-only-if-green branch, and the untouched unit-ready path.

## GUARDS-LOG.md

Every local `npm run drill:abi` appends a per-leg entry (10 rows, metadata
line with versions/commit/platform/duration); scheduled CI appends one summary
line per OS instead — the Linux one carrying the drill's behavioral tamper
verdict as an optional `· tamper holds|BROKEN` clause — and
`.github/workflows/drill.yml`'s append job commits
them chained into the log's hash chain through `scripts/append-drill-log.cjs`.
The log is committed after each local drill, and
`docsSearchRefs.test.ts` (drift class 8) keeps it parseable: the latest entry must match the drill's
leg catalog, and every CI line must be well-formed. The history is also
tamper-evident: the log is a sequence of chained segments — every drill entry
and every absorbed CI batch ends with a `- chain:` line — the sha256 of every
byte before it plus the running entry count — so a historical entry or CI
verdict cannot be silently edited or dropped; any such edit breaks every later
chain line, the file must always end with a chain line, and drift class 8
verifies all of it on every `npm test`. After a *legitimate*
rewrite of the log, `node scripts/refill-log-chain.cjs` re-seeds the whole
chain (verifying itself before writing) — a visible re-commit, never a silent
one. The digest algorithm itself is pinned: drift class 8 checks, by
structural markers with exact occurrence counts, that the drill writer, the
CI appender, the refill, and the lint's replay all hash the same bytes the
same way (one sha256 site each, the same file+appended-bytes boundary, the
same LF normalization).

## Fixing a red machine

```bash
npm run diagnose:abi          # what state am I in?
npm run diagnose:abi -- --fix # heal to Node-ABI (unit-ready), gate included
npm test                      # prove it
```

For the e2e suite you do not heal manually: `npm run test:e2e`'s
`pretest:e2e` hook rebuilds for Electron first (rule 3).

## CI

CI (`.github/workflows/ci.yml`, Ubuntu) keeps the same contract honest at
push time, and the doc-drift lint keeps this paragraph honest about CI:
every bolded name below is a real step in the workflow, and every command
cited here is a command a step really runs — stop matching and `npm test`
fails (drift class 3).

The unit and typecheck jobs fire on every push to main and on pull
requests. The e2e job fires on a nightly schedule (plus manual dispatch),
so dependency drift is caught without burning its minutes on every push —
and ABI-sensitive pull requests can run it on demand by adding the
`run-e2e` label: the label-gated caller (pr-e2e.yml, pull_request_target)
then invokes this same job against the PR's merge ref. Its concurrency
group is per-event, so a scheduled run can never cancel an in-progress
push run. Every external action is pinned to a commit SHA (the guards
table in CONTRIBUTING promises this; the lint enforces it across every
workflow file), with the SLSA generator's version tag as the one
documented exception. Dependabot keeps those pins current: its weekly
github-actions stream reads each pin's version comment and opens one
grouped PR that moves the SHA and its comment together, and the lint
holds every new pin to the same full-SHA standard.

In the unit job, **Install dependencies** runs `npm ci` and **Rebuild
better-sqlite3 for Node** runs `npm run rebuild:node` before **Run tests**
runs `npm test`, so the pure `pretest` gate proves a real Node-ABI state
rather than the postinstall mismatch.

In the e2e job, **Install Electron system dependencies** runs
`npx playwright install-deps chromium` — Electron needs Chromium's system
libraries on Linux, and the gate needs them installed to prove the binding
live — with three attempts, because apt mirror hiccups are routine on
shared runners, plus a linker-cache check (`ldconfig`) proving the
libraries actually landed: without a recognized distro, install-deps
exits 0 as a silent no-op. **Verify the Electron runtime is installed**
runs `test -x node_modules/electron/dist/electron` so the next step cannot
degrade silently: without the binary, `npm run verify:abi:electron`
falls back to a parse-only verdict (rule 4). **Prove the postinstall ABI**
runs `npm run verify:abi:electron` against the state `npm ci` actually
left behind, and only then does **Run the e2e suite** run
`xvfb-run --auto-servernum --server-args="-screen 0 1280x800x24" npm run test:e2e`,
whose `pretest:e2e` hook re-heals to the identical Electron-ABI state
(rule 3). The suite's flake budget is CI-only, and drift class 3 holds
this promise too: playwright.config.ts resolves `retries` to `2` when
`process.env.CI` is set and to `0` otherwise, resolves `trace` to
`retain-on-failure` and `screenshot` to `only-on-failure` under the same
condition, and keeps `video` on `retain-on-failure` everywhere — local
runs stay strict, with no retries and no capture. The gate before
the suite is what makes a postinstall regression surface as a red step
instead of a silent repair. On failure the job uploads `test-results/`
(traces, screenshots, videos) as a short-lived artifact, so a red run is
diagnosable without a re-run — and because the nightly run happens while
nobody watches, it also pages: **Notify on failure** posts a Slack- and
Discord-compatible message (repo, event, commit, run link) to the URL in
the CI_ALERT_WEBHOOK repository secret, retrying once; with the secret
unset the step skips quietly, so forks and unconfigured repos get no
noise.

The scheduled drill (`.github/workflows/drill.yml`, weekly, plus manual
dispatch) carries the same contract one step further than the nightly e2e
job: alongside the structural ABI drill on all three OSes, its Linux job
adds a behavioral tamper leg — **Install Electron system dependencies**
provisions the Chromium libraries and linker-cache proof exactly like the
e2e job, then **Run the tamper probe** runs the guards-chain e2e
spec against the real app: the spec's own arc flips one byte of
the committed `GUARDS-LOG.md`'s first drill entry and requires that tamper
to surface as the mandatory unverified FAILURE through the real preload
bridge (the probe pre-snapshots the log and proves it byte-exact after —
it deliberately does not tamper the log itself, so the spec's
verified-launch phase stays honest). The leg is
Linux-only because it launches Electron under xvfb and the drill leaves the
binding Node-ABI, so the probe heals its own ABI in the `pretest:e2e` order
(rule 3); rule 5 is why it is not part of the local drill. The verdict is
accepted only from Playwright's own output — a green suite without the
single passed test is a red leg — and it is recorded in history like any
other: the Linux summary line gains a `tamper holds|BROKEN` clause, holds
only when the probe's egress marker proves the leg passed, and the appender
refuses to append a line it cannot parse. The probe restores the log
byte-exactly in its own `finally` block, so a red leg never leaves a
tampered log behind.

Downloads are cached: **Cache Electron binary and Playwright browsers**
keys `~/.cache/electron` and `~/.cache/ms-playwright` on the lockfile hash,
so postinstall and the Playwright install skip what the cache already
holds. The cache is inert to the ABI contract — it stores downloads, never
the binding, and every gate verdict still comes from a live proof in the
job's own runtime.

### When the drill's append job goes red

The drill's **Append the chained CI summaries** job is the only writer of
`GUARDS-LOG.md` from CI, and its push can fail for exactly two reasons —
both recoverable without touching the log, which stays chained and
consistent either way (a failed push writes nothing):

1. **A race it could not win.** **Push (re-append on race, up to 3
   attempts)** already re-appends on a fresh tip twice before giving up;
   three losing races in a row means something was landing faster than
   the job could rebase — for a weekly cadence, almost always a
   human-pushed burst. Once the branch is quiet, re-run the failed job
   from the Actions tab: the appender rebuilds the batch from the run's
   artifacts on the new tip and the chain stays contiguous.
2. **A ruleset rejection.** `main` is guarded by the `main-guard-stack`
   ruleset, whose bypass list names the triggering user — not a bot
   identity, and GitHub offers no Actions actor to add to it. The append
   job therefore pushes through `secrets.GUARDS_PUSH_TOKEN` — a
   fine-grained personal access token scoped to this repository with
   read and write access to code and no expiration date — which checkout
   wires into origin's credentials so the push lands as the account that
   already bypasses the ruleset. This is the proven path: the first
   append after the token landed (run 36945421215, 2026-10-02) pushed
   and chained on the first attempt, and every green append since has
   ridden the same secret. Without it — secret absent, revoked, or
   stale after a rotation — checkout falls back to the default
   `github.token`, all three push attempts are rejected, and that
   failure is deliberate: the appender fails closed rather than writing
   through an unprivileged identity. The signature in the job log is a
   remote rejection (`! [remote rejected]`) repeating identically on
   every attempt — not a merge conflict, not a flaky test — and it is
   the token's cue: refresh the secret's value in the repository
   settings (generate the fine-grained PAT, store it as
   `GUARDS_PUSH_TOKEN`), then re-run the failed append job or dispatch
   the workflow from the Actions tab's **Run workflow** button on
   `main`. (Historically, before the token existed, manual dispatch was
   the only recovery because the dispatcher sat on the bypass list;
   runs 36699427758, 36698052223, and 36696559104 each pushed as the
   bot and were rejected. A PR fallback in the append job remains
   deliberately unbuilt.)

Either way the verdict lines themselves are safe: they ride in run
artifacts (30-day retention), so a red append job delays history, it
never loses it. The Monday-after diagnosis is: read the append job's
log, classify by the two signatures above, recover by refreshing
`GUARDS_PUSH_TOKEN` and re-running the job (rejection signature) or
just re-running it (race signature), and confirm `GUARDS-LOG.md`
gained exactly three OS lines ending with a fresh `- chain:` line.

### Billing-lock incident timeline (2026-09-22 → 2026-10-02, resolved)

The lock's real origin, per GitHub Support's reply on the earlier ticket (2026-09-30 08:32 UTC, agent Elodie): an earlier GitHub Copilot trial signup required a payment method, the system ran a card authorization check on it, the authorization failed, and the account was locked with Copilot never provisioned. Support then unlocked the account manually — that reply is the unlock event, landing minutes before the first green jobs. Both payment instruments offered during the incident failed independently (card declined by the issuer, PayPal agreement error), which is why the newer ticket produced no fix and was archived without a staff reply. The drill and the nightly e2e job executed for the first time inside this window, which is why several run IDs below are load-bearing history for the guards.

| When (UTC)          | Run                       | What happened                                                                   |
|---------------------|---------------------------|---------------------------------------------------------------------------------|
| Oct 1–2             | 36945421215, 36949763894  | append push unblocked: a fine-grained PAT (this repo only, read/write contents, rotated to no-expiry) stored as the GUARDS_PUSH_TOKEN secret; two green appends chained the CI lines (4a5ea3d, 938b889) and the flow was pinned as lint contract (0ef82af, 3f5d040) |
| Sep 30 09:59        | 36699427758               | Drill green on all three OSes; append push declined GH013 — the ruleset bypass list has no Actions actor (later fixed via a PAT secret) |
| Sep 30 09:45        | 36698052223               | ubuntu drill 10/10 legs + tamper holds; verdict captured cleanly despite a post-verdict SIGSEGV; append push declined GH013 |
| Sep 30 09:31        | 36696559104               | tamper leg green for the first time; drill verdict misread a crash line, the appender refused the malformed summary — fail-closed worked |
| Sep 30 09:11        | 36568175356 (re-run)      | first real execution of the CI jobs: TypeScript and e2e green; unit run exposed an env-blind config test (fixed same day) |
| Sep 30 08:46, 09:15 | 36691784332 (2 attempts)  | win/mac green; ubuntu exposed two drill bugs: a hardcoded leg 8 detail and the tamper probe defeating the spec verified-launch phase |
| Sep 30 ~08:40       | —                         | lock lifted by an explicit GitHub Support unlock (staff reply at 08:32); the newer ticket archived without a reply |
| Sep 30 07:00        | —                         | PayPal billing-agreement attempt failed with a generic processing error         |
| Sep 30 06:50        | 36653456402               | Drill dispatch: zero steps, billing-lock annotation (ground truth while the banner was up) |
| Sep 30 01:03        | 36653256689               | Drill dispatch: zero steps, billing-lock annotation                              |
| Sep 30 00:55–01:05  | —                         | card verification hold declined again (issuer security rules)                    |
| Sep 30 ~01:00       | —                         | billing address saved successfully (blank-country gap fixed)                     |
| Sep 29 12:27        | 36568175356               | CI on b7a122a: zero steps, billing-lock annotation                               |
| Sep 29 12:20        | 36567484788               | Drill dispatch: zero steps, billing-lock annotation                              |
| Sep 29 12:19        | —                         | card verification hold declined (issuer security rules; bank confirmed code-only)|
| Sep 29 06:59        | 36534038471               | Drill dispatch: zero steps, billing-lock annotation                              |
| Sep 29 06:14        | 36530092788               | CI on a Dependabot PR: zero steps, billing-lock annotation                        |
| Sep 29 05:12        | 36525085609               | CI: zero steps, billing-lock annotation                                          |
| Sep 29 04:07        | 36520190070               | CI: zero steps, billing-lock annotation (first symptom)                          |
| before Sep 22       | —                         | root cause (per Support's reply): a Copilot-trial signup's card authorization check failed, locking the account |

The balance was never real (Free plan, $0.02 metered usage in
September, no minutes ever consumed). Every killed job showed zero
executed steps with the same annotation: The job was not started
because your account is locked due to a billing issue.

The follow-up ledger ticket (opened 2026-10-01) keeps the processor-records question open: it asks GitHub for the Zuora-side entries behind the Sep 29–30 card declines and the PayPal billing-agreement error, neither of which the Copilot-trial explanation covers.
