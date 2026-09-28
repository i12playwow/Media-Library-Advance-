import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { createProfile } from "../helpers/profile";

// The unverified-fallback story, end to end in the REAL app: the renderer
// never reads GUARDS-LOG.md itself — main verifies the chain at read time
// through app/services/guardsChain.ts (the fifth digest-pinned replay), and
// this leg drives the real preload bridge over guards:getChainState and
// guards:listSegments. The compiled service (rootDir app → dist/services)
// resolves ../../GUARDS-LOG.md to the repo's actual committed log, so the
// tamper below hits the same bytes the GUI verifies.
//
// Arc: clean launch → verified with the real history → one historical byte
// is tampered on disk → Re-verify now → FAILURE plus the mandatory
// unverified banner with the parse-only breakdown still visible → log
// restored → a fresh launch verifies again. The restore is unconditional in
// the finally block: the log leaves this test exactly as it entered it.

const LOG_PATH = path.join(process.cwd(), "GUARDS-LOG.md");
// The first drill entry's timestamp: it exists only in the breakdown list
// (the summary's "Last verified run" always names the NEWEST entry), so it
// isolates the per-segment breakdown in both the verified and the unverified
// renders.
const OLDEST_ENTRY = /2026-09-26T04:49:27\.968Z/;

// Never hardcode the history's size: the log is append-only by design (drills
// and CI appends legitimately grow it), so the expected summary counts are
// DERIVED from the bytes on disk at run time — a hardcoded count would break
// on every honest append, exactly like an exact-count integration pin.
function expectedCounts(log: string): { segments: number; entries: number } {
  return {
    segments: (log.match(/^- chain: [0-9a-f]{64} · entries [0-9]+$/gm) ?? []).length,
    entries: (log.match(/^## /gm) ?? []).length
  };
}

test("A tampered guards log turns the Settings card unverified through the real preload bridge", async () => {
  const profile = await createProfile();
  const launchEnv = { ...process.env, MLA_USER_DATA_DIR: profile.userDataDir };
  const originalLog = await fs.readFile(LOG_PATH, "utf8");
  const counts = expectedCounts(originalLog);

  try {
    const app = await electron.launch({ args: [process.cwd()], env: launchEnv });
    try {
      const page = await app.firstWindow();
      await expect(page).toHaveTitle("MLA+");
      await page.getByRole("button", { name: "Settings", exact: true }).click();

      const card = page.locator(".panel", { hasText: "Tamper-evident history" });

      // ── Phase 1: the committed log verifies, history rendered ────────────
      await expect(card.getByText("verified", { exact: true })).toBeVisible();
      await expect(card.getByText(new RegExp(`Chained segments: ${counts.segments}`))).toBeVisible();
      await expect(card.getByText(new RegExp(`Drill entries: ${counts.entries}`))).toBeVisible();
      await expect(card.getByText(OLDEST_ENTRY)).toBeVisible();

      // ── Phase 2: tamper one historical byte on disk ──────────────────────
      // The first occurrence lives inside the log's FIRST segment, so its
      // own chain line and every later one now describe bytes that no longer
      // exist — the replay must fail, and the failure must be loud.
      const tamperedLog = originalLog.replace("rebuild-node ok", "rebuild-node oK");
      expect(tamperedLog).not.toBe(originalLog);
      await fs.writeFile(LOG_PATH, tamperedLog, "utf8");

      // ── Phase 3: re-verify on demand — the bridge serves the failure ─────
      await card.getByRole("button", { name: "Re-verify now" }).click();
      await expect(card.getByText("FAILURE", { exact: true })).toBeVisible();
      await expect(
        card.getByText(/Unverified breakdown — the hash-chain replay FAILED/)
      ).toBeVisible();
      // Evidence without endorsement: the parse-only history stays
      // inspectable under the banner.
      await expect(card.getByText(OLDEST_ENTRY)).toBeVisible();

      // Restore before closing so the app never observes a half-state on
      // shutdown; the finally block below makes it unconditional anyway.
      await fs.writeFile(LOG_PATH, originalLog, "utf8");
    } finally {
      await app.close();
    }

    // ── Phase 4: a fresh app, fresh bridge, restored chain ────────────────
    const relaunched = await electron.launch({ args: [process.cwd()], env: launchEnv });
    try {
      const page = await relaunched.firstWindow();
      await expect(page).toHaveTitle("MLA+");
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      const card = page.locator(".panel", { hasText: "Tamper-evident history" });
      await expect(card.getByText("verified", { exact: true })).toBeVisible();
      await expect(card.getByText(new RegExp(`Chained segments: ${counts.segments}`))).toBeVisible();
    } finally {
      await relaunched.close();
    }
  } finally {
    // Unconditional: even a crashed run must not leave a tampered log on
    // disk — that would fail every later npm test with a real-looking
    // incident and pollute the committed history.
    await fs.writeFile(LOG_PATH, originalLog, "utf8");
    profile.database.close();
    await fs.rm(profile.userDataDir, { recursive: true, force: true });
  }
});
