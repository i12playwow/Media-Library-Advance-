import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

// docsSearchRefs.test.ts — the doc-drift lint (CONTRIBUTING.md layer 1,
// docs/testing.md rule 2: "Skipped is not verified" — this file never skips).
//
// Recreated with the guard stack. It currently enforces drift class 3, the
// CI contract: docs/testing.md's "CI" section and CONTRIBUTING.md's guards
// table promise a specific shape for .github/workflows/ci.yml, and this lint
// fails `npm test` when the workflow stops matching that shape — or when the
// docs drift from the workflow in the other direction:
//
//   drift class 3 — what the docs promise, ci.yml must run:
//     the unit job rebuilds for Node before the pure `pretest` gate;
//     the e2e job installs Electron's system libraries, then proves the
//     postinstall state, then (and only then) runs the suite — under xvfb —
//     whose `pretest:e2e` hook is the only healing step in the job;
//     the docs' bold step names are the workflow's real step names, and the
//     commands the docs cite are the commands the workflow actually runs;
//     the label-gated PR caller (pr-e2e.yml) must invoke this same job
//     against the PR's merge ref, label-gated and least-privileged.
//
//   drift class 4 — search.md's movies write-path and read-path tables must
//     match database.ts in both directions: every write or read site
//     documented with its SQL, every write or read site in the code covered
//     by the tables — in class methods and module-level functions alike,
//     each named unit's full string-literal inventory pinned exactly, with
//     conservation checks so no unsliced shape stays silent;
//
//   drift class 6 — architecture.md's IPC surface table must match the
//     code in both directions: prefixes used = prefixes documented, every
//     documented channel real (exposed by preload, handled by main), and
//     every push channel sent by main and subscribed in preload. The
//     scans run over comment-stripped source (commented-out channels are
//     not evidence), and a conservation check keeps every channel opening
//     literal — a wrapper/dynamic-channel refactor fails loudly instead of
//     dropping the surface out of the lint's view.
//
//   drift class 2 — package.json's hook bodies must match their claims:
//     `pretest` is a pure gate (no rebuild step anywhere in its body)
//     while `pretest:e2e` self-heals (rebuild first, then the
//     Electron-mode gate); postinstall installs the app deps for the
//     Electron ABI; every gate script is wired and exists; the drill
//     drives the scripts it claims to.
//
//   drift class 8 — GUARDS-LOG.md stays parseable AND tamper-evident: the
//     latest local entry matches the drill's leg catalog, every CI summary
//     line is well-formed, every segment (drill entry or CI batch chained
//     by scripts/append-drill-log.cjs) carries a digest of all bytes before
//     it, the log must end with a chain line, and every line belongs to the
//     drill/CI vocabulary — no foreign lines. The digest algorithm itself is
//     pinned identically across the drill writer, the CI appender, the
//     refill, and this lint by structural markers with exact counts.
//
//   drift class 9 — testing.md's rules 4/5/6 describe how the gate, drill,
//     and healer actually work; the lint pins the script structure those
//     descriptions claim: the electron-mode gate's ELECTRON_RUN_AS_NODE
//     spawn and its strict parse-only fallback; the drill's single,
//     pre-finally in-process probe (rule 5, the Windows file-lock rule);
//     diagnose --fix's rebuild → gate → FIX OK order, exit-0-only-on-green.
//
//   drift class 10 — the lint watches itself: every it() block in this file
//     must carry at least one expect() call on a real value (a bare string,
//     number, or boolean literal counts as empty), and no skip/only/todo
//     marker (it.skip, it.only, it.todo, describe.skip, skipIf/runIf) may
//     appear anywhere in the file — including on this very check — so an
//     emptied, vacuous, or skipped check fails npm test instead of passing
//     silently.
//
// Layer 1 is this one file; extend the catalog, don't retire it.

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");

// ── drift class 2 + 8 data: package.json hooks, the drill's leg catalog ────
const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const scripts = pkg.scripts as Record<string, string>;

const LEG_LABELS = [
  "1. rebuild:node (baseline)",
  "2. pretest gate green on Node-ABI baseline",
  "3. flip to Electron-ABI (postinstall state)",
  "4. npm test aborts on wrong-ABI binding",
  "5. gate leaves the binding untouched (pure gate)",
  "6. pretest:e2e self-heals the identical state",
  "7. verify:abi:electron proves the healed state directly",
  "8. diagnose --fix heals case 1 back to Node-ABI",
  "R1. restore: rebuild:node",
  "R2. restore: gate green (UNIT-READY)",
];

// Resolve playwright.config.ts with the given environment — proving what
// the config *does*, not what it says. The file is ESM-flavored TypeScript
// in a CommonJS package, so require() cannot load it directly: strip the
// types, translate the one named import and one default export the file is
// allowed to have, and evaluate the rest verbatim. Anything beyond that
// shape fails loudly rather than silently asserting nothing.
function resolvePlaywrightConfig(env: NodeJS.ProcessEnv) {
  const savedEnv = process.env;
  process.env = { ...savedEnv, ...env };
  try {
    const { stripTypeScriptTypes } = require("node:module");
    const js = stripTypeScriptTypes(
      fs.readFileSync(path.join(repoRoot, "playwright.config.ts"), "utf8")
    )
      .replace(/^\s*import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["'];?\s*$/m,
        (_m: string, names: string, from: string) => `const {${names}} = require("${from}");`)
      .replace(/^\s*export\s+default\s+/m, "module.exports.default = ");
    if (/^\s*(import|export)\b/m.test(js)) {
      throw new Error(
        "playwright.config.ts outgrew the loader's known shape (one named import, one default export)"
      );
    }
    const mod = { exports: {} as Record<string, unknown> };
    new Function("require", "module", "exports", js)(require, mod, mod.exports);
    return mod.exports.default as {
      retries: number;
      use: { video: string; trace?: string; screenshot?: string };
    };
  } finally {
    process.env = savedEnv;
  }
}

type Step = { name?: string; run?: string; uses?: string; if?: string; env?: Record<string, string> };
type Job = { name?: string; runsOn?: string; steps: Step[] };

function assignStepKey(step: Step, pair: string): void {
  // [\s\S] rather than . so a `run: |` block (joined with \n) still matches.
  const m = /^([\w-]+):\s*([\s\S]*)$/.exec(pair);
  if (!m) return;
  if (m[1] === "name") step.name = m[2];
  else if (m[1] === "run") step.run = m[2];
  else if (m[1] === "uses") step.uses = m[2];
  else if (m[1] === "if") step.if = m[2];
}

// A deliberately minimal reader for the workflow subset this repo uses
// (top-level `jobs:`, two-space job ids, six-space steps). It throws on
// shapes it does not recognize rather than silently asserting nothing.
// Anything above `jobs:` that matters to the contract (triggers) is read by
// parseWorkflowTopLevel; the rest of the preamble is left to js-yaml.
function parseWorkflowTopLevel(source: string): { on?: Record<string, unknown> } {
  const lines = source.split(/\r?\n/);
  const jobsAt = lines.indexOf("jobs:");
  if (jobsAt === -1) throw new Error("no top-level `jobs:` mapping in ci.yml");
  const out: { on?: Record<string, unknown> } = {};
  for (let i = 0; i < jobsAt; i++) {
    const line = lines[i].replace(/\s+$/, "");
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const m = /^(on|true):\s*$/.exec(trimmed);
    if (!m) continue; // name:, concurrency:, … are not contract material
    const on: Record<string, unknown> = {};
    let childIndent = -1;
    for (let j = i + 1; j < jobsAt; j++) {
      const raw = lines[j];
      const rawTrim = raw.trim();
      if (rawTrim === "" || rawTrim.startsWith("#")) continue;
      const indent = raw.length - raw.trimStart().length;
      if (indent <= m.index) break;
      if (childIndent !== -1 && indent > childIndent) continue; // nested detail (branches:, …) is opaque
      const child = /^(push|pull_request|pull_request_target|schedule|workflow_dispatch|workflow_call):\s*(.*)$/.exec(rawTrim);
      if (!child) throw new Error(`unrecognized trigger in ci.yml: ${JSON.stringify(raw)}`);
      childIndent = indent;
      if (child[1] === "schedule" && child[2] === "") {
        // The cron list is contract material (the nightly cadence), so it is
        // parsed rather than skipped — anything else under schedule: fails.
        const items: Array<{ cron?: string }> = [];
        let k = j + 1;
        for (; k < jobsAt; k++) {
          const raw2 = lines[k];
          const rawTrim2 = raw2.trim();
          if (rawTrim2 === "" || rawTrim2.startsWith("#")) continue;
          const indent2 = raw2.length - raw2.trimStart().length;
          if (indent2 <= indent) break;
          const cron = /^-\s+cron:\s*(.+)$/.exec(rawTrim2);
          if (!cron) throw new Error(`unrecognized schedule entry in ci.yml: ${JSON.stringify(raw2)}`);
          items.push({ cron: cron[1].trim() });
        }
        if (items.length === 0) throw new Error("schedule trigger has no cron entries in ci.yml");
        on.schedule = items;
        i = k - 1;
        continue;
      }
      if (child[2] === "") {
        // For the PR-family triggers, a `types:` list is contract material
        // (it decides which PR events can spend e2e minutes); other detail
        // keys (branches:, paths:, …) stay opaque.
        if (child[1] === "pull_request" || child[1] === "pull_request_target") {
          let types: string[] | undefined;
          let k = j + 1;
          for (; k < jobsAt; k++) {
            const raw2 = lines[k];
            const rawTrim2 = raw2.trim();
            if (rawTrim2 === "" || rawTrim2.startsWith("#")) continue;
            if (raw2.length - raw2.trimStart().length <= childIndent) break;
            const list = /^types:\s*\[([^\]]*)\]\s*$/.exec(rawTrim2);
            if (list) {
              types = list[1].split(",").map((t) => t.trim().replace(/^['"]|["']$/g, "")).filter(Boolean);
            }
          }
          on[child[1]] = types ? { types } : {};
        } else {
          on[child[1]] = {};
        }
      } else {
        on[child[1]] = child[2];
      }
      i = j;
    }
    out.on = on;
  }
  if (!out.on) throw new Error("no `on:` trigger mapping found in ci.yml");
  return out;
}
function parseCiWorkflow(source: string): Record<string, Job> {
  const lines = source.split(/\r?\n/);
  const jobsAt = lines.indexOf("jobs:");
  if (jobsAt === -1) throw new Error("no top-level `jobs:` mapping in ci.yml");
  const jobs: Record<string, Job> = {};
  let job: Job | null = null;
  let step: Step | null = null;

  for (let i = jobsAt + 1; i < lines.length; i++) {
    const line = lines[i].replace(/\s+$/, "");
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) break;

    if (indent <= 2) {
      const m = /^([A-Za-z][\w-]*):$/.exec(trimmed);
      if (!m) throw new Error(`unrecognized job line in ci.yml: ${JSON.stringify(line)}`);
      job = { steps: [] };
      jobs[m[1]] = job;
      step = null;
      continue;
    }

    if (!job) throw new Error("job-level content before any job id in ci.yml");

    if (!trimmed.startsWith("- ") && indent <= 4) {
      const m = /^([\w-]+):\s*(.*)$/.exec(trimmed);
      if (!m) throw new Error(`unrecognized job key in ci.yml: ${JSON.stringify(line)}`);
      if (m[1] === "name") job.name = m[2];
      else if (m[1] === "runs-on") job.runsOn = m[2];
      continue;
    }

    if (trimmed.startsWith("- ") && indent <= 6) {
      step = {};
      job.steps.push(step);
      assignStepKey(step, trimmed.slice(2));
      continue;
    }

    if (step && indent <= 8) {
      const m = /^([\w-]+):\s*(.*)$/.exec(trimmed);
      if (!m) throw new Error(`unrecognized step key in ci.yml: ${JSON.stringify(line)}`);
      if (m[1] === "env" && m[2] === "") {
        // An env block maps NAME: value at deeper indentation; the values
        // (secret expressions included) are what the notification contract
        // checks for, so they are captured rather than ignored.
        const env: Record<string, string> = {};
        let j = i + 1;
        for (; j < lines.length; j++) {
          const raw = lines[j];
          const rawTrim = raw.trim();
          if (rawTrim === "" || rawTrim.startsWith("#")) continue;
          if (raw.length - raw.trimStart().length <= 8) break;
          const kv = /^([A-Za-z_][A-Z0-9_]*):\s*(.*)$/.exec(rawTrim);
          if (!kv) throw new Error(`unrecognized env entry in ci.yml: ${JSON.stringify(raw)}`);
          env[kv[1]] = kv[2];
        }
        step.env = env;
        i = j - 1;
        continue;
      }
      if (m[2] === "|" || m[2] === "|-") {
        const block: string[] = [];
        let j = i + 1;
        for (; j < lines.length; j++) {
          const raw = lines[j];
          const rawTrim = raw.trim();
          if (rawTrim === "" || rawTrim.startsWith("#")) {
            block.push("");
            continue;
          }
          if (raw.length - raw.trimStart().length < 10) break;
          block.push(rawTrim);
        }
        assignStepKey(step, `${m[1]}: ${block.join("\n")}`);
        i = j - 1;
        continue;
      }
      assignStepKey(step, trimmed);
      continue;
    }
    // Deeper indentation (with:, env:, …) is irrelevant to the contract.
  }
  return jobs;
}

