const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");

async function main() {
  const root = path.resolve(process.argv[2] || "installed-update");
  const profile = path.resolve("diagnostics", "library-move-" + Date.now());
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
      const profile = app.getPath("userData");
      const { DatabaseClient } = req(root + "/dist/database/database.js");
      const db = new DatabaseClient(path.join(profile, "mla-plus.db"));
      const normal = path.join(profile, "normal");
      const gentle = path.join(profile, "gentle");
      await Promise.all([fs.mkdir(normal, { recursive: true }), fs.mkdir(gentle, { recursive: true })]);
      db.setOrganizationSettings({ ...db.getOrganizationSettings(), normalLibraryPath: normal, gentleLibraryPath: gentle });
      const paths = {};
      for (const id of ["one", "two", "rollback"]) {
        const folder = path.join(profile, "fixtures", id);
        await fs.mkdir(folder, { recursive: true });
        const sourcePath = path.join(folder, id + ".mp4");
        await fs.writeFile(sourcePath, "synthetic video " + id);
        const subtitle = path.join(folder, id + ".srt");
        if (id !== "rollback") await fs.writeFile(subtitle, "synthetic subtitle " + id);
        db.upsertMovie({ id, title: id, year: 2026, videoId: null, resolution: "1080p", sourcePath, folderPath: folder, libraryMode: "normal", actresses: [], keywords: [], posterUrl: null, posterSource: "none" });
        db.replaceSubtitles(id, [{ id: id + "-sub", movieId: id, path: subtitle, language: "en", label: "English", source: "local" }]);
        paths[id] = { sourcePath, subtitle };
      }
      db.close();
      ipcMain.removeHandler("movies:ensurePosters");
      ipcMain.handle("movies:ensurePosters", () => ({ updated: 0 }));
      globalThis.moveChoice = 0;
      globalThis.movePrompts = [];
      dialog.showMessageBox = async (_window, options) => {
        globalThis.movePrompts.push(options);
        return { response: globalThis.moveChoice };
      };
      return { paths, normal, gentle };
    }, root);

    const choose = choice => app.evaluate((_, choice) => { globalThis.moveChoice = choice; }, choice);
    const batch = (ids, mode) => page.evaluate(({ ids, mode }) => window.desktopApi.moveMovies(ids, mode), { ids, mode });
    const inspect = id => app.evaluate(async (_, { root, profile, id }) => {
      const req = process.mainModule.require("node:module").createRequire(root + "/package.json");
      const db = new (req(root + "/dist/database/database.js").DatabaseClient)(req("node:path").join(profile, "mla-plus.db"));
      const movie = db.getMovie(id);
      db.close();
      return movie;
    }, { root, profile, id });
    const fs = require("node:fs/promises");
    await page.reload();
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await assert.rejects(batch(["one"], "gentle"), /Unlock Gentle/);
    assert.equal((await page.evaluate(() => window.desktopApi.verifyGentlePin("2468"))).ok, true);
    await page.locator('[data-movie-id="one"]').click({ button: "right" });
    await page.getByRole("button", { name: /Move to Gentle Mode/ }).click();
    await page.locator('[data-movie-id="one"]').waitFor({ state: "hidden" });
    const one = await inspect("one");
    assert.equal(one.libraryMode, "gentle");
    assert.equal(one.sourcePath, fixture.paths.one.sourcePath);
    assert.equal(one.subtitles[0].path, fixture.paths.one.subtitle);
    await fs.access(one.sourcePath);

    await choose(2);
    assert.equal((await batch(["two"], "gentle")).cancelled, true);
    assert.equal((await inspect("two")).libraryMode, "normal");
    await choose(1);
    const bulk = await batch(["one", "rollback", "two", "two"], "gentle");
    assert.deepEqual(bulk.moved, ["two"]);
    assert.equal(bulk.skipped, 1);
    assert.equal(bulk.failed[0].id, "rollback");
    const two = await inspect("two");
    assert.equal(two.libraryMode, "gentle");
    assert.ok(two.sourcePath.startsWith(fixture.gentle + path.sep));
    assert.equal(await fs.readFile(two.sourcePath, "utf8"), "synthetic video two");
    assert.equal(await fs.readFile(two.subtitles[0].path, "utf8"), "synthetic subtitle two");
    await assert.rejects(fs.access(fixture.paths.two.sourcePath), { code: "ENOENT" });
    assert.equal((await inspect("rollback")).libraryMode, "normal");
    assert.equal(await fs.readFile(fixture.paths.rollback.sourcePath, "utf8"), "synthetic video rollback");

    await choose(0);
    const back = await batch(["one", "two"], "normal");
    assert.deepEqual(back.moved, ["one", "two"]);
    assert.equal((await inspect("two")).sourcePath, two.sourcePath);
    const prompts = await app.evaluate(() => globalThis.movePrompts);
    assert.deepEqual(prompts[0].buttons, ["Keep files in place", "Move files on disk", "Cancel"]);
    assert.equal(prompts[0].defaultId, 0);
    console.log("Passed single move, both bulk choices, cancel, Gentle lock, duplicate selection, and partial failure rollback.");
  } finally {
    await app.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
