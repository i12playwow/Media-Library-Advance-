import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import { createProfile, toggleGentle } from "./helpers/profile";

test("Electron app smoke flow covers library, gentle toggle, player, and theme persistence", async () => {
  const profile = await createProfile();
  const launchEnv = {
    ...process.env,
    MLA_USER_DATA_DIR: profile.userDataDir
  };

  const app = await electron.launch({
    args: [process.cwd()],
    env: launchEnv
  });

  try {
    const page = await app.firstWindow();
    await expect(page).toHaveTitle("MLA+");
    const libraryButton = page.getByRole("button", { name: "Library", exact: true });
    await expect(libraryButton).toBeEnabled();

    await libraryButton.click();
    await expect(page.locator(".movie-tile").filter({ hasText: "Alpha Feature" }).first()).toBeVisible();
    await expect(page.locator(".movie-tile").filter({ hasText: "Zeta Feature" }).first()).toBeVisible();
    await expect(page.locator(".movie-tile").filter({ hasText: "Gentle Feature" })).toHaveCount(0);

    // Gentle starts locked; the Ctrl+Alt+D shortcut toggles it for this session.
    await expect(page.getByText("Gentle off · Ctrl+Alt+D")).toBeVisible();
    await toggleGentle(page);
    await expect(page.getByText("Gentle on · Ctrl+Alt+D")).toBeVisible();
    await expect(page.locator(".movie-tile").filter({ hasText: "Gentle Feature" }).first()).toBeVisible();

    await page.locator(".movie-tile").filter({ hasText: "Zeta Feature" }).first().click({ button: "right" });
    await page.getByRole("button", { name: "Open in built-in player" }).click();
    await expect(page.getByText("Zeta Feature", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Subtitles" }).click();
    await expect(page.locator("#player-sub-search-query")).toHaveValue("ZZZ-001");

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const themeToggle = page.getByLabel("Use light theme");
    await themeToggle.check();
    await page.getByRole("button", { name: "Save theme" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  } finally {
    await app.close();
  }

  const relaunched = await electron.launch({
    args: [process.cwd()],
    env: launchEnv
  });

  try {
    const page = await relaunched.firstWindow();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "Library", exact: true }).click();
    // Gentle unlock is per-session: a relaunch starts locked again.
    await expect(page.locator(".movie-tile").filter({ hasText: "Gentle Feature" })).toHaveCount(0);
    await expect(page.getByText("Gentle off · Ctrl+Alt+D")).toBeVisible();
  } finally {
    await relaunched.close();
    profile.database.close();
    await fs.rm(profile.userDataDir, { recursive: true, force: true });
  }
});
