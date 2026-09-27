import crypto from "node:crypto";
import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { verifyChainLog } from "../../../services/guardsChain";
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

describe("guardsChain service", () => {
  const now = new Date("2026-09-28T05:00:00.000Z");

  it("verifies a healthy chained log (entries + CI batches), reporting tip and last run", () => {
    const state = verifyChainLog(chainedLog([ENTRY_A, CI_BATCH, ENTRY_B]), now);
    expect(state.ok).toBe(true);
    expect(state.segments).toBe(3);
    expect(state.entries).toBe(2);
    expect(state.tipDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(state.lastRun).toBe("2026-09-28T04:00:00.000Z — contract holds");
    expect(state.verifiedAt).toBe(now.toISOString());
  });

  it("fails and reports the claimed tip when a historical byte is tampered with", () => {
    const log = chainedLog([ENTRY_A, CI_BATCH, ENTRY_B]).replace("rebuild-node ok", "rebuild-node oK");
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
    const state = verifyChainLog(log, now);
    expect(state.ok).toBe(false);
  });
});

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

  it("the section fetches over IPC, renders, and re-verifies on demand", async () => {
    let calls = 0;
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
      }
    };

    render(<GuardsChainSection />);
    await waitFor(() => expect(screen.getByText("verified")).toBeInTheDocument());
    expect(screen.getByText(/Chained segments: 3/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Re-verify now/i }));
    await waitFor(() => expect(calls).toBe(2));
  });
});