const ciPath = path.join(repoRoot, "\.github", "workflows", "ci.yml");
const ciSource = fs.readFileSync(ciPath, "utf8");
const jobs = parseCiWorkflow(ciSource);
const triggers = parseWorkflowTopLevel(ciSource).on as {
  push?: unknown;
  pull_request?: unknown;
  schedule?: unknown;
  workflow_dispatch?: unknown;
};

const testingMd = fs.readFileSync(path.join(repoRoot, "docs", "testing.md"), "utf8");
const ciSection = testingMd.slice(testingMd.indexOf("## CI"));

const contributingMd = fs.readFileSync(path.join(repoRoot, "CONTRIBUTING.md"), "utf8");
const architectureMd = fs.readFileSync(path.join(repoRoot, "docs", "architecture.md"), "utf8");
const searchMd = fs.readFileSync(path.join(repoRoot, "docs", "search.md"), "utf8");
const preloadSource = fs.readFileSync(path.join(repoRoot, "app", "main", "preload.ts"), "utf8");
const mainSource = fs.readFileSync(path.join(repoRoot, "app", "main", "main.ts"), "utf8");
const databaseSource = fs.readFileSync(path.join(repoRoot, "app", "database", "database.ts"), "utf8");

// ── drift class 9 data: the scripts behind testing.md's rules 4/5/6 ────────
const abiCheckSource = fs.readFileSync(path.join(repoRoot, "scripts", "abi-check.cjs"), "utf8");
const abiStateSource = fs.readFileSync(path.join(repoRoot, "scripts", "lib", "abi-state.cjs"), "utf8");
const drillSource = fs.readFileSync(path.join(repoRoot, "scripts", "drill-abi-contract.cjs"), "utf8");
const diagnoseSource = fs.readFileSync(path.join(repoRoot, "scripts", "diagnose-abi.cjs"), "utf8");

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

// ── drift class 10 data: the lint's own source ─────────────────────────────
// The self-scan reads this file's source with comments stripped first, so
// the catalogue above — which names the very markers the scan bans — cannot
// become evidence. Only comments are stripped (never strings: regex
// literals in this file legitimately hold quotes), and the stripper compares
// single characters, so its own source never contains the two-slash token
// it strips. If a future string literal ever holds that token, the stripper
// hides that line from the self-scan and the scan fails loudly (an
// empty-it failure) — never silently.
function stripLineComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1] ?? "";
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

const lintSourcePath = path.join(repoRoot, "app", "renderer", "src", "__tests__", "docsSearchRefs.test.ts");
const lintCode = stripLineComments(fs.readFileSync(lintSourcePath, "utf8"));

