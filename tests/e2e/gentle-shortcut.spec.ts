import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import { createProfile } from "../helpers/profile";

// The unlock-shortcut field must persist the same value it advertises: an
// empty (or whitespace-only) draft falls back to Ctrl+Alt+D rather than
// storing "", and the status node is mounted up front so its aria-live
// announcements can fire.
test("saving an empty unlock shortcut stores the default and keeps the status region mounted", async () => {
  const profile = await createProfile();
  try {
    // Seed a non-default shortcut so the save path is observable.
    profile.database
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run("gentle_shortcut", "Ctrl+Shift+F9");

    const app = await electron.launch({
      args: [process.cwd()],
      env: { ...process.env, MLA_USER_DATA_DIR: profile.userDataDir },
    });

    try {
      const page = await app.firstWindow();
      await page.getByRole("button", { name: "Settings", exact: true }).click();

      // htmlFor/id gives the input an accessible name of its visible label.
      const shortcutInput = page.getByLabel("Shortcut key", { exact: true });
      await expect(shortcutInput).toHaveValue("Ctrl+Shift+F9");

      // The live region exists before any status is written to it.
      const status = page.locator(".gentle-save-status");
      await expect(status).toHaveAttribute("aria-live", "polite");
      await expect(status).toHaveText("");

      await shortcutInput.fill("");
      await page.getByRole("button", { name: "Save unlock shortcut" }).click();

      await expect(shortcutInput).toHaveValue("Ctrl+Alt+D");
      await expect(status).toHaveText("Saved!");
    } finally {
      await app.close();
    }

    const row = profile.database
      .prepare("SELECT value FROM settings WHERE key = 'gentle_shortcut'")
      .get() as { value: string } | undefined;
    expect(row?.value).toBe("Ctrl+Alt+D");
  } finally {
    profile.database.close();
    await fs.rm(profile.userDataDir, { recursive: true, force: true });
  }
});
