# Contributing to MLA+

Short version: run `npm test` before you push; CI runs the same thing, plus the Electron e2e suite and a typecheck.
[docs/architecture.md](docs/architecture.md) maps the codebase,
[docs/testing.md](docs/testing.md) maps the tests and the two-runtime ABI
dance, and [docs/search.md](docs/search.md) documents the search stack.

## The enforcement stack (doc contracts, ABI contract)

This repo keeps three layers of guards so its documented contracts cannot
silently rot. Each catches a different class of drift, at a different time:

| Layer | Lives in | Runs when | Catches |
|---|---|---|---|
| 1. Static drift tests | `app/renderer/src/__tests__/docsSearchRefs.test.ts` | Every `npm test` (locally and in CI's unit job) | Docs that cite things that no longer exist — and package.json/ci.yml/database.ts changes that contradict what the docs promise |
| 2. CI-structure checks | `.github/workflows/ci.yml` (the `pretest` gate in the unit job, the direct `verify:abi:electron` in the e2e job) | Unit and typecheck on every push and PR; the e2e job nightly (plus manual dispatch) and on demand for PRs via the `run-e2e` label (pr-e2e.yml) | A broken or wrong-ABI native binding — before vitest or Playwright spend any time |
| 3. Behavioral drill | `scripts/drill-abi-contract.cjs` via `npm run drill:abi`; scheduled weekly in `.github/workflows/drill.yml` | On demand (~2 min), plus weekly on Windows, Ubuntu, and macOS clean checkouts (the Linux job adds the `scripts/tamper-probe.cjs` tamper leg); local runs append a per-leg history entry, and scheduled CI runs append one summary line per OS, to `GUARDS-LOG.md` | Behavior regressions the static layers cannot see: a gate that stops aborting, a hook that silently repairs the binding, `diagnose:abi -- --fix` claiming success falsely, a tampered `GUARDS-LOG.md` that stops turning the Settings card unverified |

**Layer 1 — the doc-drift lint.** The deep-dives under `docs/` are
linted, not just written: every path, filename, identifier, anchor, and npm
script they cite must exist (and every package.json script must be cited by
some doc, both directions). On top of that sit three contract classes, each
added after a real drift: the ABI-dance section's rule count and hook-behavior
claims must match `package.json`; its CI paragraph must match what ci.yml
actually runs (the unit job rebuilds before `npm test`, the e2e job gates
before it heals, bold step names verbatim); and
search.md's movies write-path and read-path tables must match database.ts
in both directions (an undocumented write or read site fails too),
architecture.md's
IPC surface table must match preload.ts/main.ts — prefixes used and
documented, every named channel real — and testing.md's rules 4/5/6 are
pinned to the gate/drill/healer script structure they describe. If your
PR fails
here, the fix is almost always to update the doc and the code **together**.

**Layer 2 — the gates.** `npm test` is `pretest` (a pure gate:
`scripts/abi-check.cjs` instantiates a real DB and runs FTS5, because
`require()` succeeding proves nothing) followed by vitest. The e2e flow's
`pretest:e2e` hook self-heals instead — the asymmetry is deliberate and
documented as rule 3 of the ABI dance. CI's unit job rebuilds explicitly so
the gate can stay pure; the e2e job checks the Electron runtime is present
(so the gate cannot degrade to parse-only unnoticed), proves the postinstall
state directly, and then lets `pretest:e2e` re-heal to the identical state
before Playwright runs, under xvfb.
You never run this layer by hand; you just never skip `npm test`.

**Layer 3 — the drill.** Static checks read files; the drill flips the
better-sqlite3 binding between ABIs and proves the contract *by runs*: the
gate must abort with the binding untouched (mtime-checked), `pretest:e2e`
must heal the identical state, and `diagnose:abi -- --fix` must restore
Node-ABI on demand — then it restores your machine in a `finally` block,
even when a leg fails. On CI's Linux runner the weekly drill applies the
same idea to the guards log: `scripts/tamper-probe.cjs` (via
`npm run probe:tamper`) runs the guards-chain e2e spec, whose own arc
tampers one byte of the committed `GUARDS-LOG.md` and requires the real
app to serve the tamper as an unverified FAILURE — the probe snapshots
the log and proves it byte-exact in its `finally` block.

### The scripts behind the dance

The seven files under `scripts/` implement the contract; [docs/testing.md](docs/testing.md)
specifies it in full:

- `scripts/lib/abi-state.cjs` — shared helpers: the **rule-1 FTS5 proof**
  (instantiate a real DB, CREATE/INSERT/MATCH — `require()` alone proves
  nothing), load-probing that parses the binding's `NODE_MODULE_VERSION` from
  the loader error, Electron-ABI resolution, and an npm runner.
- `scripts/abi-check.cjs` — the gate, in two modes. Node mode proves the
  binding live in the current process. `--electron` mode proves it live in the
  **real Electron runtime** by spawning the Electron binary with
  `ELECTRON_RUN_AS_NODE=1` and running the same FTS5 proof there; only when
  the Electron runtime is absent does it fall back to a parse-only verdict,
  which is strict enough to fail a binding that provably loads under Node.
- `scripts/rebuild-node.cjs` / `scripts/rebuild-electron.cjs` — the two
  directions of the dance: `npm rebuild better-sqlite3` (Node ABI) and
  `electron-builder install-app-deps`, the exact postinstall command
  (Electron ABI).
- `scripts/diagnose-abi.cjs` — state report; `--fix` heals the wrong-ABI
  state via `rebuild:node` and exits 0 only if the Node gate is green
  afterwards (`FIX OK`, binding-rewritten proof).
- `scripts/drill-abi-contract.cjs` — the 8 contract legs + R1–R2 restore,
  with a `finally`-guarded restore and the `GUARDS-LOG.md` append.
- `scripts/tamper-probe.cjs` — the CI drill's behavioral tamper leg (driven
  by `npm run probe:tamper`): runs the guards-chain e2e spec (which carries
  the tamper arc itself), accepts only a genuinely-run green verdict,
  re-prints the Playwright report on a red leg, and verifies the log
  byte-exact in its own `finally` block.

