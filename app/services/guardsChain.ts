import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { GuardsChainSegment, GuardsChainSegmentsResult, GuardsChainState } from "../shared/contracts";

// Mirrors drift class 8's replay in docsSearchRefs.test.ts: the log is a
// sequence of chained segments (drill entries and absorbed CI batches), each
// ending with a chain line that digests every byte before it. This service
// re-verifies the chain at read time, so the GUI renders the state the lint
// would compute — verified on every npm test AND on every page view.
const LOG_PATH = path.join(__dirname, "..", "..", "GUARDS-LOG.md");
export const LINE_END = "\n";
export const CHAIN_LINE_TAIL = /- chain: ([0-9a-f]{64}) · entries (\d+)$/;
const LAST_RUN_HEAD = /^## (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) — contract (holds|BROKEN)/;
// CI summary line shape (mirrors append-drill-log.cjs's CI_LINE_RE; classifies
// segment items for the Settings breakdown).
const CI_LINE = /^- (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) · ci · [a-z-]+ · contract (holds|BROKEN) \(\d+\/10 legs\) · run \S+ · drill@[0-9a-f]+$/;
// Sole LF-normalization site: both readers route through this helper, keeping
// the lint's structural pin (exactly one normalize atom) true.
const toLf = (raw: string): string => raw.replace(/\r\n/g, "\n");

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
  const logLines = toLf(raw).split("\n");
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

// Verified per-segment extraction for the Settings breakdown
// (guards:listSegments). Gated on a full replay of the SAME bytes — a
// tampered or unchained log yields null, never a breakdown. That gate is
// the contract: callers that need data even when verification fails go
// through extractUnverifiedChainSegments, which cannot claim integrity.
// No hashing here: verifyChainLog already proved every digest on this
// input, keeping the file at exactly one sha256 site (the lint pins it).
export function extractChainSegments(raw: string): GuardsChainSegment[] | null {
  if (!verifyChainLog(raw).ok) return null;
  return buildSegments(raw);
}

// The parse-only half both extractors share: classify `## ` heads as drill
// entries and CI-summary lines as absorbed batches, assign each segment its
// chain line's digest and running entry count, and stamp each item with the
// segment's digest prefix. Structure only — integrity is never asserted
// here, so the file keeps exactly one sha256 site (the lint pins it).
function buildSegments(raw: string): GuardsChainSegment[] {
  const logLines = toLf(raw).split("\n");
  const chainLines: Array<{ index: number; digest: string; entries: number }> = [];
  for (let i = 0; i < logLines.length; i++) {
    const match = CHAIN_LINE_TAIL.exec(logLines[i]);
    if (match) chainLines.push({ index: i, digest: match[1], entries: Number(match[2]) });
  }
  const segments: GuardsChainSegment[] = [];
  let pending: GuardsChainSegment | null = null;
  let nextChain = 0;
  for (let i = 0; i < logLines.length; i++) {
    const claimed = chainLines[nextChain];
    if (claimed && claimed.index === i) {
      if (pending) {
        pending.digest = claimed.digest;
        pending.entriesAtChain = claimed.entries;
        segments.push(pending);
        pending = null;
      }
      nextChain++;
      continue;
    }
    const head = LAST_RUN_HEAD.exec(logLines[i]);
    if (head) {
      if (!pending) pending = { kind: "entry", items: [], digest: "", entriesAtChain: 0 };
      pending.kind = "entry";
      pending.items.push({ kind: "entry", timestamp: head[1], verdict: head[2] as "holds" | "BROKEN", digestPrefix: "" });
      continue;
    }
    const ci = CI_LINE.exec(logLines[i]);
    if (ci) {
      if (!pending) pending = { kind: "ci-batch", items: [], digest: "", entriesAtChain: 0 };
      pending.kind = "ci-batch";
      pending.items.push({ kind: "ci", timestamp: ci[1], verdict: ci[2] as "holds" | "BROKEN", digestPrefix: "" });
    }
  }
  if (nextChain !== chainLines.length) return [];
  for (const segment of segments) {
    for (const item of segment.items) item.digestPrefix = segment.digest.slice(0, 12);
  }
  return segments;
}

// Forensics variant for the unverified fallback: identical output shape to
// extractChainSegments but NO gate — deliberately, so a broken chain's
// history stays inspectable. Never for integrity claims: it hashes nothing
// and its callers must banner the result as unverified (the renderer does;
// the discriminated result type forces every consumer to branch).
export function extractUnverifiedChainSegments(raw: string): GuardsChainSegment[] {
  return buildSegments(raw);
}

export function readGuardsChainSegments(): GuardsChainSegmentsResult {
  let raw: string;
  try {
    raw = fs.readFileSync(LOG_PATH, "utf8");
  } catch {
    return { status: "unavailable" };
  }
  if (verifyChainLog(raw).ok) return { status: "verified", segments: buildSegments(raw) };
  return { status: "unverified", reason: "tampered", segments: extractUnverifiedChainSegments(raw) };
}
