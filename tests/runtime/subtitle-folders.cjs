const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");

async function main() {
  const root = path.resolve(process.argv[2] || "installed-update");
  const profile = path.resolve("diagnostics", "subtitle-folders-" + Date.now());
  const app = await _electron.launch({
    executablePath: process.env.MLA_TEST_EXECUTABLE || require("electron"),
    args: [root],
    env: { ...process.env, MLA_USER_DATA_DIR: profile }
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 880 });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const fixture = await app.evaluate(async ({ app, dialog, ipcMain }, root) => {
      const req = process.mainModule.require("node:module").createRequire(root + "/package.json");
      const fs = req("node:fs/promises");
      const path = req("node:path");
      const profile = app.getPath("userData");
      const dir = path.join(profile, "subtitle-fixtures");
      await fs.mkdir(dir);
      const subtitle = path.join(dir, "TEST-321.en.srt");
      await fs.writeFile(subtitle, "1\n00:00:00,000 --> 00:00:01,000\nFixture\n");
      await fs.writeFile(path.join(dir, "TEST-3210.en.srt"), "unrelated");
      const db = new (req(root + "/dist/database/database.js").DatabaseClient)(path.join(profile, "mla-plus.db"));
      for (const [code, mode] of [["TEST-321", "normal"], ["TEST-322", "gentle"]]) {
        const sourcePath = path.join(profile, code + ".mp4");
        await fs.writeFile(sourcePath, "fixture");
        db.upsertMovie({ id: code, videoId: code, title: code, sourcePath, folderPath: profile, libraryMode: mode, year: 2026, resolution: "1080p", actresses: [], keywords: [], posterUrl: null, posterSource: "none" });
      }
      db.close();
      ipcMain.removeHandler("movies:ensurePosters");
      ipcMain.handle("movies:ensurePosters", () => ({ updated: 0 }));
      globalThis.cancelSubtitlePick = false;
      dialog.showOpenDialog = async (_window, options) => {
        if (options.title !== "Add subtitle directory") throw new Error("Unexpected dialog");
        return { canceled: globalThis.cancelSubtitlePick, filePaths: [dir] };
      };
      return { dir, subtitle };
    }, root);
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "+ Add Directory", exact: true }).click();
    await page.getByText(fixture.dir, { exact: true }).waitFor();
    assert.deepEqual((await page.evaluate(() => window.desktopApi.addSubtitleDir())).subtitleDirs, [fixture.dir]);
    await app.evaluate(() => { globalThis.cancelSubtitlePick = true; });
    assert.deepEqual((await page.evaluate(() => window.desktopApi.addSubtitleDir())).subtitleDirs, [fixture.dir]);
    await page.getByRole("button", { name: "Scan subtitles", exact: true }).click();
    await page.waitForFunction(async subtitle => {
      const movies = await window.desktopApi.listMovies("", 10, 0);
      return movies.find(movie => movie.id === "TEST-321")?.subtitles[0]?.path === subtitle;
    }, fixture.subtitle);
    assert.deepEqual(await page.evaluate(() => window.desktopApi.scanSubtitleDirs()), { total: 1, matched: 0, skipped: 1, unmatched: 0 });
    await page.reload();
    assert.deepEqual((await page.evaluate(() => window.desktopApi.getAppState())).subtitleDirs, [fixture.dir]);
    assert.deepEqual((await page.evaluate(dir => window.desktopApi.removeSubtitleDir(dir), fixture.dir)).subtitleDirs, []);
    assert.deepEqual(errors, []);
    console.log("Subtitle Settings passed: add, deduplicate, cancel, scan and match, persistence, remove, and Gentle lock.");
  } finally {
    await app.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
