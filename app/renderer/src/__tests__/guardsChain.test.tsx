import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import type { GuardsChainSegmentsResult } from "../../../shared/contracts";
import { verifyChainLog, extractChainSegments, extractUnverifiedChainSegments, readGuardsChainSegments } from "../../../services/guardsChain";
import { GuardsChainCard, GuardsChainSection } from "../components/GuardsChainCard";

// ── chain replay over fixture texts (no disk fixtures; digests computed) ───
function chainedLog(segments: Array<{ body: string[]; entries: number }>): string {
  const lines: string[] = ["# Guards log", "", "Header prose."];
  let entries = 0;
  for (const segment of segments) {
    lines.push(...segment.body);
    entries += segment.entries;
    const digest = crypto
      .createHash("sha256")
      .update(lines.join("\n") + "\n", "utf8")
      .digest("hex");
    lines.push(`- chain: ${digest} · entries ${entries}`);
  }
  return lines.join("\n") + "\n";
}

const ENTRY_A = {
  body: [
    "## 2026-09-27T17:35:20.857Z — contract holds (10/10 legs)",
    "",
    "- node v24.19.0 · better-sqlite3 12.11.1 · electron 41.1.1 · commit 7202896 · win32 · 54s",
    "",
    "| # | Leg | Result | Kind | Detail |",
    "|---|---|---|---|---|",
    "| 1 | 1. rebuild:node (baseline) | ✅ | contract | rebuild-node ok |",
  ],
  entries: 1
};

const CI_BATCH = {
  body: [
    "- 2026-09-28T03:17:00.000Z · ci · ubuntu-latest · contract holds (10/10 legs) · run https://example.invalid/r/1 · drill@7202896",
    "- 2026-09-28T03:17:00.000Z · ci · windows-latest · contract holds (10/10 legs) · run https://example.invalid/r/1 · drill@7202896",
  ],
  entries: 0
};

const ENTRY_B = {
  body: [
    "## 2026-09-28T04:00:00.000Z — contract holds (10/10 legs)",
    "",
    "- node v24.19.0 · better-sqlite3 12.11.1 · electron 41.1.1 · commit 7202896 · linux · 30s",
    "",
    "| # | Leg | Result | Kind | Detail |",
    "|---|---|---|---|---|",
    "| 1 | 1. rebuild:node (baseline) | ✅ | contract | rebuild-node ok |",
  ],
  entries: 1
};

const CI_BATCH_BROKEN = {
  body: [
    "- 2026-09-28T04:30:00.000Z · ci · macos-latest · contract BROKEN (3/10 legs) · run https://example.invalid/r/2 · drill@7202896"
  ],
  entries: 0
};

const THREE = [ENTRY_A, CI_BATCH, ENTRY_B];

