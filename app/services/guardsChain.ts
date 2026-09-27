import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { GuardsChainState } from "../shared/contracts";

// Mirrors drift class 8's replay in docsSearchRefs.test.ts: the log is a
// sequence of chained segments (drill entries and absorbed CI batches), each
// ending with a chain line that digests every byte before it. This service
// re-verifies the chain at read time, so the GUI renders the state the lint
// would compute — verified on every npm test AND on every page view.
const LOG_PATH = path.join(__dirname, "..", "..", "GUARDS-LOG.md");
export const LINE_END = "\n";
export const CHAIN_LINE_TAIL = /- chain: ([0-9a-f]{64}) · entries (\d+)$/;
const LAST_RUN_HEAD = /^## (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) — contract (holds|BROKEN)/;

export function readGuardsChainState(now: Date = new Date()): GuardsChainState {
  let raw: string;
  try {
    raw = fs.readFileSync(LOG_PATH, "utf8");
  } catch {
    return {
      ok: false,
      segments: 0,
      entries: 0,
      tipDigest: null,
      lastRun: null,
      verifiedAt: now.toISOString()
    };
  }
  return verifyChainLog(raw, now);
}

export function verifyChainLog(raw: string, now: Date = new Date()): GuardsChainState {
  const logLines = raw.replace(/\r\n/g, "\n").split("\n");
  const chainLines: Array<{ index: number; digest: string; entries: number }> = [];
  for (let i = 0; i < logLines.length; i++) {
    const match = CHAIN_LINE_TAIL.exec(logLines[i]);
    if (match) chainLines.push({ index: i, digest: match[1], entries: Number(match[2]) });
  }
  const totalEntries = logLines.filter((l) => /^## /.test(l)).length;
  if (chainLines.length === 0) {
    return { ok: false, segments: 0, entries: totalEntries, tipDigest: null, lastRun: null, verifiedAt: now.toISOString() };
  }

  // Tip invariant: the log must END with a chain line.
  let tip = logLines.length - 1;
  while (tip >= 0 && logLines[tip].trim() === "") tip--;
  if (tip !== chainLines[chainLines.length - 1].index) {
    return {
      ok: false,
      segments: chainLines.length,
      entries: totalEntries,
      tipDigest: chainLines[chainLines.length - 1].digest,
      lastRun: null,
      verifiedAt: now.toISOString()
    };
  }

  // Single incremental walk — the entry count a chain line claims is the
  // number of headers SO FAR, not the file's total (the lint replays the
  // same way; counting all headers up front fails every segment but the last).
  let seenEntries = 0;
  let verifiedSegments = 0;
  for (let i = 0; i < logLines.length; i++) {
    if (/^## /.test(logLines[i])) seenEntries++;
    const claimed = chainLines[verifiedSegments];
    if (!claimed || claimed.index !== i) continue;
    verifiedSegments++;
    const computed = createHash("sha256")
      .update(logLines.slice(0, i).join(LINE_END) + LINE_END, "utf8")
      .digest("hex");
    if (computed !== claimed.digest || claimed.entries !== seenEntries) {
      return {
        ok: false,
        segments: verifiedSegments,
        entries: chainLines[verifiedSegments - 2]?.entries ?? 0,
        tipDigest: chainLines[chainLines.length - 1].digest,
        lastRun: null,
        verifiedAt: now.toISOString()
      };
    }
  }

  // The last verified run: the latest `## ` entry's timestamp and verdict.
  let lastRun: string | null = null;
  for (let i = logLines.length - 1; i >= 0; i--) {
    const match = LAST_RUN_HEAD.exec(logLines[i]);
    if (match) {
      lastRun = `${match[1]} — contract ${match[2]}`;
      break;
    }
  }

  return {
    ok: true,
    segments: chainLines.length,
    entries: totalEntries,
    tipDigest: chainLines[chainLines.length - 1].digest,
    lastRun,
    verifiedAt: now.toISOString()
  };
}