One implementation constraint is contractual because Windows enforces it:
**a successful load maps `better_sqlite3.node` into the loading process, and a
mapped binding cannot be replaced on disk.** The drill therefore never loads
the binding successfully in its own process after a rebuild — post-rebuild
verdicts come from child gates' exit codes (`pretest:e2e`, `diagnose --fix`),
never an in-process probe. The one in-process probe (leg 3) is safe because it
expects a load *failure*, which maps nothing. Violating this produced a real
9/10 drill run whose restore legs failed on a file lock (visible in
`GUARDS-LOG.md`); testing.md carries it as rule 5.

### When to run which

- **Always**: `npm test` — it runs layer 1 and exercises layer 2's gate.
  There is no scenario where you push without it.
- **On demand**: `npm run drill:abi` — run it whenever you touch
  `package.json` lifecycle hooks, `scripts/abi-check.cjs`, the rebuild
  scripts, or `scripts/diagnose-abi.cjs`, and whenever a machine's ABI state
  feels untrustworthy. It drives the contract's own commands internally —
  `npm run rebuild:node`, `npm run rebuild:electron`, `npm run verify:abi`,
  `npm run verify:abi:electron`, the `pretest`/`pretest:e2e` hooks, and
  `npm run diagnose:abi` with `--fix` — then restores your machine. It
  deliberately flips the binding between ABIs, so don't run it concurrently
  with another test process — and keep it away from a running Electron app
  too: the drill's restore rebuilds the binding, and a process holding the
  old binding mapped (Windows) would block the rewrite.
- **Never by hand**: layer 2's CI jobs — but if you rename a workflow step,
  remember the doc's bold step names must be renamed with it (layer 1 will
  remind you).

### Extending the stackNew deep-dive docs go into the DOCS array in the lint's source (deliberately
excluded from its own identifier corpus, so the array name itself can't be
cited back) and should arrive with a drift class if they make
machine-checkable claims — the lint's header comment documents each existing
class and the pattern for adding one. The guiding rule the stack enforces: **if a doc states a contract, something in the repo
must fail when the code stops honoring it.**