describe("guardsChain service", () => {
  const now = new Date("2026-09-28T05:00:00.000Z");

  it("verifies a healthy chained log (entries + CI batches), reporting tip and last run", () => {
    const state = verifyChainLog(chainedLog(THREE), now);
    expect(state.ok).toBe(true);
    expect(state.segments).toBe(3);
    expect(state.entries).toBe(2);
    expect(state.tipDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(state.lastRun).toBe("2026-09-28T04:00:00.000Z — contract holds");
    expect(state.verifiedAt).toBe(now.toISOString());
  });

  it("fails and reports the claimed tip when a historical byte is tampered with", () => {
    const log = chainedLog(THREE).replace("rebuild-node ok", "rebuild-node oK");
    const state = verifyChainLog(log, now);
    expect(state.ok).toBe(false);
    expect(state.segments).toBe(1); // segment 1 verified, broke entering segment 2
    expect(state.tipDigest).toMatch(/^[0-9a-f]{64}$/); // claimed tip, kept for diagnostics
  });

  it("fails with segments 0 when the log has no chain lines at all", () => {
    const state = verifyChainLog("# Guards log\n\njust prose\n", now);
    expect(state.ok).toBe(false);
    expect(state.segments).toBe(0);
    expect(state.tipDigest).toBe(null);
  });

  it("fails the tip invariant when unchained content follows the last chain line", () => {
    const log = chainedLog([ENTRY_A]) + "\nfree text after the log\n";
    const state = verifyChainLog(log, now);
    expect(state.ok).toBe(false);
    // The claimed tip is still surfaced for diagnostics.
    expect(state.tipDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("fails when a chain line's entry count disagrees with the headers seen", () => {
    const log = chainedLog([ENTRY_A]).replace("· entries 1", "· entries 2");
    expect(verifyChainLog(log, now).ok).toBe(false);
  });

  it("extracts per-segment kinds, timestamps, verdicts, and digest prefixes", () => {
    const segments = extractChainSegments(chainedLog([...THREE, CI_BATCH_BROKEN]));
    expect(segments).not.toBeNull();
    expect(segments!.map((s) => s.kind)).toEqual(["entry", "ci-batch", "entry", "ci-batch"]);
    expect(segments![0].items).toEqual([
      {
        kind: "entry",
        timestamp: "2026-09-27T17:35:20.857Z",
        verdict: "holds",
        digestPrefix: segments![0].digest.slice(0, 12)
      }
    ]);
    expect(segments![1].items.map((i) => i.kind)).toEqual(["ci", "ci"]);
    expect(segments![1].items[0].timestamp).toBe("2026-09-28T03:17:00.000Z");
    expect(segments![2].entriesAtChain).toBe(2);
    expect(segments![3].items[0].verdict).toBe("BROKEN");
    for (const segment of segments!) {
      expect(segment.digest).toMatch(/^[0-9a-f]{64}$/);
      for (const item of segment.items) expect(item.digestPrefix).toMatch(/^[0-9a-f]{12}$/);
    }
  });

  it("refuses to break down a tampered log", () => {
    const log = chainedLog(THREE).replace("rebuild-node ok", "rebuild-node oK");
    expect(extractChainSegments(log)).toBeNull();
  });

  it("extracts segments from the committed GUARDS-LOG.md — the same bytes the GUI reads", () => {
    const logPath = path.resolve(__dirname, "..", "..", "..", "..", "GUARDS-LOG.md");
    const raw = fs.readFileSync(logPath, "utf8");
    const segments = extractChainSegments(raw);
    expect(segments, "the committed log verifies and parses").not.toBeNull();
    expect(segments!.length).toBeGreaterThanOrEqual(10);
    const entrySegments = segments!.filter((s) => s.kind === "entry");
    // A floor, not an exact count: the log is append-only, and every drill
    // or CI append legitimately grows it. An exact pin here would break on
    // each honest run — the exactness lives in the chain replay instead.
    expect(entrySegments.length).toBeGreaterThanOrEqual(10);
    expect(entrySegments[0].items[0].timestamp).toBe("2026-09-26T04:49:27.968Z");
    expect(segments![segments!.length - 1].digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("unverified fallback", () => {
  it("returns the same breakdown as the verified path over a healthy log", () => {
    const raw = chainedLog([...THREE, CI_BATCH_BROKEN]);
    const verified = extractChainSegments(raw);
    expect(verified).not.toBeNull();
    expect(extractUnverifiedChainSegments(raw)).toEqual(verified);
  });

  it("yields a parse-only breakdown over a tampered log — evidence without endorsement", () => {
    const log = chainedLog(THREE).replace("rebuild-node ok", "rebuild-node oK");
    expect(extractChainSegments(log)).toBeNull();
    const segments = extractUnverifiedChainSegments(log);
    expect(segments).toHaveLength(3);
    expect(segments.map((s) => s.kind)).toEqual(["entry", "ci-batch", "entry"]);
    expect(segments.every((s) => s.digest !== "")).toBe(true);
  });

  it("renders segments past a chainless tail instead of hiding them", () => {
    const log = chainedLog([ENTRY_A]) + "\nfree text after the log\n";
    const segments = extractUnverifiedChainSegments(log);
    expect(segments).toHaveLength(1);
  });

  it("returns the union over the real committed log — the exact bytes the channel serves", () => {
    const logPath = path.resolve(__dirname, "..", "..", "..", "..", "GUARDS-LOG.md");
    const raw = fs.readFileSync(logPath, "utf8");
    const result: GuardsChainSegmentsResult = readGuardsChainSegments();
    expect(result.status).toBe("verified");
    if (result.status !== "verified") return;
    expect(result.segments).toEqual(extractChainSegments(raw));
    expect(result.segments.length).toBeGreaterThanOrEqual(10);
  });
});

const SEGMENTS_STUB = [
  {
    kind: "entry" as const,
    items: [
      { kind: "entry" as const, timestamp: "2026-09-27T17:35:20.857Z", verdict: "holds" as const, digestPrefix: "aaaaaaaaaaaa" }
    ],
    digest: "a".repeat(64),
    entriesAtChain: 1
  },
  {
    kind: "ci-batch" as const,
    items: [
      { kind: "ci" as const, timestamp: "2026-09-28T03:17:00.000Z", verdict: "holds" as const, digestPrefix: "bbbbbbbbbbbb" }
    ],
    digest: "b".repeat(64),
    entriesAtChain: 1
  }
];

describe("GuardsChainCard + GuardsChainSection", () => {
  it("renders a healthy chain state with tip digest and last run", () => {
    render(
      <GuardsChainCard
        state={{
          ok: true,
          segments: 10,
          entries: 9,
          tipDigest: "a".repeat(64),
          lastRun: "2026-09-27T17:35:20.857Z — contract holds",
          verifiedAt: "2026-09-28T05:00:00.000Z"
        }}
      />
    );
    expect(screen.getByText("verified")).toBeInTheDocument();
    expect(screen.getByText(/Chained segments: 10/)).toBeInTheDocument();
    expect(screen.getByText(/Drill entries: 9/)).toBeInTheDocument();
    expect(screen.getByText(/aaaaaa/)).toBeInTheDocument();
    expect(screen.getByText(/2026-09-27T17:35:20.857Z — contract holds/)).toBeInTheDocument();
  });

  it("renders a per-segment breakdown with timestamps, verdicts, and digest prefixes", () => {
    const digestA = "d".repeat(64);
    const digestB = "e".repeat(64);
    render(
      <GuardsChainCard
        state={{
          ok: true,
          segments: 2,
          entries: 1,
          tipDigest: digestB,
          lastRun: null,
          verifiedAt: "2026-09-28T05:00:00.000Z"
        }}
        chain={{ status: "verified", segments: [
          {
            kind: "entry",
            items: [{ kind: "entry", timestamp: "2026-09-27T17:35:20.857Z", verdict: "holds", digestPrefix: digestA.slice(0, 12) }],
            digest: digestA,
            entriesAtChain: 1
          },
          {
            kind: "ci-batch",
            items: [{ kind: "ci", timestamp: "2026-09-28T03:17:00.000Z", verdict: "BROKEN", digestPrefix: digestB.slice(0, 12) }],
            digest: digestB,
            entriesAtChain: 1
          }
        ] }}
      />
    );
    expect(screen.getByText(/drill entry/)).toBeInTheDocument();
    expect(screen.getByText(/ci batch/)).toBeInTheDocument();
    expect(screen.getByText(/2026-09-27T17:35:20.857Z/)).toBeInTheDocument();
    expect(screen.getByText(/2026-09-28T03:17:00.000Z/)).toBeInTheDocument();
    expect(screen.getByText(/BROKEN/)).toBeInTheDocument();
    // The full digest rides the title attribute for hover inspection.
    expect(screen.getByTitle(digestA)).toBeInTheDocument();
  });

  it("renders a human-readable age next to each item's timestamp, deterministically", () => {
    const now = new Date("2026-09-28T12:00:00.000Z");
    render(
      <GuardsChainCard
        now={now}
        state={{
          ok: true,
          segments: 1,
          entries: 1,
          tipDigest: "f".repeat(64),
          lastRun: null,
          verifiedAt: now.toISOString()
        }}
        chain={{ status: "verified", segments: [
          {
            kind: "entry",
            items: [
              { kind: "entry", timestamp: "2026-09-28T11:59:30.000Z", verdict: "holds", digestPrefix: "1".repeat(12) },
              { kind: "entry", timestamp: "2026-09-24T12:00:00.000Z", verdict: "holds", digestPrefix: "2".repeat(12) },
              { kind: "entry", timestamp: "2026-03-28T12:00:00.000Z", verdict: "holds", digestPrefix: "3".repeat(12) },
              { kind: "entry", timestamp: "not-a-timestamp", verdict: "holds", digestPrefix: "4".repeat(12) }
            ],
            digest: "1".repeat(64),
            entriesAtChain: 1
          }
        ] }}
      />
    );
    expect(screen.getByText(/just now/)).toBeInTheDocument();
    expect(screen.getByText(/4 days ago/)).toBeInTheDocument();
    expect(screen.getByText(/6 months ago/)).toBeInTheDocument();
    // Unparseable timestamps degrade to an em dash, not NaN.
    expect(screen.getByText(/· —/)).toBeInTheDocument();
  });

  it("banners an unverified result and renders its breakdown for inspection", () => {
    const digest = "9".repeat(64);
    render(
      <GuardsChainCard
        state={{
          ok: false,
          segments: 2,
          entries: 1,
          tipDigest: digest,
          lastRun: null,
          verifiedAt: "2026-09-28T05:00:00.000Z"
        }}
        chain={{
          status: "unverified",
          reason: "tampered",
          segments: [
            {
              kind: "entry",
              items: [{ kind: "entry", timestamp: "2026-09-27T17:35:20.857Z", verdict: "holds", digestPrefix: digest.slice(0, 12) }],
              digest,
              entriesAtChain: 1
            }
          ]
        }}
      />
    );
    expect(screen.getByText("FAILURE")).toBeInTheDocument();
    expect(
      screen.getByText(/Unverified breakdown — the hash-chain replay FAILED/)
    ).toBeInTheDocument();
    // The parse-only history stays visible under the banner.
    expect(screen.getByText(/drill entry/)).toBeInTheDocument();
    expect(screen.getByText(/2026-09-27T17:35:20.857Z/)).toBeInTheDocument();
  });

  it("renders the failure state loudly", () => {
    render(
      <GuardsChainCard
        state={{ ok: false, segments: 2, entries: 2, tipDigest: null, lastRun: null, verifiedAt: "x" }}
      />
    );
    expect(screen.getByText("FAILURE")).toBeInTheDocument();
    expect(screen.getByText(/failed its hash-chain replay/)).toBeInTheDocument();
  });

  it("renders the error and loading states", () => {
    const { rerender } = render(<GuardsChainCard state={null} error="boom" />);
    expect(screen.getByText(/Chain state unavailable: boom/)).toBeInTheDocument();
    rerender(<GuardsChainCard state={null} />);
    expect(screen.getByText(/Verifying the guards log/)).toBeInTheDocument();
  });

  it("the section fetches both channels over IPC, renders, and re-verifies on demand", async () => {
    let calls = 0;
    let segCalls = 0;
    (window as unknown as { desktopApi: unknown }).desktopApi = {
      getGuardsChainState: async () => {
        calls++;
        return {
          ok: true,
          segments: 3,
          entries: 2,
          tipDigest: "b".repeat(64),
          lastRun: "2026-09-28T04:00:00.000Z — contract holds",
          verifiedAt: "2026-09-28T05:00:00.000Z"
        };
      },
      listGuardsChainSegments: async () => {
        segCalls++;
        return { status: "verified", segments: SEGMENTS_STUB };
      }
    };

    render(<GuardsChainSection />);
    await waitFor(() => expect(screen.getByText("verified")).toBeInTheDocument());
    expect(screen.getByText(/Chained segments: 3/)).toBeInTheDocument();
    expect(screen.getByText(/ci batch/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Re-verify now/i }));
    await waitFor(() => expect(calls).toBe(2));
    expect(segCalls).toBe(2);
  });

  it("re-verifies the chain every 30s while mounted, without a manual refresh", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      let verdict = true;
      (window as unknown as { desktopApi: unknown }).desktopApi = {
        getGuardsChainState: async () => {
          calls++;
          return {
            ok: verdict,
            segments: 10,
            entries: 9,
            tipDigest: "c".repeat(64),
            lastRun: "2026-09-27T17:35:20.857Z — contract holds",
            verifiedAt: "2026-09-28T05:00:00.000Z"
          };
        },
        listGuardsChainSegments: async () => ({ status: "unavailable" })
      };

      render(<GuardsChainSection />);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByText("verified")).toBeInTheDocument();
      expect(calls).toBe(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(calls).toBe(2);
      await act(async () => {
        await Promise.resolve();
      });

      verdict = false;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(29_999);
        await vi.advanceTimersByTimeAsync(1);
        await Promise.resolve();
      });
      expect(screen.getByText("FAILURE")).toBeInTheDocument();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(calls).toBe(3); // 29_999 + 1 ticked a single 30s boundary
    } finally {
      vi.useRealTimers();
    }
  });
});
