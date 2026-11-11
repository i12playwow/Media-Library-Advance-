const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

async function main() {
  const root = path.resolve(process.argv[2] || "installed-update");
  const profile = path.resolve("diagnostics", "movie-rename-" + Date.now());
  const app = await _electron.launch({
    executablePath: process.env.MLA_TEST_EXECUTABLE || require("electron"),
    args: [root],
    env: { ...process.env, MLA_USER_DATA_DIR: profile }
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 880 });
    const fixture = await app.evaluate(async ({ app, dialog, ipcMain }, root) => {
      const req = process.mainModule.require("node:module").createRequire(root + "/package.json");
      const fs = req("node:fs/promises");
      const path = req("node:path");
      const dir = app.getPath("userData");
      const sourcePath = path.join(dir, "Example.mp4");
      const subtitlePath = path.join(dir, "Example.en.srt");
      const destination = path.join(dir, "destination");
      await fs.mkdir(destination);
      await fs.writeFile(sourcePath, "video fixture");
      await fs.writeFile(subtitlePath, "subtitle fixture");
      const { DatabaseClient } = req(root + "/dist/database/database.js");
      const db = new DatabaseClient(path.join(dir, "mla-plus.db"));
      db.upsertMovie({ id: "rename-test", title: "Example title", sourcePath, folderPath: dir, libraryMode: "normal", year: 2026, videoId: "TEST-123", resolution: "1080p", actresses: [], keywords: [], posterUrl: null, posterSource: "none" });
      db.replaceSubtitles("rename-test", [{ id: "rename-sub", path: subtitlePath, language: "en" }]);
      db.close();
      ipcMain.removeHandler("movies:ensurePosters");
      ipcMain.handle("movies:ensurePosters", () => ({ updated: 0 }));
      const realFetch = globalThis.fetch;
      globalThis.fetch = async (url, options) => {
        if (String(url) !== "https://www.javdatabase.com/movies/test-123/") return realFetch(url, options);
        return new Response("<title>" + globalThis.javPageTitle + "</title>");
      };
      globalThis.javPageTitle = "TEST-123 - Example: A &amp; B - JAV Database";
      dialog.showSaveDialog = async (_window, options) => {
        globalThis.lastRenameDialog = options;
        return globalThis.renameChoice === "auto" ? { filePath: options.defaultPath } : globalThis.renameChoice;
      };
      return { sourcePath, subtitlePath, destination };
    }, root);
    const choose = target => app.evaluate((_, target) => {
      globalThis.renameChoice = target === "auto" ? target : target ? { canceled: false, filePath: target } : { canceled: true };
    }, target);
    const rename = action => page.evaluate(action => window.desktopApi.renameMovieFile("rename-test", action), action);
    const movie = () => page.evaluate(async () => (await window.desktopApi.listMovies("", 10, 0))[0]);
    const menu = async name => {
      await page.locator('[data-movie-id="rename-test"]').click({ button: "right" });
      await page.getByRole("button", { name, exact: true }).click();
    };
    await page.reload();
    await page.getByRole("button", { name: "Library", exact: true }).click();

    await choose(null);
    assert.deepEqual(await rename("rename"), { changed: false });
    const occupied = path.join(profile, "Occupied.mp4");
    await fs.writeFile(occupied, "existing video");
    await choose(occupied);
    await assert.rejects(rename("rename"), /already exists/);
    assert.equal(await fs.readFile(occupied, "utf8"), "existing video");
    await choose(path.join(profile, "Invalid.mkv"));
    await assert.rejects(rename("rename"), /Keep the .mp4 extension/);
    await choose(path.join(fixture.destination, "Wrong-folder.mp4"));
    await assert.rejects(rename("rename"), /current folder/);

    const renamed = path.join(profile, "Renamed.mp4");
    await choose(renamed);
    await menu("Rename video file…");
    await page.waitForFunction(async expected => (await window.desktopApi.listMovies("", 10, 0))[0]?.sourcePath === expected, renamed);
    await assert.rejects(fs.access(fixture.sourcePath), { code: "ENOENT" });
    assert.equal(await fs.readFile(renamed, "utf8"), "video fixture");

    const moved = path.join(fixture.destination, "Moved and renamed.mp4");
    await choose(moved);
    await menu("Rename and move video…");
    await page.waitForFunction(async expected => (await window.desktopApi.listMovies("", 10, 0))[0]?.sourcePath === expected, moved);
    const updated = await movie();
    assert.equal(updated.title, "Example title");
    assert.equal(updated.libraryMode, "normal");
    assert.equal(updated.subtitles[0].path, fixture.subtitlePath);
    assert.equal(await fs.readFile(fixture.subtitlePath, "utf8"), "subtitle fixture");
    assert.equal(await fs.readFile(moved, "utf8"), "video fixture");
    await assert.rejects(fs.access(renamed), { code: "ENOENT" });
    await choose(null);
    assert.deepEqual(await rename("javdatabase"), { changed: false });
    assert.equal((await app.evaluate(() => globalThis.lastRenameDialog)).defaultPath,
      path.join(fixture.destination, "TEST-123 - Example A & B.mp4"));
    await app.evaluate(() => { globalThis.javPageTitle = "OTHER-999 - Different movie - JAV Database"; });
    await assert.rejects(rename("javdatabase"), /did not return a matching title/);
    assert.equal((await movie()).sourcePath, moved);
    await app.evaluate(() => { globalThis.javPageTitle = "TEST-123 - Example: A &amp; B - JAV Database"; });
    await choose("auto");
    await menu("Auto-rename from JAVDatabase…");
    const automatic = path.join(fixture.destination, "TEST-123 - Example A & B.mp4");
    await page.waitForFunction(async expected => (await window.desktopApi.listMovies("", 10, 0))[0]?.sourcePath === expected, automatic);
    assert.equal(await fs.readFile(automatic, "utf8"), "video fixture");
    console.log("JAVDatabase preview, cancellation, mismatched code rejection, and automatic rename passed.");
    console.log("Both rename actions passed with cancellation, extension checks, collision protection, and catalog relinking.");
  } finally {
    await app.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
