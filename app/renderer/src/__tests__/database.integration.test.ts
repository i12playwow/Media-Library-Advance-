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
});
