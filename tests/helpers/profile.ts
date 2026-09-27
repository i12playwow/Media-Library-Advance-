import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";

// Shared e2e helpers: a throwaway app profile (temp userData dir with a
// pre-seeded SQLite database and media files) and the gentle-mode toggle.
//
// The schema here intentionally matches DatabaseClient.migrate()'s
// CREATE TABLE IF NOT EXISTS statements, so the app opens this database
// without a migration clash and only adds its indexes/defaults.

export async function toggleGentle(page: Page): Promise<void> {
  // The gentle toggle lives on the configured in-app shortcut (default
  // Ctrl+Alt+D — see AppTopBar's hint and useKeyboardShortcuts' handler).
  await page.keyboard.press("Control+Alt+KeyD");
}

export async function createProfile() {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), "mla-plus-e2e-"));
  const mediaDir = path.join(userDataDir, "media");
  const normalRoot = path.join(mediaDir, "normal");
  const gentleRoot = path.join(mediaDir, "gentle");
  await fs.mkdir(normalRoot, { recursive: true });
  await fs.mkdir(gentleRoot, { recursive: true });

  const subtitleFixture = await fs.readFile(path.join(process.cwd(), "tests", "sample.srt"), "utf8");

  const dbPath = path.join(userDataDir, "mla-plus.db");
  const database = new DatabaseSync(dbPath);

  try {
    const alphaPath = path.join(normalRoot, "Alpha Feature.mp4");
    const zetaPath = path.join(normalRoot, "Zeta Feature.mp4");
    const gentlePath = path.join(gentleRoot, "Gentle Feature.mp4");
    const zetaSubtitlePath = path.join(normalRoot, "Zeta Feature.srt");

    await fs.writeFile(alphaPath, "alpha");
    await fs.writeFile(zetaPath, "zeta");
    await fs.writeFile(gentlePath, "gentle");
    await fs.writeFile(zetaSubtitlePath, subtitleFixture);

    database.exec(`
      CREATE TABLE IF NOT EXISTS movies (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        year INTEGER,
        video_id TEXT,
        source_path TEXT NOT NULL UNIQUE,
        folder_path TEXT NOT NULL,
        library_mode TEXT NOT NULL,
        resolution TEXT NOT NULL DEFAULT 'Unknown',
        poster_url TEXT,
        poster_source TEXT NOT NULL DEFAULT 'none',
        actresses_json TEXT NOT NULL DEFAULT '[]',
        keywords_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS subtitles (
        id TEXT PRIMARY KEY,
        movie_id TEXT NOT NULL,
        language TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const now = new Date().toISOString();
    const insertSetting = database.prepare(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
    );
    insertSetting.run("library_roots", JSON.stringify({ normal: [normalRoot], gentle: [gentleRoot] }));
    insertSetting.run("gentle_shortcut", "Ctrl+Alt+D");
    insertSetting.run("gentle_pin_hash", "not-used-in-this-test");
    insertSetting.run("theme_mode", "dark");
    insertSetting.run(
      "metadata_settings",
      JSON.stringify({
        tmdbReadAccessToken: "",
        language: "en-US",
        region: "US",
        autoFetchWebPosters: true,
        tmdbNonCommercialUse: false,
        sourceProfile: "auto"
      })
    );
    insertSetting.run(
      "organization_settings",
      JSON.stringify({
        normalPathTemplate: "{title} ({year})",
        gentlePathTemplate: "{studio}/{actress}/{dvdId}",
        fileNameTemplate: "{dvdId}",
        normalLibraryPath: "",
        gentleLibraryPath: ""
      })
    );

    const insertMovie = database.prepare(`
      INSERT INTO movies (
        id, title, year, video_id, source_path, folder_path, library_mode,
        resolution, poster_url, poster_source, actresses_json, keywords_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertMovie.run(
      "alpha-id",
      "Alpha Feature",
      2022,
      "AAA-001",
      alphaPath,
      normalRoot,
      "normal",
      "1080p",
      null,
      "none",
      JSON.stringify(["Alpha Actress"]),
      JSON.stringify(["AAA"]),
      now
    );
    insertMovie.run(
      "zeta-id",
      "Zeta Feature",
      2024,
      "ZZZ-001",
      zetaPath,
      normalRoot,
      "normal",
      "4K",
      null,
      "none",
      JSON.stringify(["Zeta Actress"]),
      JSON.stringify(["ZZZ"]),
      now
    );
    insertMovie.run(
      "gentle-id",
      "Gentle Feature",
      2023,
      "GENTLE-001",
      gentlePath,
      gentleRoot,
      "gentle",
      "720p",
      null,
      "none",
      JSON.stringify(["Gentle Actress"]),
      JSON.stringify(["Gentle"]),
      now
    );

    const insertSubtitle = database.prepare(
      "INSERT INTO subtitles (id, movie_id, language, path) VALUES (?, ?, ?, ?)"
    );
    insertSubtitle.run("zeta-subtitle", "zeta-id", "en", zetaSubtitlePath);

    return { userDataDir, database };
  } catch (error) {
    database.close();
    await fs.rm(userDataDir, { recursive: true, force: true });
    throw error;
  }
}
