// @vitest-environment node
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DatabaseClient } from "../../../database/database";
import { scanLibraries } from "../../../services/libraryScanner";
import malformedRootsFixture from "../../../../tests/fixtures/malformed-library-roots.json";

async function createTempDatabase(): Promise<{
  dbPath: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mla-plus-db-"));
  return {
    dbPath: path.join(dir, "mla-plus.db"),
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };
}

describe("DatabaseClient integration", () => {
  it("normalizes malformed stored roots and keeps scans stable", async () => {
    const { dbPath, cleanup } = await createTempDatabase();
    const client = new DatabaseClient(dbPath);
    const raw = new Database(dbPath);

    try {
      raw.prepare(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
      ).run("library_roots", JSON.stringify(malformedRootsFixture));

      expect(client.getRoots()).toEqual({
        normal: ["C:/broken/normal"],
        gentle: ["C:/broken/gentle"]
      });

      const summary = await scanLibraries(client);
      expect(summary.cancelled).toBe(false);
      expect(summary.scannedRoots).toEqual({
        normal: ["C:/broken/normal"],
        gentle: ["C:/broken/gentle"]
      });
    } finally {
      raw.close();
      client.close();
      await cleanup();
    }
  });

  it("persists settings, PIN checks, and subtitle directories", async () => {
    const { dbPath, cleanup } = await createTempDatabase();
    const client = new DatabaseClient(dbPath);

    try {
      client.setThemeMode("light");
      client.setSubtitleDirs(["C:/subs/a", "C:/subs/a", "C:/subs/b"]);
      client.setPlayerSettings({
        defaultVolume: 0.5,
        subtitleFontSize: 28,
        subtitleColor: "#ffeeaa",
        autoPlayNext: true,
        rememberPosition: false,
        videoFilterPreset: "mono",
        videoFilterStrength: 75
      });
      client.setMetadataSettings({
        tmdbReadAccessToken: "token",
        language: "ja-JP",
        region: "JP",
        autoFetchWebPosters: false,
        tmdbNonCommercialUse: true,
        sourceProfile: "mainstream-first"
      });
      client.setActressRegion("Actress A", "Japan");

      expect(client.getThemeMode()).toBe("light");
      expect(client.getSubtitleDirs()).toEqual(["C:/subs/a", "C:/subs/b"]);
      expect(client.getPlayerSettings()).toMatchObject({
        defaultVolume: 0.5,
        subtitleFontSize: 28,
        subtitleColor: "#ffeeaa",
        autoPlayNext: true,
        rememberPosition: false,
        videoFilterPreset: "mono",
        videoFilterStrength: 75
      });
      expect(client.getMetadataSettings()).toMatchObject({
        tmdbReadAccessToken: "token",
        language: "ja-JP",
        region: "JP",
        autoFetchWebPosters: false,
        tmdbNonCommercialUse: true,
        sourceProfile: "mainstream-first"
      });
      expect(client.getActressRegion("Actress A")).toBe("Japan");
      expect(client.getActressRegions()).toEqual({ "Actress A": "Japan" });
      expect(client.verifyGentlePin("2468")).toBe(true);
      expect(client.verifyGentlePin("0000")).toBe(false);
    } finally {
      client.close();
      await cleanup();
    }
  });

  it("countMoviesByMode reports the whole total/normal/gentle split in one scan", async () => {
    const { dbPath, cleanup } = await createTempDatabase();
    const client = new DatabaseClient(dbPath);
    const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), "mla-plus-modecounts-"));

    const seed = (fileName: string, libraryMode: "normal" | "gentle"): void => {
      const sourcePath = path.join(mediaDir, fileName);
      client.upsertMovie({
        id: client.createMovieId(sourcePath),
        title: path.basename(sourcePath, path.extname(sourcePath)),
        year: null,
        videoId: null,
        sourcePath,
        folderPath: mediaDir,
        libraryMode,
        resolution: "Unknown",
        posterUrl: null,
        posterSource: "none",
        actresses: [],
        keywords: [],
      });
    };

    try {
      await fs.writeFile(path.join(mediaDir, "normal-one.mp4"), "x");
      await fs.writeFile(path.join(mediaDir, "normal-two.mp4"), "x");
      await fs.writeFile(path.join(mediaDir, "gentle-one.mp4"), "x");
      seed("normal-one.mp4", "normal");
      seed("normal-two.mp4", "normal");
      seed("gentle-one.mp4", "gentle");
      seed("vanished.mp4", "normal"); // row without its file — never counted

      // Gentle locked: normal-only, matching countMovies for the same options.
      expect(client.countMoviesByMode({ includeGentle: false })).toEqual({
        total: 2,
        normal: 2,
        gentle: 0,
      });

      // Gentle unlocked: the split adds up and the total equals countMovies.
      const unlocked = client.countMoviesByMode({ includeGentle: true });
      expect(unlocked).toEqual({ total: 3, normal: 2, gentle: 1 });
      expect(unlocked.total).toBe(client.countMovies({ includeGentle: true }));

      // The search clause filters the split the same way it filters counts.
      expect(client.countMoviesByMode({ includeGentle: true, query: "gentle-one" })).toEqual({
        total: 1,
        normal: 0,
        gentle: 1,
      });
    } finally {
      client.close();
      await cleanup();
      await fs.rm(mediaDir, { recursive: true, force: true });
    }
  });

  it("scan with moveRename: false imports video + matched subtitle fully in place", async () => {
    const { dbPath, cleanup } = await createTempDatabase();
    const client = new DatabaseClient(dbPath);
    const mediaDir = await fs.mkdtemp(path.join(os.tmpdir(), "mla-plus-inplace-"));
    const videoPath = path.join(mediaDir, "Sample Movie.mp4");
    const subtitlePath = path.join(mediaDir, "Sample Movie.srt");

    try {
      await fs.writeFile(videoPath, "not-a-real-video");
      await fs.writeFile(subtitlePath, "1\n00:00:01,000 --> 00:00:02,000\nHi\n");

      // Keep the scan offline: no TMDB token, no web posters, local-only profile.
      client.setMetadataSettings({
        tmdbReadAccessToken: "",
        language: "en-US",
        region: "US",
        autoFetchWebPosters: false,
        tmdbNonCommercialUse: false,
        sourceProfile: "local-only"
      });

      const summary = await scanLibraries(
        client,
        { normal: [mediaDir], gentle: [] },
        {
          mode: "normal",
          scanOptions: {
            moveRename: false,
            importOnlyCompleteVideos: false,
            autoDownloadSubtitleFromSubtitleCat: false
          }
        }
      );

      expect(summary.cancelled).toBe(false);
      expect(summary.imported).toBe(1);
      expect(summary.errors).toEqual([]);

      // Nothing moved, renamed, or written into the source folder: no .nfo,
      // no template-named copy, no poster sidecar.
      const filesAfter = await fs.readdir(mediaDir);
      expect([...filesAfter].sort()).toEqual(["Sample Movie.mp4", "Sample Movie.srt"]);

      const movies = client.listMovies({ includeGentle: true, query: "" });
      expect(movies).toHaveLength(1);
      expect(movies[0].sourcePath).toBe(videoPath);
      expect(movies[0].folderPath).toBe(mediaDir);

      // The matched subtitle was registered at its original path.
      expect(movies[0].subtitles.map((subtitle) => subtitle.path)).toEqual([
        subtitlePath
      ]);
    } finally {
      client.close();
      await cleanup();
      await fs.rm(mediaDir, { recursive: true, force: true });
    }
  });
});
