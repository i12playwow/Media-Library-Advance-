#!/usr/bin/env node
// append-drill-log.cjs — CI-side writer for GUARDS-LOG.md's hash chain.
//
// Scheduled drill runs append one summary line per OS (produced by the
// matrix jobs' `Record CI summary` step), then chain the batch exactly like
// the drill writer chains its own entries:
//
//   - 2026-09-27T...Z · ci · <os> · contract holds (10/10 legs) · run <url> · drill@<sha>
//   - 2026-09-27T...Z · ci · ubuntu-latest · contract holds (10/10 legs) · tamper holds · run <url> · drill@<sha>
//   - chain: <sha256-of-all-bytes-before-this-line> · entries <count>
//
// The optional `· tamper holds|BROKEN` clause rides only on lines from the
// OS that runs drill.yml's behavioral tamper leg (Linux): scripts/
// tamper-probe.cjs runs the guards-chain e2e spec, whose own arc tampers
// GUARDS-LOG.md mid-run and requires the real app to serve the tamper as an
// unverified FAILURE. Its verdict is history like any other: tamper holds
// proves the unverified path was exercised and green that week; tamper
// BROKEN is a red leg recorded as such.
//
// The chain line digests every byte before it — pre-log plus the new CI
// lines — LF-normalized, matching drift class 8's replay in
// docsSearchRefs.test.ts, which additionally requires the file to END with a
// chain line, so an unchained tail is tamper evidence rather than silence.
// GUARDS-LOG.md has no merge conflicts by construction: append-only files
// with distinct timestamped lines never conflict, so the job needs no
// rebase-on-conflict loop; the push either lands (chains included) or is
// retried by the workflow's third-attempt re-run of this script.

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

const LOG = path.join(__dirname, "..", "GUARDS-LOG.md");
// Identical line contract to the one drift class 8 enforces.
const CI_LINE_RE = /^- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z · ci · [a-z-]+ · contract (?:holds|BROKEN) \(\d+\/10 legs\)(?: · tamper (?:holds|BROKEN))? · run \S+ · drill@[0-9a-f]+$/;
const CHAIN_LINE_RE = /^- chain: [0-9a-f]{64} · entries \d+$/;
const normalize = (s) => s.replace(/\r\n/g, "\n");

// ── collect and validate the payload first: fail before touching the log ──
const payload = (process.env.CI_SUMMARY_LINES || "").trim();
if (!payload) {
  console.error("CI_SUMMARY_LINES is empty — nothing to append (drill.yml failed earlier, which is the real signal)");
  process.exit(1);
}
const lines = payload
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);
for (const line of lines) {
  if (!CI_LINE_RE.test(line)) {
    console.error(`malformed CI summary line, refusing to append: ${JSON.stringify(line.slice(0, 90))}`);
    process.exit(1);
  }
}

// ── append + chain (file + lines is the digest boundary, like the writer) ──
const normalized = normalize(fs.readFileSync(LOG, "utf8"));
const withLines = normalized + lines.join("\n") + "\n";
const digest = crypto.createHash("sha256").update(withLines, "utf8").digest("hex");
const entryCount = (withLines.match(/^## /gm) || []).length;
fs.appendFileSync(LOG, lines.join("\n") + "\n" + `- chain: ${digest} · entries ${entryCount}\n`, "utf8");
console.log(`appended ${lines.length} CI summary line(s) and chained at entries ${entryCount}`);
