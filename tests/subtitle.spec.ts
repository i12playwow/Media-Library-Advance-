import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import { createProfile, toggleGentle } from "./helpers/profile";

// Subtitle flow in the built-in player: the search input auto-fills with the
// detected DVD ID from the movie's metadata, is editable, and drives the
// SubtitleCat search. (The original file was a self-labeled template driving a
// browser `page` fixture against localhost:5173 — impossible under the
// Electron project — so it never ran.)

test("Subtitle search is auto-filled with the detected DVD ID and stays editable", async () => {
  const profile = await createProfile();
  const app = await electron.launch({
    args: [process.cwd()],
    env: { ...process.env, MLA_USER_DATA_DIR: profile.userDataDir }
  });

  try {
    const page = await app.firstWindow();
    await expect(page).toHaveTitle("MLA+");

    // Wait for the topbar (and the loaded shortcut config behind it) before
    // pressing the toggle — pressing too early races the app's bootstrap IPC.
    await expect(page.getByText("Gentle off · Ctrl+Alt+D")).toBeVisible();

    // Gentle must be unlocked before the gentle-library title is listable.
    await toggleGentle(page);
    await expect(page.getByText("Gentle on · Ctrl+Alt+D")).toBeVisible();

    await page.getByRole("button", { name: "Library", exact: true }).click();
    const tile = page.locator(".movie-tile").filter({ hasText: "Zeta Feature" }).first();
    await expect(tile).toBeVisible();

    await tile.click({ button: "right" });
    await page.getByRole("button", { name: "Open in built-in player" }).click();
    await expect(page.getByText("Zeta Feature", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Subtitles" }).click();

    const searchInput = page.locator("#player-sub-search-query");
    await expect(searchInput).toHaveValue("ZZZ-001");

    // The query stays editable — the merge made the search box a controlled input.
    await searchInput.fill("ZZZ-999");
    await expect(searchInput).toHaveValue("ZZZ-999");

    // The local .srt seeded for this movie is offered in the panel.
    await expect(page.locator(".player-sub-item").filter({ hasText: "en" }).first()).toBeVisible();
  } finally {
    await app.close();
    profile.database.close();
    await fs.rm(profile.userDataDir, { recursive: true, force: true });
  }
});