// The skip ban runs at module scope, deliberately OUTSIDE every it() body:
// a marker on the drift-class-10 check itself would otherwise silence its
// own enforcer (observed in a drill — a skipped meta-check passed as
// "25 passed | 1 skipped"). A module-level throw aborts collection, so it
// cannot be skipped by any vitest marker; it can only be deleted, and the
// deletion is catalogue drift (drift class 10 is named in this header, in
// testing.md's rule 2, and in CONTRIBUTING's scope note).
{
  const skipHit = /\b(?:it|describe|test)\.(?:only|skip|skipIf|skipUnless|runIf|todo)\(/.exec(lintCode);
  if (skipHit) {
    throw new Error(
      `drift class 10: skip/only/todo markers are banned file-wide in the lint (rule 2) — found: ${JSON.stringify(skipHit[0])}`
    );
  }
}

// ── drift class 6 data: comment-stripped IPC sources + conservation ────────
// The class-6 scans run over comment-stripped source: commented-out
// handlers, invokes, sends, or subscriptions must not keep the counts equal
// while the runtime surface dies. Conservation then pins the invariant that
// keeps indirection visible: every channel OPENING (ipcMain.handle(,
// invoke(, .send(, subscription on() in these two files must pass a literal
// "prefix:name" — refactoring the registrations behind a wrapper like
// register(channel, …) would otherwise drop the whole surface out of the
// lint's view silently instead of failing loudly.
const mainCode = stripLineComments(mainSource);
const preloadCode = stripLineComments(preloadSource);

const IPC_HANDLE_OPEN_RE = /ipcMain\.handle\(/g;
const IPC_HANDLE_LIT_RE = /ipcMain\.handle\(\s*"([a-zA-Z0-9]+:[a-zA-Z0-9]+)"/g;
const INVOKE_OPEN_RE = /invoke\(/g;
const INVOKE_LIT_RE = /invoke\(\s*"([a-zA-Z0-9]+:[a-zA-Z0-9]+)"/g;
const SEND_OPEN_RE = /\.send\(/g;
const SEND_LIT_RE = /\.send\(\s*"([a-zA-Z0-9]+:[a-zA-Z0-9]+)"/g;
const ON_OPEN_RE = /[^a-zA-Z]on\(/g;
const ON_LIT_RE = /[^a-zA-Z]on\(\s*"([a-zA-Z0-9]+:[a-zA-Z0-9]+)"/g;

// it() bodies are sliced by this file's own formatting convention: each it
// opens at exactly two-space indent and closes with `});` at the same indent.
// No paren counting — bodies legitimately contain regex literals whose text
// unbalances parentheses (see drift class 9's leg-count assertions).
const LINT_IT_OPEN_RE = /\n {2}it(?:\.[a-z]+)?\(/g;
const LINT_BODY_BOUND_RE = /\n {2}(?:it(?:\.[a-z]+)?\(|\}\);)/;

function lintItBodies(code: string): string[] {
  const opens = [...code.matchAll(LINT_IT_OPEN_RE)].map((m) => m.index! + 1);
  if (opens.length === 0) {
    throw new Error("lint self-scan found no it() blocks — the scanner's assumptions no longer hold");
  }
  const bodies: string[] = [];
  for (const start of opens) {
    const rest = code.slice(start);
    const bound = rest.search(LINT_BODY_BOUND_RE);
    if (bound === -1) {
      throw new Error("lint self-scan found an it() block without a two-space `});` closer");
    }
    bodies.push(rest.slice(0, bound));
  }
  return bodies;
}

// ── drift class 4 data: the movies-table write-path table (search.md) ──────
// Fragments are the SQL as it appears in database.ts; doc→code checks each
// against the source, code→doc checks every movies write site is covered.
// `exact` pins the FULL string-literal inventory of the unit (template
// literals and signature unions included): substring fragments alone would
// let a widened statement ("WHERE id = ? AND …") still contain the
// documented SQL. Comparisons normalize whitespace, so the entries can be
// written as the same one-liners as `fragments` while the code's multi-line
// templates still match.
const SEARCH_WRITE_PATHS: Array<{ method: string; fragments: string[]; exact: string[] }> = [
  {
    method: "upsertMovie",
    fragments: [
      // The whole statement is pinned, COALESCEs included: the upsert's
      // conflict behavior is part of the search contract.
      "INSERT INTO movies ( id, title, year, video_id, source_path, folder_path, library_mode, resolution, poster_url, poster_source, actresses_json, keywords_json, updated_at ) VALUES ( @id, @title, @year, @videoId, @sourcePath, @folderPath, @libraryMode, @resolution, @posterUrl, @posterSource, @actressesJson, @keywordsJson, @updatedAt ) ON CONFLICT(id) DO UPDATE SET title = excluded.title, year = excluded.year, video_id = COALESCE(excluded.video_id, movies.video_id), source_path = excluded.source_path, folder_path = excluded.folder_path, library_mode = excluded.library_mode, resolution = excluded.resolution, poster_url = COALESCE(excluded.poster_url, movies.poster_url), poster_source = CASE WHEN excluded.poster_url IS NOT NULL THEN excluded.poster_source ELSE movies.poster_source END, actresses_json = excluded.actresses_json, keywords_json = excluded.keywords_json, updated_at = excluded.updated_at",
    ],
    exact: [
      "none",
      "INSERT INTO movies ( id, title, year, video_id, source_path, folder_path, library_mode, resolution, poster_url, poster_source, actresses_json, keywords_json, updated_at ) VALUES ( @id, @title, @year, @videoId, @sourcePath, @folderPath, @libraryMode, @resolution, @posterUrl, @posterSource, @actressesJson, @keywordsJson, @updatedAt ) ON CONFLICT(id) DO UPDATE SET title = excluded.title, year = excluded.year, video_id = COALESCE(excluded.video_id, movies.video_id), source_path = excluded.source_path, folder_path = excluded.folder_path, library_mode = excluded.library_mode, resolution = excluded.resolution, poster_url = COALESCE(excluded.poster_url, movies.poster_url), poster_source = CASE WHEN excluded.poster_url IS NOT NULL THEN excluded.poster_source ELSE movies.poster_source END, actresses_json = excluded.actresses_json, keywords_json = excluded.keywords_json, updated_at = excluded.updated_at",
    ],
  },
  {
    method: "deleteMovie",
    fragments: ["DELETE FROM subtitles WHERE movie_id = ?", "DELETE FROM movies WHERE id = ?"],
    exact: ["DELETE FROM subtitles WHERE movie_id = ?", "DELETE FROM movies WHERE id = ?"],
  },
  {
    method: "updateMovieLocation",
    fragments: ["UPDATE movies SET source_path = ?, folder_path = ?, library_mode = ?, updated_at = ? WHERE id = ?"],
    exact: ["UPDATE movies SET source_path = ?, folder_path = ?, library_mode = ?, updated_at = ? WHERE id = ?"],
  },
  {
    method: "updateMoviePoster",
    fragments: ["UPDATE movies SET poster_url = ?, poster_source = ?, updated_at = ? WHERE id = ?"],
    exact: [
      "none",
      "local",
      "web",
      "UPDATE movies SET poster_url = ?, poster_source = ?, updated_at = ? WHERE id = ?"
    ],
  },
  {
    method: "updateMovieVideoId",
    fragments: ["UPDATE movies SET video_id = ?, updated_at = ? WHERE id = ?"],
    exact: ["UPDATE movies SET video_id = ?, updated_at = ? WHERE id = ?"],
  },
];

// ── unit slicing shared by drift class 4's write- and read-side checks ─────
// A "unit" is a class method (two-space indent) or a module-level function
// (column 0); both are sliced from their `name(` line to the next unit start
// at their own indent — everything deeper (SQL strings, nested arrows) is
// body — and a file's last unit runs to the first column-0 `}` (or EOF).
// Scanning BOTH families keeps the scalable tripwires blind-spot-free: a
// movies statement in a module-level helper fails exactly like one in an
// unregistered method. All statement scans run over comment-stripped source
// (a commented-out statement is not evidence).
const databaseCode = stripLineComments(databaseSource);
const methodBody = (source: string, method: string): string => {
  const start = source.indexOf(`\n  ${method}(`);
  if (start === -1) return "";
  const rest = source.slice(start + 1);
  const next = rest.search(/\n  (?:async )?[a-zA-Z_$][\w$]*\(/);
  if (next !== -1) return rest.slice(0, next);
  const classEnd = source.indexOf("\n}", start);
  return classEnd === -1 ? rest : rest.slice(0, classEnd - start - 1);
};
const moduleFunctionBody = (source: string, name: string): string => {
  const match = new RegExp(`\\n(?:export )?(?:async )?function ${name}\\(`).exec(source);
  if (!match) return "";
  const rest = source.slice(match.index + 1);
  const next = rest.search(/\n(?:export )?(?:async )?function [a-zA-Z_$][\w$]*\(/);
  if (next !== -1) return rest.slice(0, next);
  const end = source.indexOf("\n}", match.index);
  return end === -1 ? rest : rest.slice(0, end - match.index - 1);
};
const writeToken = /INSERT INTO movies|UPDATE movies|DELETE FROM movies/g;
const readToken = /(?:FROM|JOIN) movies/g;
const deleteToken = /DELETE FROM movies/g;
// Both quote styles: the single-purpose statements are double-quoted, but
// the clause-builders and the write methods assemble SQL from template
// literals — a double-quote-only extractor would silently miss them.
const literalsOf = (body: string): string[] =>
  [
    ...body.matchAll(/"((?:[^"\\]|\\.)*)"/g),
    ...body.matchAll(/`((?:[^`\\]|\\.)*)`/g),
  ].map((m) => m[1]);

// ── drift class 4 data: the movies read-path table (search.md) ─────────────
// The query side: every FROM/JOIN-movies statement in database.ts, with the
// SQL search.md's read-path table documents. deleteMovie's DELETE FROM
// movies is write-side; the read tripwire subtracts delete statements
// per-unit, so the delete needs no read-table row. `exact` pins the FULL
// set of string literals in the reader — substring fragments alone would
// let a widened query ("WHERE id = ? OR id = ?") still contain the
// documented SQL, so each reader's SQL-bearing literals are pinned exactly;
// a new or altered literal fails naming the reader.
const SEARCH_READ_PATHS: Array<{ method: string; fragments: string[]; exact: string[] }> = [
  {
    method: "listMovies",
    fragments: [
      "SELECT * FROM movies",
      // The one search clause, shared with countMovies; search.md's query
      // side quotes it verbatim.
      "(title LIKE ? OR video_id LIKE ? OR source_path LIKE ? OR actresses_json LIKE ? OR keywords_json LIKE ?)",
      // No relevance sort exists; the ordering is part of the contract.
      "ORDER BY updated_at DESC, title ASC"
    ],
    exact: [
      "",
      "library_mode = 'normal'",
      "(title LIKE ? OR video_id LIKE ? OR source_path LIKE ? OR actresses_json LIKE ? OR keywords_json LIKE ?)",
      "SELECT * FROM movies",
      " AND ",
      "",
      "ORDER BY updated_at DESC, title ASC",
      " ",
      "?",
      ",",
      "%${query}%",
      "WHERE ${clauses.join(\" AND \")}",
      "SELECT * FROM subtitles WHERE movie_id IN (${placeholders}) ORDER BY language ASC"
    ],
  },
  {
    method: "countMovies",
    fragments: [
      "SELECT * FROM movies",
      "(title LIKE ? OR video_id LIKE ? OR source_path LIKE ? OR actresses_json LIKE ? OR keywords_json LIKE ?)"
    ],
    exact: [
      "",
      "library_mode = 'normal'",
      "(title LIKE ? OR video_id LIKE ? OR source_path LIKE ? OR actresses_json LIKE ? OR keywords_json LIKE ?)",
      "SELECT * FROM movies",
      " AND ",
      "",
      " ",
      "%${query}%",
      "WHERE ${clauses.join(\" AND \")}"
    ],
  },
  {
    method: "getMovie",
    fragments: ["SELECT * FROM movies WHERE id = ?"],
    exact: ["SELECT * FROM movies WHERE id = ?"],
  },
  {
    method: "findMovieIdBySourcePath",
    fragments: ["SELECT id FROM movies WHERE source_path = ?"],
    exact: ["SELECT id FROM movies WHERE source_path = ?"],
  },
  {
    method: "getMovieByVideoId",
    fragments: ["SELECT id, title FROM movies WHERE LOWER(video_id) = LOWER(?)"],
    exact: ["SELECT id, title FROM movies WHERE LOWER(video_id) = LOWER(?)"],
  },
];

// ── drift class 6 data: the IPC surface table (architecture.md), parsed ────
function parseIpcSurfaceTable(markdown: string): Map<string, { channels: string[]; pushes: string[] }> {
  const table = new Map<string, { channels: string[]; pushes: string[] }>();
  const rows = [...markdown.matchAll(/^\| `([a-z]+):\*` \| [^|]+ \| (.+) \|$/gm)];
  if (rows.length === 0) throw new Error("no IPC surface table rows found in architecture.md");
  for (const [, prefix, channelCell] of rows) {
    const channels: string[] = [];
    const pushes: string[] = [];
    for (const raw of channelCell.split(",")) {
      // Annotations like (invoke), (push), (PIN) are prose, not contract:
    // classification keys only on "(push)". Channel names may contain
    // digits (player:convertToMp4).
    const m = /^\s*`([a-zA-Z0-9]+:[a-zA-Z0-9]+)`(?:\s*\([a-zA-Z]+\))?\s*$/.exec(raw);
      if (!m) throw new Error(`unrecognized channel entry in architecture.md: ${JSON.stringify(raw)}`);
      (raw.includes("(push)") ? pushes : channels).push(m[1]);
    }
    table.set(prefix, { channels, pushes });
  }
  return table;
}
const ipcSurface = parseIpcSurfaceTable(architectureMd);

// Minimal reader for .github/dependabot.yml's known shape (no yaml dep):
// one update entry whose keys are flat, plus nested schedule/groups blocks.
// Throws on anything it does not recognize rather than asserting nothing.
function yamlLike(source: string): {
  version?: string;
  updates?: Array<{
    "package-ecosystem"?: string;
    directory?: string;
    schedule?: { interval?: string };
    groups?: Record<string, { patterns?: string[] }>;
    "open-pull-requests-limit"?: number;
  }>;
} {
  const lines = source.split(/\r?\n/);
  const out: ReturnType<typeof yamlLike> = {};
  let current: NonNullable<ReturnType<typeof yamlLike>["updates"]>[number] | null = null;
  let block: "schedule" | "groups" | null = null;
  let group: { patterns?: string[] } | null = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const indent = line.length - line.trimStart().length;
    // List-item lines ("- key: value") are matched past their dash; a pure
    // scalar item ("- \"*\"") has no key at all.
    const inner = trimmed.startsWith("- ") ? trimmed.slice(2).trim() : trimmed;
    const kv = /^([\w-]+):\s*(.*)$/.exec(inner);
    if (kv === null) {
      if (trimmed.startsWith("-") && !inner.includes(":") && indent === 10 && block === "groups" && group?.patterns) {
        // The one block list in the config: patterns: items.
        group.patterns.push(inner.replace(/^["']|["']$/g, ""));
        continue;
      }
      throw new Error(`unrecognized line in dependabot.yml: ${JSON.stringify(raw)}`);
    }
    const [, key, value] = kv;
    if (indent === 0) {
      if (key === "version") out.version = value;
      else if (key === "updates") continue;
      else throw new Error(`unexpected top-level key in dependabot.yml: ${key}`);
      current = null;
      block = null;
      continue;
    }
    if (indent === 2 && trimmed.startsWith("- ")) {
      // Each updates[] entry opens with "- package-ecosystem: …".
      if (kv[1] !== "package-ecosystem") {
        throw new Error(`unrecognized update entry in dependabot.yml: ${JSON.stringify(raw)}`);
      }
      current = {};
      (out.updates ??= []).push(current);
      current["package-ecosystem"] = kv[2].replace(/^"|"$/g, "");
      block = null;
      continue;
    }
    if (!current) throw new Error(`orphaned key in dependabot.yml: ${JSON.stringify(raw)}`);
    if (indent === 4) {
      block = null;
      if (key === "directory") current.directory = value.replace(/^"|"$/g, "");
      else if (key === "schedule") block = "schedule";
      else if (key === "groups") block = "groups";
      else if (key === "open-pull-requests-limit") current["open-pull-requests-limit"] = Number(value);
      else throw new Error(`unexpected update key in dependabot.yml: ${key}`);
      continue;
    }
    if (indent === 6 && block === "schedule") {
      if (key !== "interval") throw new Error(`unexpected schedule key: ${key}`);
      current.schedule = { interval: value.replace(/^"|"$/g, "") };
      continue;
    }
    if (indent === 6 && block === "groups") {
      group = {};
      current.groups ??= {};
      current.groups[key] = group;
      continue;
    }
    if (indent === 8 && block === "groups") {
      if (key !== "patterns" || !group) throw new Error(`unexpected group key: ${key}`);
      const patterns = value
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map((p) => p.trim().replace(/^"|"$/g, ""))
        .filter(Boolean);
      group.patterns = patterns;
      continue;
    }
    throw new Error(`unrecognized indentation in dependabot.yml: ${JSON.stringify(raw)}`);
  }
  return out;
}

const boldTokens = [...ciSection.matchAll(/\*\*([^*]+)\*\*/g)].map((m) =>
  m[1].replace(/\s+/g, " ")
);
const citedCommands = [...ciSection.matchAll(/`((?:npm|npx|xvfb-run)[^`]*)`/g)].map((m) => m[1]);
const allRuns = Object.values(jobs).flatMap((job) => job.steps.map((s) => s.run ?? ""));

describe("layer 1 — the doc-drift lint (drift classes 2, 3, 4, 6, 8, 9, 10)", () => {
  // ── drift class 2 — package.json's hook bodies match their claims ─────────
  it("drift class 2: pretest is a pure gate; pretest:e2e self-heals; postinstall leaves the Electron ABI", () => {
    expect(scripts.pretest).toBe("npm run verify:abi");
    expect(scripts.pretest).not.toMatch(/rebuild/i);
    expect(scripts["pretest:e2e"]).toBe("npm run rebuild:electron && npm run verify:abi:electron");
    expect(scripts["pretest:e2e"].indexOf("rebuild:electron")).toBeLessThan(
      scripts["pretest:e2e"].indexOf("verify:abi:electron")
    );
    expect(scripts.postinstall).toBe("electron-builder install-app-deps");
  });

  it("drift class 2: every ABI gate script is wired, exists, and is driven by the drill", () => {
    const wired = {
      "rebuild:node": "node scripts/rebuild-node.cjs",
      "rebuild:electron": "node scripts/rebuild-electron.cjs",
      "verify:abi": "node scripts/abi-check.cjs",
      "verify:abi:electron": "node scripts/abi-check.cjs --electron",
      "diagnose:abi": "node scripts/diagnose-abi.cjs",
      "drill:abi": "node scripts/drill-abi-contract.cjs",
    };
    for (const [name, expected] of Object.entries(wired)) {
      expect(scripts[name], `npm script ${name}`).toBe(expected);
      const scriptPath = expected.split(" ").find((token) => token.startsWith("scripts/"));
      expect(scriptPath, `npm script ${name} points at a script file`).toBeDefined();
      const file = path.join(repoRoot, scriptPath!);
      expect(fs.existsSync(file), `${file} exists`).toBe(true);
    }
    const drill = fs.readFileSync(path.join(repoRoot, "scripts", "drill-abi-contract.cjs"), "utf8");
    for (const cmd of ["rebuild:node", "rebuild:electron", "verify:abi:electron", "pretest:e2e", "diagnose:abi"]) {
      expect(drill, `drill drives ${cmd}`).toContain(`"${cmd}"`);
    }
  });

  it("ci.yml parses into the documented jobs", () => {
    expect(Object.keys(jobs).sort()).toEqual(["e2e", "test", "typecheck"]);
    expect(jobs.test.name, "unit job display name").toBe("Unit & Component Tests");
    expect(jobs.e2e.name, "e2e job display name").toBe("Electron E2E");
    expect(jobs.test.runsOn, "unit job runner").toBe("ubuntu-latest");
    expect(jobs.e2e.runsOn, "e2e job runner").toBe("ubuntu-latest");
  });

  it("the unit job rebuilds for Node before the pure pretest gate runs", () => {
    const runSteps = jobs.test.steps.filter((s) => s.run);
    expect(runSteps.map((s) => [s.name, s.run])).toEqual([
      ["Install dependencies", "npm ci"],
      ["Rebuild better-sqlite3 for Node", "npm run rebuild:node"],
      ["Run tests", "npm test"],
    ]);
    const rebuildSteps = jobs.test.steps.filter((s) => /rebuild/.test(s.run ?? ""));
    expect(rebuildSteps, "exactly the one explicit Node rebuild").toHaveLength(1);
  });

  it("the e2e job installs Electron's system libraries, proves the postinstall state, then runs the suite", () => {
    const runSteps = jobs.e2e.steps.filter((s) => s.run);
    // The checkout/setup-node/cache `uses:` steps carry no contract; the
    // run-step sequence is what the docs promise.
    expect(runSteps.map((s) => [s.name, s.run])).toEqual([
      ["Install dependencies", "npm ci"],
      [
        "Install Electron system dependencies",
        expect.stringContaining("npx playwright install-deps chromium"),
      ],
      ["Verify the Electron runtime is installed", "test -x node_modules/electron/dist/electron"],
      ["Prove the postinstall ABI", "npm run verify:abi:electron"],
      [
        "Run the e2e suite",
        'xvfb-run --auto-servernum --server-args="-screen 0 1280x800x24" npm run test:e2e',
      ],
      // The notification script is checked in detail by its own assertion.
      ["Notify on failure", expect.stringContaining("CI_ALERT_WEBHOOK")],
    ]);
  });

  it("the e2e job heals only through pretest:e2e — never as a workflow step", () => {
    const healingSteps = jobs.e2e.steps.filter((s) =>
      /rebuild:(node|electron)|diagnose:abi/.test(s.run ?? "")
    );
    expect(healingSteps, "no workflow step mutates the binding").toEqual([]);
    expect(
      jobs.e2e.steps.some((s) => s.run?.includes("npm run test:e2e")),
      "the suite (whose pretest:e2e hook re-heals to the identical state) runs"
    ).toBe(true);
  });

  it("docs/testing.md bolds the workflow's real step names (ci → doc)", () => {
    for (const job of [jobs.test, jobs.e2e]) {
      for (const step of job.steps) {
        // The bolded-names promise covers the steps that run something —
        // the contract-relevant ones — not checkout/setup-node plumbing.
        if (!step.name || !step.run) continue;
        expect(
          boldTokens,
          `step name bolded in testing.md's CI section: ${step.name}`
        ).toContain(step.name);
      }
    }
  });

  it("docs/testing.md cites only commands ci.yml actually runs (doc → ci)", () => {
    expect(citedCommands.length, "the CI section does cite commands").toBeGreaterThan(0);
    for (const command of citedCommands) {
      expect(
        allRuns.some((run) => run.includes(command)),
        `command cited by the docs must run in ci.yml: ${command}`
      ).toBe(true);
    }
  });

  // Loads the real @playwright/test via the config; give the cold-start
  // require a generous budget instead of racing vitest's 5s default.
  // Observed at 45s under heavy machine load, hence 60s.
  it("playwright.config.ts keeps the flake budget CI-only and capture failure-only, as promised", { timeout: 60_000 }, () => {
    const inCi = resolvePlaywrightConfig({ CI: "1" });
    const locally = resolvePlaywrightConfig({});

    // Retries: two in CI, zero locally — the same suite, two strictnesses.
    expect(inCi.retries, "CI retries").toBe(2);
    expect(locally.retries, "local retries stay strict").toBe(0);

    // Failure evidence is captured only in CI, and only on failure.
    expect(inCi.use.trace, "CI trace").toBe("retain-on-failure");
    expect(inCi.use.screenshot, "CI screenshot").toBe("only-on-failure");
    expect(locally.use.trace, "local trace stays off").toBe("off");
    expect(locally.use.screenshot, "local screenshot stays off").toBe("off");

    // Video is retained on failure in both environments (pre-existing).
    expect(inCi.use.video, "CI video").toBe("retain-on-failure");
    expect(locally.use.video, "local video").toBe("retain-on-failure");
  });

  it("the e2e job runs nightly (plus manual dispatch), not on every push", () => {
    // Triggers are workflow-level, so the e2e job is partitioned by event:
    // unit/typecheck ride push+PR, e2e rides schedule+dispatch.
    expect(triggers.push).toBeDefined();
    expect(triggers.pull_request).toBeDefined();
    expect(triggers.workflow_dispatch).toBeDefined();

    const schedules = Array.isArray(triggers.schedule) ? (triggers.schedule as unknown[]) : [];
    expect(schedules.length, "exactly one nightly schedule").toBe(1);
    const cron = (schedules[0] as { cron?: string })?.cron;
    expect(cron, "cron shape").toMatch(/^"?\d{1,2} \d{1,2} \* \* \*"?$/);
    expect(cron, "nightly cadence must differ from push cadence").toBeDefined();
    expect(String(cron).replace(/"/g, "").split(" ").slice(0, 2).join(" "))
      .not.toBe("* *");
  });

  it("a failed run pages via the CI_ALERT_WEBHOOK secret — loudly when unconfigured", () => {
    const notify = jobs.e2e.steps.find((s) => s.name === "Notify on failure");
    expect(notify, "the notification step exists in the e2e job").toBeDefined();
    expect(notify!.if, "it only fires on failure").toBe("failure()");

    // The webhook URL comes from a secret via env, never interpolated into
    // the run script; the github context rides the same way.
    expect(notify!.env, "env block captured").toBeDefined();
    expect(notify!.env!.WEBHOOK_URL, "webhook URL from a secret").toBe(
      "${{ secrets.CI_ALERT_WEBHOOK }}"
    );
    for (const name of ["GH_REPO_NAME", "GH_EVENT_NAME", "GH_COMMIT_SHA", "GH_SERVER_URL", "GH_RUN_ID"]) {
      expect(notify!.env![name], `${name} wired through env`).toMatch(/^\$\{\{ github\./);
    }
    expect(notify!.run, "the URL never appears in the script").not.toContain("secrets.");

    // Unset secret => quiet skip, not a red job; delivery failures still fail.
    expect(notify!.run).toContain('[ -z "$WEBHOOK_URL" ]');
    expect(notify!.run).toContain('exit 0');
    expect(notify!.run).toContain("could not be delivered");
  });

  it("ABI-sensitive PRs can call the shared e2e job via the run-e2e label", () => {
    // Callee side: ci.yml exposes the job through workflow_call and checks
    // out the caller-supplied ref when one is passed.
    expect(triggers.workflow_call, "ci.yml is callable").toBeDefined();
    expect(ciSource).toContain("${{ inputs.e2e-ref || github.ref }}");

    // Caller side: pr-e2e.yml gates that callable behind a label, on the
    // merge ref, without granting more permissions than needed.
    const prSource = fs.readFileSync(path.join(repoRoot, ".github", "workflows", "pr-e2e.yml"), "utf8");
    const prTriggers = parseWorkflowTopLevel(prSource).on as {
      pull_request_target?: { types?: unknown };
    };
    expect(prTriggers.pull_request_target, "caller fires on pull_request_target").toBeDefined();
    expect(prTriggers.pull_request_target?.types, "only the labeled event").toEqual(["labeled"]);
    expect(prSource, "label gate: run-e2e").toContain("github.event.label.name == 'run-e2e'");
    expect(prSource, "least privileges on an untrusted-context trigger").toContain("contents: read");
    expect(prSource, "calls the shared job definition").toContain("uses: ./.github/workflows/ci.yml");
    expect(prSource, "merge ref passed through").toContain(
      "refs/pull/${{ github.event.pull_request.number }}/merge"
    );
    expect(prSource, "secrets flow to the reusable job").toContain("secrets: inherit");
  });

  it("every workflow action is SHA-pinned (the SLSA generator's tag is the documented exception)", () => {
    const workflowsDir = path.join(repoRoot, ".github", "workflows");
    const files = fs.readdirSync(workflowsDir).filter((f) => f.endsWith(".yml"));
    expect(files.length, "the repo's workflows are all scanned").toBeGreaterThanOrEqual(3);

    const shaRe = /^[0-9a-f]{40}$/;
    // CONTRIBUTING's Releases section documents this one exception: the
    // SLSA generator rejects non-tag refs, so its version tag is sanctioned.
    // The exact tag may move (Dependabot bumps it), so the exception is the
    // sanctioned path at any version — anchored, not a blanket prefix pass.
    const slsaException =
      /^slsa-framework\/slsa-github-generator\/.github\/workflows\/generator_generic_slsa3\.yml@v\d+\.\d+\.\d+$/;

    for (const file of files) {
      const source = fs.readFileSync(path.join(workflowsDir, file), "utf8");
      const uses = [...source.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map((m) => m[1]);
      expect(uses.length, `${file} declares actions`).toBeGreaterThan(0);
      for (const ref of uses) {
        if (ref.startsWith("./")) continue; // local reusable workflow
        if (slsaException.test(ref)) continue;
        const pin = ref.slice(ref.lastIndexOf("@") + 1);
        expect(
          shaRe.test(pin),
          `${file}: ${ref} must be pinned to a full commit SHA`
        ).toBe(true);
      }
    }
  });

  it("dependabot keeps the SHA pins current via one grouped weekly PR stream", () => {
    const configPath = path.join(repoRoot, ".github", "dependabot.yml");
    expect(fs.existsSync(configPath), "the Dependabot config exists").toBe(true);
    const config = yamlLike(fs.readFileSync(configPath, "utf8"));

    const updates = config.updates ?? [];
    expect(updates, "exactly the github-actions stream").toHaveLength(1);
    expect(updates[0]["package-ecosystem"], "ecosystem").toBe("github-actions");
    expect(updates[0].directory, "repo root").toBe("/");
    expect(updates[0].schedule?.interval, "weekly cadence").toBe("weekly");
    expect(
      updates[0].groups?.["github-actions"]?.patterns,
      "all actions in one grouped PR"
    ).toEqual(["*"]);
    expect(updates[0]["open-pull-requests-limit"], "bounded PR backlog").toBe(5);
  });

  // ── drift class 4 — search.md's write-path table ↔ database.ts ────────────
  it("drift class 4: the search write-path table matches database.ts, doc → code", () => {
    const db = norm(databaseCode);
    for (const row of SEARCH_WRITE_PATHS) {
      expect(databaseCode, `method ${row.method} exists in database.ts`).toContain(
        `  ${row.method}(`
      );
      expect(searchMd, `search.md documents ${row.method}`).toContain(row.method);
      for (const fragment of row.fragments) {
        expect(db, `${row.method}: SQL fragment present in database.ts`).toContain(norm(fragment));
      }
    }
  });

  it("drift class 4: every movies write site in database.ts is documented, code → doc", () => {
    // Units are sliced by the module-scoped helpers above SEARCH_READ_PATHS
    // (shared with the read-side check below), over comment-stripped source.

    // 1. Each registered row must be satisfied by the code: its SQL
    // fragments must appear in the registered unit's body — the method, or
    // (if a refactor moves the SQL out of the class) a module-level function
    // of the same name — and the unit must contain exactly the documented
    // movies statements; a new statement inside an existing unit fails
    // here, naming it.
    for (const row of SEARCH_WRITE_PATHS) {
      const methodSlice = methodBody(databaseCode, row.method);
      const moduleSlice = moduleFunctionBody(databaseCode, row.method);
      // Count from exactly one slice (method body if it exists, else the
      // module-level body) so a same-named method/function pair can never
      // double-count the unit's statements.
      const ownedSlice = methodSlice || moduleSlice;
      expect(
        ownedSlice,
        `${row.method}: no method or module-level function with that name exists in database.ts`
      ).not.toBe("");
      const methodNorm = norm(methodSlice);
      const moduleNorm = norm(moduleSlice);
      for (const fragment of row.fragments.map(norm)) {
        expect(
          methodNorm.includes(fragment) || moduleNorm.includes(fragment),
          `${row.method}: search.md's documented SQL is not in its body — the row has drifted from the code`
        ).toBe(true);
      }
      const found = [...ownedSlice.matchAll(writeToken)];
      // deleteMovie documents a subtitles DELETE too; the count basis is the
      // fragments that are themselves movies statements.
      const moviesFragments = row.fragments.filter((f) =>
        /INSERT INTO movies|UPDATE movies|DELETE FROM movies/.test(f)
      ).length;
      expect(
        found.length,
        `${row.method}() contains ${found.length} movies write statements but docs/search.md documents ${moviesFragments} — update the write-path table (drift class 4)`
      ).toBe(moviesFragments);
      // 1b. literal-set pinning: the FULL inventory of the unit's string
      // literals (whitespace-normalized, both quote styles) must equal the
      // documented set — a widened or extra statement literal fails here.
      const actual = [...literalsOf(ownedSlice)].map(norm).sort();
      const expected = [...row.exact].map(norm).sort();
      expect(
        actual,
        `${row.method}()'s SQL string literals have drifted from docs/search.md's write-path table — update the table and the statement together (drift class 4)`
      ).toEqual(expected);
    }

    // 2. The scalable tripwire, over every unit in the file: every
    // two-space method AND every module-level function that is not the
    // registered owner of its row must write the movies table zero times —
    // a new write site fails naming its unit and pointing at the doc.
    const registeredMethods = new Set(SEARCH_WRITE_PATHS.map((r) => r.method));
    const allMethods = [
      ...databaseSource.matchAll(/\n  (?:async )?([a-zA-Z_$][\w$]*)\(/g),
    ].map((m) => m[1]);
    expect(allMethods.length, "database.ts methods are discoverable").toBeGreaterThan(20);
    const allModuleFunctions = [
      ...databaseSource.matchAll(/\n(?:export )?(?:async )?function ([a-zA-Z_$][\w$]*)\(/g),
    ].map((m) => m[1]);
    for (const method of allMethods) {
      if (registeredMethods.has(method)) continue;
      const hits = [...methodBody(databaseCode, method).matchAll(writeToken)];
      expect(
        hits,
        `${method}() writes the movies table but is missing from docs/search.md's write-path table (drift class 4) — document it or route the SQL through a registered method`
      ).toHaveLength(0);
    }
    for (const fn of allModuleFunctions) {
      // A module-level function sharing a registered row's name is already
      // covered by check 1 (which slices both families for the row).
      if (registeredMethods.has(fn)) continue;
      const hits = [...moduleFunctionBody(databaseCode, fn).matchAll(writeToken)];
      expect(
        hits,
        `module-level ${fn}() writes the movies table but is missing from docs/search.md's write-path table (drift class 4) — document it or route the SQL through a registered method`
      ).toHaveLength(0);
    }

    // 3. Conservation: every movies write token in the file must fall
    // inside one of the sliced units. If this ever fails, a write has
    // appeared in a shape the unit scanner cannot see (a function nested
    // deeper than the unit boundary, string-built SQL, …) and either the
    // scanner or the code must change deliberately — the blind spot is
    // named, never silent.
    const ownedCount = SEARCH_WRITE_PATHS.reduce(
      (sum, row) =>
        sum +
        [...(methodBody(databaseCode, row.method) || moduleFunctionBody(databaseCode, row.method)).matchAll(writeToken)].length,
      0
    );
    const unownedCount =
      allMethods
        .filter((method) => !registeredMethods.has(method))
        .reduce((sum, method) => sum + [...methodBody(databaseCode, method).matchAll(writeToken)].length, 0) +
      allModuleFunctions
        .filter((fn) => !registeredMethods.has(fn))
        .reduce((sum, fn) => sum + [...moduleFunctionBody(databaseCode, fn).matchAll(writeToken)].length, 0);
    const totalCount = [...databaseCode.matchAll(writeToken)].length;
    expect(
      totalCount,
      `${totalCount - ownedCount - unownedCount} movies write statement(s) in database.ts fall outside every method and module-level function the class-4 scanner slices — a blind spot, not a doc gap; extend the unit scanner or route the SQL through a named unit (drift class 4)`
    ).toBe(ownedCount + unownedCount);
  });

  it("drift class 4: the query-side read paths are fully accounted for, code → doc", () => {
    // Symmetric with the write-side tripwire above: search.md's read-path
    // table must cover every FROM/JOIN-movies statement — class method or
    // module-level helper — and every read must fall inside a sliced unit.
    const registeredReads = new Set(SEARCH_READ_PATHS.map((r) => r.method));
    const unitBody = (name: string): string =>
      methodBody(databaseCode, name) || moduleFunctionBody(databaseCode, name);
    // Reads are FROM/JOIN-movies statements; a unit's DELETE FROM movies
    // belongs to the write table and is subtracted (deleteMovie needs no
    // read-table row).
    const reads = (name: string): number => {
      const body = unitBody(name);
      return [...body.matchAll(readToken)].length - [...body.matchAll(deleteToken)].length;
    };

    // 1. doc → code: every unit the read table names exists and carries the
    // documented SQL (normalized), and search.md names it.
    for (const row of SEARCH_READ_PATHS) {
      const body = norm(unitBody(row.method));
      expect(body, `read method ${row.method} exists in database.ts`).not.toBe("");
      for (const fragment of row.fragments.map(norm)) {
        expect(
          body,
          `${row.method}: search.md's documented read SQL is not in its body — the read-path table has drifted from the code`
        ).toContain(fragment);
      }
      expect(searchMd, `search.md documents ${row.method}`).toContain(row.method);
    }

    // 1b. literal-set pinning: the FULL set of string literals in each
    // registered reader must equal the documented set. A widened query
    // ("WHERE id = ? OR id = ?") still *contains* the documented SQL, so
    // only exact-set equality catches it.
    for (const row of SEARCH_READ_PATHS) {
      // Whitespace-normalized comparison: the entries are written as the
      // same one-liners as `fragments`, while template-literal SQL in the
      // code is multi-line.
      const actual = [...literalsOf(unitBody(row.method))].map(norm).sort();
      const expected = [...row.exact].map(norm).sort();
      expect(
        actual,
        `${row.method}()'s SQL string literals have drifted from docs/search.md's read-path table — update the table and the reader together (drift class 4)`
      ).toEqual(expected);
    }

    // 2. the scalable tripwire, over every unit in the file: any unit that
    // is not a registered reader must read the movies table zero times —
    // a new read site fails naming its unit and pointing at the doc.
    const allUnits = [
      ...databaseCode.matchAll(/\n  (?:async )?([a-zA-Z_$][\w$]*)\(/g),
      ...databaseCode.matchAll(/\n(?:export )?(?:async )?function ([a-zA-Z_$][\w$]*)\(/g),
    ].map((m) => m[1]);
    expect(allUnits.length, "database.ts units are discoverable").toBeGreaterThan(20);
    for (const unit of allUnits) {
      if (registeredReads.has(unit)) continue;
      expect(
        reads(unit),
        `${unit}() reads the movies table but is missing from docs/search.md's read-path table (drift class 4) — document it or route the read through a registered method`
      ).toBe(0);
    }

    // 3. per-row count: each registered reader contains exactly its
    // documented number of FROM/JOIN-movies statements.
    for (const row of SEARCH_READ_PATHS) {
      const expected = row.fragments.filter((f) => /(?:FROM|JOIN) movies/.test(f)).length;
      expect(
        reads(row.method),
        `${row.method}() contains ${reads(row.method)} movies read statements but docs/search.md documents ${expected} — update the read-path table (drift class 4)`
      ).toBe(expected);
    }

    // 4. conservation: every FROM/JOIN-movies token in the file falls inside
    // some sliced unit — an unsliced read shape (a nested function, an arrow
    // assigned at module level) fails naming the blind spot.
    const unitTotal = allUnits.reduce(
      (sum, unit) => sum + [...unitBody(unit).matchAll(readToken)].length,
      0
    );
    const total = [...databaseCode.matchAll(readToken)].length;
    expect(
      total,
      `${total - unitTotal} movies read statement(s) in database.ts fall outside every method and module-level function the class-4 scanner slices — a blind spot, not a doc gap; extend the unit scanner or route the read through a named unit (drift class 4)`
    ).toBe(unitTotal);
  });

  // ── drift class 6 — architecture.md's IPC surface table ↔ the code ────────
  it("drift class 6: the IPC surface table matches the code, both directions (prefixes)", () => {
    // Scans in this block and the two below run over comment-stripped
    // source — see the class-6 data block above for why.
    const invokeChannels = [...preloadCode.matchAll(/invoke\(\s*"([^"]+)"/g)].map((m) => m[1]);
    const usedPrefixes = new Set(invokeChannels.map((c) => c.split(":")[0]));
    const documentedPrefixes = new Set(ipcSurface.keys());

    for (const prefix of usedPrefixes) {
      expect(documentedPrefixes.has(prefix), `prefix used but not documented: ${prefix}:*`).toBe(true);
    }
    for (const prefix of documentedPrefixes) {
      expect(usedPrefixes.has(prefix), `prefix documented but not used: ${prefix}:*`).toBe(true);
    }
  });

  it("drift class 6: every named channel is real: documented = exposed = handled (invokes)", () => {
    const documented = [...ipcSurface.values()].flatMap((p) => p.channels);
    const exposed = [...preloadCode.matchAll(/invoke\(\s*"([^"]+)"/g)].map((m) => m[1]);
    const handled = [...mainCode.matchAll(/ipcMain\.handle\(\s*"([^"]+)"/g)].map((m) => m[1]);

    expect(documented.length, "documented invoke channels").toBe(exposed.length);
    expect(handled.length, "ipcMain.handle registrations").toBe(exposed.length);
    for (const channel of exposed) {
      expect(documented, `preload exposes an undocumented channel: ${channel}`).toContain(channel);
      expect(handled, `channel exposed but never handled in main.ts: ${channel}`).toContain(channel);
    }
    for (const channel of handled) {
      expect(exposed, `main.ts handles a channel preload never exposes: ${channel}`).toContain(channel);
    }
  });

  it("drift class 6: every push channel is sent by main and subscribed in preload, both directions", () => {
    const documentedPushes = [...ipcSurface.values()].flatMap((p) => p.pushes);
    const subscribed = [...preloadCode.matchAll(/[^a-zA-Z]on\(\s*"([^"]+)"/g)].map((m) => m[1]);
    const sent = [...mainCode.matchAll(/\.send\(\s*"([^"]+)"/g)].map((m) => m[1]);

    expect(documentedPushes.length, "documented push channels").toBe(subscribed.length);
    for (const channel of subscribed) {
      expect(documentedPushes, `preload subscribes to an undocumented push channel: ${channel}`).toContain(channel);
      expect(sent, `push channel never sent from main.ts: ${channel}`).toContain(channel);
    }
    for (const channel of sent) {
      expect(subscribed, `main.ts sends a channel nothing subscribes to: ${channel}`).toContain(channel);
    }
  });

  it("drift class 6: conservation — every channel opening carries a literal channel name", () => {
    // The scalable counterpart of class 4's conservation leg: these checks
    // fail the moment a channel call stops carrying a literal "prefix:name"
    // (wrapper/dynamic refactors), naming the file and call family — no
    // silent shrinkage of the lint's visibility.
    const families: Array<[string, string, RegExp, RegExp]> = [
      ["main.ts ipcMain.handle", mainCode, IPC_HANDLE_OPEN_RE, IPC_HANDLE_LIT_RE],
      ["preload.ts invoke", preloadCode, INVOKE_OPEN_RE, INVOKE_LIT_RE],
      ["main.ts webContents send", mainCode, SEND_OPEN_RE, SEND_LIT_RE],
      ["preload.ts subscription on", preloadCode, ON_OPEN_RE, ON_LIT_RE]
    ];
    for (const [label, source, openRe, litRe] of families) {
      const openings = [...source.matchAll(openRe)].length;
      const literals = [...source.matchAll(litRe)].length;
      expect(openings, `${label}: channel openings are discoverable`).toBeGreaterThan(0);
      expect(
        literals,
        `${label}: ${openings} channel opening(s) but only ${literals} carry a literal "prefix:name" — a dynamic/wrapper channel call would drop the IPC surface out of the lint's view (drift class 6)`
      ).toBe(openings);
    }
  });

  // ── drift class 8 — GUARDS-LOG.md stays parseable ─────────────────────────
  it("drift class 8: the latest GUARDS-LOG entry matches the drill's leg catalog", () => {
    const logPath = path.join(repoRoot, "GUARDS-LOG.md");
    expect(fs.existsSync(logPath), "GUARDS-LOG.md exists").toBe(true);
    const log = fs.readFileSync(logPath, "utf8");

    const entryHeaders = [...log.matchAll(/^## .+$/gm)].map((m) => m[0]);
    expect(entryHeaders.length, "at least one logged run").toBeGreaterThan(0);

    const latestIndex = log.lastIndexOf("## ");
    const entry = log.slice(latestIndex);
    expect(entry).toMatch(/^## \d{4}-\d{2}-\d{2}T.+ — contract (holds|BROKEN) \(\d+\/10 legs\)$/m);
    expect(entry).toMatch(/^- node .+ · better-sqlite3 .+ · electron .+ · commit .+ · \w+ · \d+s$/m);

    const rows = [...entry.matchAll(/^\| \d+ \| (.+?) \| (✅|❌) \| (contract|restore) \| .+? \|$/gm)].map((m) => m[1].trim());
    expect(rows, "latest entry covers the full leg catalog").toEqual(LEG_LABELS);

    // Tamper-evident chain over SEGMENTS: a segment ends at the last line
    // before the next `- chain:` line — either a drill entry (one `## `
    // header with metadata, leg table, trailing blanks) or a batch of CI
    // summary lines absorbed before the next entry. Every segment's chain
    // line digests ALL bytes before it (LF-normalized); the drill writer and
    // scripts/append-drill-log.cjs chain their own appends, so the log ends
    // with a chain line at every commit, and scripts/refill-log-chain.cjs
    // re-seeds after a legitimate rewrite. Editing, dropping, or reordering
    // any historical byte breaks every chain line after the edit.
    // (Tamper-EVIDENT, not signed: a deliberate rewrite that recomputes the
    // whole chain passes — visibly, as a re-committed log.)
    const crypto = require("node:crypto");
    const chainLineRe = /^- chain: ([0-9a-f]{64}) · entries (\d+)$/;
    const normalizedLog = log.replace(/\r\n/g, "\n");
    const logLines = normalizedLog.split("\n");
    let seenEntries = 0;
    let segment = 0;
    for (let i = 0; i < logLines.length; i++) {
      if (/^## /.test(logLines[i])) seenEntries++;
      const m = chainLineRe.exec(logLines[i]);
      if (!m) continue;
      segment++;
      const digest = crypto
        .createHash("sha256")
        .update(logLines.slice(0, i).join("\n") + "\n", "utf8")
        .digest("hex");
      expect(
        m[1],
        `chain line ${segment} digests every byte before it — history before this point was edited, dropped, or reordered since it was written (legitimate rewrite: node scripts/refill-log-chain.cjs, then commit the re-seeded log)`
      ).toBe(digest);
      expect(
        Number(m[2]),
        `chain line ${segment} claims ${m[2]} entries, but ${seenEntries} entries precede it`
      ).toBe(seenEntries);
    }
    expect(
      segment,
      "the log carries no chain lines at all (seed or re-seed with scripts/refill-log-chain.cjs)"
    ).toBeGreaterThan(0);
    // The file must END with a chain line: both appenders chain their own
    // writes, so an unchained tail after the last chain line is itself a
    // tamper signal, not outside-the-chain silence.
    const lastChain = logLines.map((l) => chainLineRe.test(l)).lastIndexOf(true);
    expect(lastChain, "the log carries at least one chain line").toBeGreaterThan(-1);
    expect(
      logLines
        .slice(lastChain + 1)
        .join("\n")
        .trim(),
      "the log ends with unchained content after its last chain line — appends must be chained by the drill itself or scripts/append-drill-log.cjs (CI); unchained bytes are tamper evidence"
    ).toBe("");

    // Closed line vocabulary: the log may contain only the line kinds the
    // drill and the CI append produce. A foreign line — appended tail text,
    // injected commentary, anything — fails here, even where the byte chain
    // above is silent (bytes after the final chain line are outside it).
    const vocabulary: Array<[RegExp, string]> = [
      [/^# /, "title"],
      [/^## \d{4}-/, "entry header"],
      [/^- node .+ · better-sqlite3 .+ · electron .+ · commit .+ · \w+ · \d+s$/, "entry metadata"],
      [/^\|/, "leg table"],
      [/^- \d{4}-\d{2}-\d{2}T.+ · ci · /, "CI summary line"],
      [chainLineRe, "chain line"],
    ];
    const foreign: string[] = [];
    let inHeader = true;
    for (const line of logLines) {
      if (/^## /.test(line)) inHeader = false;
      if (line.trim() === "") continue;
      // Free prose is allowed only in the header region (before the first
      // entry) — those bytes are inside entry 1's chain digest, so they are
      // still tamper-evident. Everything after the first entry is closed
      // vocabulary: drill and CI output only.
      if (inHeader) continue;
      if (!vocabulary.some(([re]) => re.test(line))) foreign.push(line);
    }
    expect(
      foreign,
      `GUARDS-LOG.md contains line(s) no drill or CI append produces: ${foreign.map((l) => JSON.stringify(l.slice(0, 80))).join(" | ") || "none"} — the log is append-only drill output (drift class 8)`
    ).toEqual([]);
  });

  it("drift class 8: the chain digest algorithm is pinned identically in the drill writer, the CI appender, the refill, and this lint", () => {
    // The chain's guarantees hold only while all four implementations hash
    // the same bytes with the same algorithm. Each is pinned by STRUCTURAL
    // markers with exact occurrence counts over comment-stripped source —
    // comments are not evidence. The markers are fragment-composed below so
    // this pin's own source never spells a complete atom: the lint's
    // self-counts stay 1 (its real hashing site), never 2.
    const read = (p: string) => stripLineComments(fs.readFileSync(path.join(repoRoot, p), "utf8"));
    const count = (src: string, needle: string) => src.split(needle).length - 1;
    const M = (a: string, b: string) => a + b;

    const sha256Call = M("createHash(", '"sha256")');
    const digestHex = M('digest("he', 'x")');
    const normalizeAtom = M("replace(/\\r\\n/g, ", '"\\n")');
    const drillBoundary = M("withEntry = normalized + ", "entry");
    const drillUpdate = M("update(with", "Entry");
    const ciBoundary = M("normalized + lines.", 'join("\\n") + "\\n"');
    const ciUpdate = M("update(with", "Lines");
    const lintReplay = M("update(logLines.slice(0, i).", 'join("\\n") + "\\n"');
    const refillVerify = M("update(lines.slice(0, i).", 'join("\\n") + "\\n"');
    const refillBuilder = M("update(out.", 'join("\\n") + "\\n"');
    const refillHelper = M("digest", "Of");

    const drill = read(path.join("scripts", "drill-abi-contract.cjs"));
    const appender = read(path.join("scripts", "append-drill-log.cjs"));
    const refill = read(path.join("scripts", "refill-log-chain.cjs"));

    // The drill writer: exactly one hashing site, boundary = file + entry,
    // LF-normalized — the boundary bug an end-to-end run once caught.
    expect(count(drill, sha256Call), "drill writer: exactly one sha256 site").toBe(1);
    expect(count(drill, drillBoundary), "drill writer: digest boundary is file + entry").toBe(1);
    expect(count(drill, drillUpdate), "drill writer: hashes the file+entry buffer").toBe(1);
    expect(count(drill, normalizeAtom), "drill writer: LF-normalizes before hashing").toBe(1);
    expect(count(drill, digestHex), "drill writer: hex digest").toBe(1);

    // The CI appender: one hashing site, boundary = file + CI lines.
    expect(count(appender, sha256Call), "CI appender: exactly one sha256 site").toBe(1);
    expect(count(appender, ciBoundary), "CI appender: digest boundary is file + summary lines").toBe(1);
    expect(count(appender, ciUpdate), "CI appender: hashes the file+lines buffer").toBe(1);
    expect(count(appender, normalizeAtom), "CI appender: LF-normalizes before hashing").toBe(1);
    expect(count(appender, digestHex), "CI appender: hex digest").toBe(1);

    // The refill: two sites (its verifier replay + its segment builder),
    // plus the shared digestOf helper both route through.
    expect(count(refill, sha256Call), "refill: verifier + builder sha256 sites").toBe(2);
    expect(count(refill, refillVerify), "refill: verifier replays the line-prefix boundary").toBe(1);
    expect(count(refill, refillBuilder), "refill: builder hashes the rebuilt prefix").toBe(1);
    expect(count(refill, refillHelper), "refill: digestOf helper appears in builder + call").toBe(2);
    expect(count(refill, normalizeAtom), "refill: LF-normalizes before hashing").toBe(1);
    expect(count(refill, digestHex), "refill: hex digests").toBe(2);

    // This lint's own replay: exactly one hashing site with the line-prefix
    // boundary — the reference implementation the writers must match.
    expect(count(lintCode, sha256Call), "lint: exactly one sha256 site").toBe(1);
    expect(count(lintCode, lintReplay), "lint: replay boundary is the line prefix + LF").toBe(1);
    expect(count(lintCode, normalizeAtom), "lint: LF-normalizes the log before replay").toBe(1);
  });

  it("drift class 8: every CI summary line in GUARDS-LOG.md is well-formed", () => {
    const log = fs.readFileSync(path.join(repoRoot, "GUARDS-LOG.md"), "utf8");
    const ciLines = log.split("\n").filter((line) => line.startsWith("- ") && line.includes("· ci ·"));
    for (const line of ciLines) {
      expect(
        line,
        `CI line format: ${line.slice(0, 80)}`
      ).toMatch(/^- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z · ci · [a-z-]+ · contract holds \(10\/10 legs\) · run \S+ · drill@[0-9a-f]+$/);
    }
  });

  // ── drift class 9 — testing.md's rules 4/5/6 ↔ script structure ───────────
  it("drift class 9, rule 4: the electron gate spawns ELECTRON_RUN_AS_NODE and its fallback is strict", () => {
    // The live proof: the gate spawns the real binary as Node, through the
    // --run-proof child entrypoint, and only accepts the FTS5 verdict.
    expect(abiStateSource, "spawn uses ELECTRON_RUN_AS_NODE=1").toContain(
      'ELECTRON_RUN_AS_NODE: "1"'
    );
    expect(abiStateSource, "child entrypoint is abi-check.cjs --run-proof").toContain(
      '"abi-check.cjs"'
    );
    expect(abiStateSource, "child runs --run-proof").toContain('"--run-proof"');
    expect(abiStateSource, "green requires the FTS5 OK verdict").toContain("FTS5 OK");

    // The degraded branch exists, is gated on the runtime check, and its
    // fallback is deliberately strict — with the doc's quoted message.
    expect(abiCheckSource, "fallback gated on electronRuntimePresent").toContain(
      "!electronRuntimePresent()"
    );
    expect(abiCheckSource, "fallback verdicts are reported as parse-only").toContain(
      "parse-only fallback"
    );
    expect(abiCheckSource, "a Node-loadable binding fails the fallback").toContain(
      "binding is Node-ABI, not Electron-ABI"
    );
    // ...and the live branch aborts on any proof failure.
    expect(abiCheckSource, "the gate consumes runFts5ProofUnderElectron").toContain(
      "runFts5ProofUnderElectron()"
    );
    const liveBranch = abiCheckSource.slice(abiCheckSource.indexOf("runFts5ProofUnderElectron()"));
    expect(liveBranch, "proof failure still exits 1").toContain("process.exit(1)");
  });

  it("drift class 9, rule 5: the drill probes in-process exactly once, before the finally", () => {
    // Rule 5 is a Windows file-lock invariant: a successful load maps the
    // binding, and the finally's rebuild would then fail. So the drill may
    // call load-succeeding probes only in child processes after a rebuild.
    const probes = [...drillSource.matchAll(/probeBinding\(/g)].length;
    expect(probes, "probeBinding appears exactly once (leg 3's load-FAILURE probe)").toBe(1);

    const finallyAt = drillSource.indexOf("} finally {");
    const probeAt = drillSource.indexOf("probeBinding(");
    expect(probeAt, "the one probe runs before the finally block").toBeGreaterThan(-1);
    expect(probeAt, "the one probe runs before the finally block").toBeLessThan(finallyAt);

    // Post-rebuild verdicts come from child processes: leg 6 by the healing
    // hook's exit code, leg 8 by diagnose --fix's own gate-gated output.
    expect(drillSource, "leg 6 is judged by the child's exit code").toContain(
      "const healedForElectron = r6.status === 0"
    );
    expect(drillSource, "leg 8 is judged by the child's FIX OK + exit code").toContain(
      "r8.status === 0 && /FIX OK/.test(r8.output)"
    );
    // ...and the finally still restores (rebuilds) the machine.
    const finallyBlock = drillSource.slice(finallyAt);
    expect(finallyBlock, "the finally block rebuilds for Node").toContain("rebuild:node");
  });

  it("drift class 9, rule 6: diagnose --fix heals via rebuild, gates its exit, and leaves a unit-ready binding untouched", () => {
    // Order is the contract: heal with rebuild:node, prove with the Node
    // gate, and only then print FIX OK.
    const rebuildAt = diagnoseSource.indexOf('runNpm(["run", "rebuild:node"])');
    const gateAt = diagnoseSource.indexOf('runNpm(["run", "verify:abi"])');
    // The output line, not the header comment that mentions FIX OK.
    const fixOkAt = diagnoseSource.indexOf("FIX OK — binding rewritten");
    expect(rebuildAt, "--fix runs rebuild:node").toBeGreaterThan(-1);
    expect(gateAt, "--fix runs the Node gate").toBeGreaterThan(-1);
    expect(fixOkAt, "--fix reports FIX OK").toBeGreaterThan(-1);
    expect(rebuildAt, "rebuild before gate").toBeLessThan(gateAt);
    expect(gateAt, "gate before FIX OK").toBeLessThan(fixOkAt);

    // Exit 0 only if the gate is green: the red-gate branch exists and
    // fails before success.
    expect(diagnoseSource, "a red gate fails the fix").toContain(
      "if (gate.status !== 0)"
    );
    expect(diagnoseSource.indexOf("FIX FAILED: Node gate still red"), "gate failure precedes FIX OK").toBeLessThan(fixOkAt);

    // A unit-ready binding is reported as such and left untouched.
    expect(diagnoseSource, "--fix on unit-ready leaves the binding alone").toContain(
      "nothing to heal"
    );
    // The binding-rewritten proof compares mtime/size.
    expect(diagnoseSource, "FIX OK carries an mtime/size rewritten proof").toContain(
      "after.mtimeMs !== before.mtimeMs || after.size !== before.size"
    );
    // Report-only diagnose exits 1 when the machine is not unit-ready.
    expect(diagnoseSource, "report-only path exists").toContain("if (!fix)");
  });

  it("drift class 3: CONTRIBUTING's row still promises exactly these checks", () => {
    expect(contributingMd).toContain(
      "drift class 3: unit-job rebuild before `npm test`, e2e gate before the suite (no healing first), bold step names verbatim, CI-only flake budget"
    );
    const layer2 = contributingMd.replace(/\s+/g, " ");
    expect(layer2).toContain(
      "the e2e job checks the Electron runtime is present"
    );
    expect(layer2).toContain(
      "proves the postinstall state directly, and then lets `pretest:e2e` re-heal"
    );
  });

  // ── drift class 10 — the lint watches itself ──────────────────────────────
  it("drift class 10: every it() in this file carries an expect, and nothing skips", () => {
    // Bodies come from the comment-stripped source: comments may legitimately
    // mention the very markers this check bans, and must not become evidence.
    const bodies = lintItBodies(lintCode);
    expect(bodies.length, "the lint's it() blocks are discoverable by the self-scan").toBeGreaterThan(20);

    // (The regex literals in this file spell out marker names as
    // alternatives, never the full marker-call shape, so neither the
    // module-level ban above nor this scan trips over the file's own
    // source.)
    const EXPECT_RE = /\bexpect\(/;
    const VACUOUS_ARG_RE = /\bexpect\(\s*(?:"[^"]*"|'[^']*'|`|\d|true|false|null|undefined)\s*[,.)]/;
    const empties: string[] = [];
    const vacuous: string[] = [];
    for (const body of bodies) {
      if (!EXPECT_RE.test(body)) empties.push(norm(body).slice(0, 90));
      if (VACUOUS_ARG_RE.test(body)) vacuous.push(norm(body).slice(0, 90));
    }
    expect(
      empties,
      `it() blocks with no expect() call: ${empties.join(" | ") || "none"}`
    ).toEqual([]);
    expect(
      vacuous,
      `it() blocks whose expect() is on a literal: ${vacuous.join(" | ") || "none"}`
    ).toEqual([]);
  });
});
