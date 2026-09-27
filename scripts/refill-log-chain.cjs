// refill-log-chain.cjs — back-compute GUARDS-LOG.md's tamper-evident chain.
//
// The log is a sequence of chained SEGMENTS. A segment is either a drill
// entry (one `## ` header through its leg table's last row) or a batch of CI
// summary lines absorbed between segments. Each segment ends with a chain
// line:
//
//   - chain: <sha256-of-all-bytes-before-this-line> · entries <count>
//
// (LF-normalized; <count> = `## ` headers so far). The drill writer chains
// its own entries, scripts/append-drill-log.cjs chains CI batches, and
// docsSearchRefs.test.ts's drift class 8 replays the whole chain on every
// npm test — including the invariant that the file ENDS with a chain line.
//
// Run this script ONLY to (a) seed the chain the first time, or (b) re-seed
// after a *legitimate* edit to the log — the lint cannot distinguish an
// honest rewrite from a dishonest one, so the remedy is a deliberate, visible
// re-commit. The script verifies its own output with the same replay the
// lint performs BEFORE writing; it never leaves a broken chain on disk.

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

const LOG = path.join(__dirname, "..", "GUARDS-LOG.md");
const CHAIN_LINE_RE = /^- chain: [0-9a-f]{64} · entries \d+$/;
const CI_LINE_RE = /^- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z · ci · /;
const normalize = (s) => s.replace(/\r\n/g, "\n");

// ── the verifier, the same replay drift class 8 performs ───────────────────
function verify(lines) {
  let seenEntries = 0;
  let segments = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^## /.test(lines[i])) seenEntries++;
    const m = /^- chain: ([0-9a-f]{64}) · entries (\d+)$/.exec(lines[i]);
    if (!m) continue;
    segments++;
    const digest = crypto
      .createHash("sha256")
      .update(lines.slice(0, i).join("\n") + "\n", "utf8")
      .digest("hex");
    if (m[1] !== digest) return { ok: false, why: `chain line ${segments} digest mismatch` };
    if (Number(m[2]) !== seenEntries) return { ok: false, why: `chain line ${segments} entry count mismatch` };
  }
  // Tip invariant: the last non-blank line must be a chain line.
  let tip = lines.length - 1;
  while (tip >= 0 && lines[tip].trim() === "") tip--;
  if (tip < 0 || !CHAIN_LINE_RE.test(lines[tip])) {
    return { ok: false, why: "the log does not end with a chain line" };
  }
  return { ok: true };
}

// ── rebuild: strip old chain lines, re-place one per segment ───────────────
const raw = normalize(fs.readFileSync(LOG, "utf8"));
const lines = raw.split("\n").filter((l) => !CHAIN_LINE_RE.test(l));

const entryStarts = lines.reduce((acc, l, i) => {
  if (/^## /.test(l)) acc.push(i);
  return acc;
}, []);
if (entryStarts.length === 0) {
  console.error("no drill entries found — nothing to chain");
  process.exit(1);
}

function digestOf(out) {
  return crypto.createHash("sha256").update(out.join("\n") + "\n", "utf8").digest("hex");
}
function chainFor(out) {
  const entries = out.filter((l) => /^## /.test(l)).length;
  return `- chain: ${digestOf(out)} · entries ${entries}`;
}

const out = [];
// Header region: everything before the first entry, verbatim.
out.push(...lines.slice(0, entryStarts[0]));

for (let e = 0; e < entryStarts.length; e++) {
  const start = entryStarts[e];
  const blockEnd = e + 1 < entryStarts.length ? entryStarts[e + 1] : lines.length;
  // The entry's own lines run to its last leg-table row.
  let last = blockEnd - 1;
  while (last > start && !/^\|/.test(lines[last]) && lines[last].trim() !== "") last--;
  while (last > start && !/^\|/.test(lines[last])) last--;
  out.push(...lines.slice(start, last + 1));
  out.push(chainFor(out));
  // Any CI summary lines between this entry's table and the next header
  // form their own chained segment.
  const ciLines = lines.slice(last + 1, blockEnd).filter((l) => CI_LINE_RE.test(l));
  if (ciLines.length > 0) {
    out.push(...ciLines);
    out.push(chainFor(out));
  }
  // Canonical blank separator before the next entry (or EOF); the tip
  // invariant ignores trailing blanks.
  out.push("");
}

const verdict = verify(out);
if (!verdict.ok) {
  console.error(`refill produced an invalid chain (${verdict.why}) — log left untouched`);
  process.exit(1);
}
const result = out.join("\n");
if (result === raw) {
  console.log("chain already current — no changes");
  process.exit(0);
}
fs.writeFileSync(LOG, result, "utf8");
console.log(`chain verified before write: rebuilt across ${entryStarts.length} entr(ies)`);