> Scope note: after a checkout lost the original lint file, the recreated
> `docsSearchRefs.test.ts` is layer 1 entire — **drift classes 2, 3, 4, 5, 6,
> 7, 8, 9, 10, 11, 12, 13, 14, 15, and 16** live there (class 14 keeps this very
> catalog in sync with the lint's actual class set), each named in the test
> list and catalogued in the file's header. Extend the lint — don't retire it.

## State of the guards

Every contract the docs promise, what fails at push time when the code stops
honoring it, and which runs prove the behavior still holds. Drill legs refer
to `scripts/drill-abi-contract.cjs` (legs 1–8 plus the R1–R2 restore).

| Contract | Stated in | Fails at push time via | Proven by runs |
|---|---|---|---|
| `require()` alone proves nothing — a gate must instantiate a DB and query FTS5 | testing.md, rule 1 | drift class 2: the hook bodies it asserts must gate | drill legs 1–2 and 4–5; the gate itself runs in every `npm test` |
| Skipped is not verified | testing.md, rule 2 | the lint's citation checks keep the claim honest | `docsSearchRefs.test.ts` never skips and runs in every suite on every OS |
| The hooks are asymmetric: `pretest` is a pure gate, `pretest:e2e` self-heals | testing.md, rule 3 | drift class 2: package.json bodies must match the claims | drill legs 4 vs 6 — the identical broken state, two opposite behaviors — plus leg 5's mtime proof that the gate never touches the binding |
| CI rebuilds explicitly so the unit gate stays pure; the e2e job proves the postinstall state, then `pretest:e2e` re-heals to the identical state | testing.md ↔ `.github/workflows/ci.yml` | drift class 3: unit-job rebuild before `npm test`, e2e gate before the suite (no healing first), bold step names verbatim, CI-only flake budget | drill leg 7; the scheduled drill starts from the postinstall state by design |
| `npm run diagnose:abi -- --fix` heals the case-1 state, exit 0 only if the gate is green | testing.md, rule 6 | drift class 9: the rebuild → gate → FIX OK order and the red-gate branch are pinned in diagnose-abi.cjs | drill leg 8: exit 0, FIX OK, binding rewritten, node gate green |
| The Electron-mode gate proves the binding live via `ELECTRON_RUN_AS_NODE`; its parse-only fallback fails a provably Node-ABI binding | testing.md, rule 4 | drift class 9: the spawn, the `--run-proof` child, the FTS5-only verdict, and the strict fallback's message are pinned in script source | drill legs 3 and 7 on every `npm run drill:abi`; the gate itself proves it whenever `verify:abi:electron` runs |
| The drill never loads the binding in its own process after a rebuild (Windows file lock) | testing.md, rule 5 | drift class 9: `probeBinding` appears exactly once, before the `finally`; post-rebuild verdicts are child exit codes | the drill's own R1/R2 legs on every run; the 9/10 incident that motivated the rule is in `GUARDS-LOG.md` |
| The movies write-path and read-path tables match database.ts, both directions | search.md | drift class 4: undocumented write or read sites fail too | the DB suites; every `npm test` runs the lint |
| The IPC surface table matches preload.ts/main.ts | architecture.md | drift class 6: prefixes used, prefixes documented, named channels real | the lint on every `npm test`, plus the e2e suite |
| The stack's self-description: layers, weekly cadence, exact OS matrix | CONTRIBUTING.md | drift class 5 (artifact paths, cron shape, matrix set equality) plus class 7 (the drill's script appetite) | the scheduled drill run itself — queued, three OSes, per-leg summary, 30-day artifacts, per-OS log lines committed to `GUARDS-LOG.md` |
| The committed guards log stays parseable and tamper-evident: the latest entry matches the drill's leg catalog, every CI summary line is well-formed, and every chained segment — entry or absorbed CI batch — digests every byte before it, with the log always ending on a chain line, and the digest algorithm pinned identically across drill writer, CI appender, refill, the settings service, and lint | `GUARDS-LOG.md` (its header) | drift class 8: entry skeleton, metadata line, per-leg rows, CI-line format, hash-chain verification, tip invariant, closed line vocabulary, digest-algorithm structural pins | every local `npm run drill:abi` (which chains its own append) plus the append-log job, whose chained lines must pass the same lint |
| Doc/config drift reaching main without a linted push is caught within a day by a dedicated heartbeat | `.github/workflows/drift-lint.yml` | drift class 15: the daily cron is pinned exactly and stays offset from the nightly and the drill, the job runs only the lint file behind the pure ABI gate, and the workflow stays read-only with no e2e and no unfiltered suite | the dispatched heartbeat run itself; the drift-lint job on every push through CI's unit job |
| A scheduled fire that nobody read still fails open — unless one command proves it ran, was green, appended, chained, and that recent fires did too | docs/testing.md (Verifying a scheduled fire), `verify-drill-fire.mjs`, `npm run verify:drill` | drift class 16: the doc section sits before the CI citation surface and names the flags the script parses; the `verify:drill` npm alias routes to the script; the date gate agrees with drill.yml's cron, the append-commit regex accepts drill.yml's own `commit -m` messages, the trend leg (`--history N`, default 3) fails closed when a green fire's append is missing, and the pipeline (schedule-filtered API proof on the run's `head_sha`, run id inside the append diff, ff-only pull with no push, rebuild → lint against the lint file itself, synchronous failure lines, one read-only fetch, no dispatch) is pinned in script source; the repo-root script joins class 12's credential scan | the verifier itself after every fire — `npm run verify:drill` (`--run N` for one specific fire, `--history N` for the trend window) |
| Every cited path, filename, identifier, anchor, npm script, and README badge exists; every workflow action is SHA-pinned; every script is documented somewhere | all five policed docs | the lint's citation checks (paths, scripts, workflow shapes) | every `npm test`, locally and in CI's unit job |

## Releases

A release is a tag plus a `gh release create vX.Y.Z --target main`. That
fires `.github/workflows/generator-generic-ossf-slsa3-publish.yml`, which
packages the Windows installer natively on a Windows runner, attaches it to
the release, and signs SLSA v3 provenance over its sha256 (builder ref
`@v2.1.0` — the generator rejects non-tag refs, the one lint-sanctioned
exception to SHA pinning). The repo is private, so the provenance skips the
public Rekor log (`private-repository: true`); it remains verifiable against
the workflow's OIDC identity with slsa-verifier.

Read the last two columns as different kinds of evidence: the push-time
column stops a drift from merging; the runs column is the proof that the
*behavior* — not just the text describing it — still holds today.
