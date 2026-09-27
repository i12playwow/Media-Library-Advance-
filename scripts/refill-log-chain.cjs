// refill-log-chain.cjs — back-compute GUARDS-LOG.md's tamper-evident chain.
//
// Every drill entry in GUARDS-LOG.md ends with a chain line:
//
//   - chain: <sha256-hex-of-all-bytes-before-this-line> · entries <count>
//
// where <count> is the number of `## ` entry headers in those same bytes
// (LF-normalized). docsSearchRefs.test.ts's drift class 8 verifies the chain
// on every npm test, making history tamper-evident: editing, dropping, or
// reordering any historical byte breaks every chain line after the edit.
//
// Run this script ONLY to (a) seed the chain the first time, or (b) re-seed
// after a *legitimate* edit to the log (fixing a typo, redacting a secret) —
// the lint cannot distinguish an honest rewrite from a dishonest one, so the
// remedy is a deliberate, visible re-commit of the whole chain. CI summary
// lines carry no chain of their own; they are absorbed into the next entry's
// chain digest.
//
// The script verifies its own output with the same replay the lint performs
// BEFORE writing; it never leaves a broken chain on disk.

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

const LOG = path.join(__dirname, "..", "GUARDS-LOG.md");
const CHAIN_LINE_RE = /^- chain: [0-9a-f]{64} · entries \d+$/;
const normalize = (s) => s.replace(/\r\n/g, "\n");

// ── the verifier, identical in spirit to drift class 8's replay ────────────
function verify(lines) {
  let seenEntries = 0;
  let chains = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^## /.test(lines[i])) seenEntries++;
    const m = /^- chain: ([0-9a-f]{64}) · entries (\d+)$/.exec(lines[i]);
    if (!m) continue;
    chains++;
    const digest = crypto
      .createHash("sha256")
      .update(lines.slice(0, i).join("\n") + "\n", "utf8")
      .digest("hex");
    if (m[1] !== digest) return { ok: false, why: `chain line ${chains} digest mismatch` };
    if (Number(m[2]) !== seenEntries) return { ok: false, why: `chain line ${chains} entry count mismatch` };
  }
  if (chains !== seenEntries) return { ok: false, why: `${chains} chain lines for ${seenEntries} entries` };
  return { ok: true };
}

// ── rebuild: strip old chain lines, re-place one per entry ─────────────────
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

const out = [];
// Header region: everything before the first entry, verbatim.
out.push(...lines.slice(0, entryStarts[0]));

for (let e = 0; e < entryStarts.length; e++) {
  const start = entryStarts[e];
  const blockEnd = e + 1 < entryStarts.length ? entryStarts[e + 1] : lines.length;
  // The entry's own lines: start .. last non-blank line of the block.
  let last = blockEnd - 1;
  while (last > start && lines[last].trim() === "") last--;
  out.push(...lines.slice(start, last + 1));
  // The gap after the entry (trailing blanks + CI summary lines) is carried
  // into the digest only for entries that are followed by such lines before
  // the next entry — CI lines belong to the NEXT entry's digest boundary,
  // matching the drill writer, which chains immediately after its table.
  out.push("");
  const prefix = out.join("\n") + "\n";
  const digest = crypto.createHash("sha256").update(prefix, "utf8").digest("hex");
  out.push(`- chain: ${digest} · entries ${e + 1}`);
  // Preserve whatever sat between this entry's last line and the next
  // header (blank separators, CI summary lines), minus old chain lines.
  out.push(...lines.slice(last + 1, blockEnd));
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
console.log(`chain verified before write: ${entryStarts.length} chain line(s) across ${entryStarts.length} entr(ies)`);
