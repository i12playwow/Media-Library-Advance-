// @vitest-environment node
import Database from "better-sqlite3";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { DatabaseClient } from "../../../database/database";
import {
  buildLibraryTargetDirectory,
  buildTargetNfoPath
} from "../../../services/libraryLayout";
import { DEFAULT_ORGANIZATION_SETTINGS } from "../../../shared/organizationTemplates";

vi.mock("../../../services/metadataService", () => ({
  resolveOnlineMovieMetadata: vi.fn(async () => null)
}));

let moveMovieToMode: typeof import("../../../services/fileService").moveMovieToMode;

beforeAll(async () => {
  ({ moveMovieToMode } = await import("../../../services/fileService"));
});

async function createTempDatabase(): Promise<{
  dir: string;
  dbPath: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mla-plus-move-"));
  return {
    dir,
    dbPath: path.join(dir, "mla-plus.db"),
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };
}

describe("moveMovieToMode integration", () => {
  it("rejects organization templates that escape the configured library root", () => {
    const root = path.join(os.tmpdir(), "mla-plus-safe-root");

    expect(() =>
      buildLibraryTargetDirectory(root, {
        libraryMode: "normal",
        title: "..",
        year: null,
        videoId: null,
        actresses: [],
        resolveLongPath: true,
        organizationSettings: {
          ...DEFAULT_ORGANIZATION_SETTINGS,
          normalPathTemplate: "{title}"
        }
      })
    ).toThrow("Generated library path must be inside the selected library root.");
  });

  it("moves the video, subtitles, and writes an NFO in the destination folder", async () => {
    const { dir, dbPath, cleanup } = await createTempDatabase();
    const client = new DatabaseClient(dbPath);

    try {
      const normalRoot = path.join(dir, "normal-root");
      const gentleRoot = path.join(dir, "gentle-root");
      const sourceDir = path.join(normalRoot, "Source Actress");
      await fs.mkdir(sourceDir, { recursive: true });
      await fs.mkdir(gentleRoot, { recursive: true });

      const sourceVideoPath = path.join(sourceDir, "Sample Movie.mp4");
      const subtitlePath = path.join(sourceDir, "Sample Movie.srt");
      await fs.writeFile(sourceVideoPath, "video");
      await fs.writeFile(subtitlePath, "1\n00:00:01,000 --> 00:00:02,000\nHello\n");

      const movieId = client.createMovieId(sourceVideoPath);
      client.setRoots({
        normal: [normalRoot],
        gentle: [gentleRoot]
      });
      client.upsertMovie({
        id: movieId,
        title: "Sample Movie",
        year: 2024,
        videoId: "SAMPLE-001",
        sourcePath: sourceVideoPath,
        folderPath: sourceDir,
        libraryMode: "normal",
        resolution: "1080p",
        posterUrl: null,
        posterSource: "none",
        actresses: ["Source Actress"],
        keywords: ["Test Tag"]
      });
      client.upsertSubtitle(movieId, subtitlePath, "en");

      const moved = await moveMovieToMode(client, movieId, "gentle");
      const refreshedMovie = client.getMovie(movieId);

      expect(moved.libraryMode).toBe("gentle");
      expect(refreshedMovie?.libraryMode).toBe("gentle");
      expect(refreshedMovie?.sourcePath).toBe(moved.sourcePath);
      await expect(fs.stat(moved.sourcePath)).resolves.toBeTruthy();
      await expect(fs.stat(moved.subtitles[0].path)).resolves.toBeTruthy();

      const nfoPath = buildTargetNfoPath(moved.folderPath, {
        libraryMode: "gentle",
        title: "Sample Movie",
        year: 2024,
        videoId: "SAMPLE-001",
        actresses: ["Source Actress"],
        modelName: null,
        resolveLongPath: true,
        organizationSettings: client.getOrganizationSettings()
      });
      const nfo = await fs.readFile(nfoPath, "utf8");
      expect(nfo).toContain("<movie>");
      expect(nfo).toContain("<title>SAMPLE-001</title>");
      expect(nfo).toContain("<id>SAMPLE-001</id>");
      expect(nfo).toContain("<source>");
    } finally {
      client.close();
      await cleanup();
    }
  });

  it("restores the video and leaves the database unchanged when a subtitle move fails", async () => {
    const { dir, dbPath, cleanup } = await createTempDatabase();
    const client = new DatabaseClient(dbPath);

    try {
      const sourceDir = path.join(dir, "source");
      const gentleRoot = path.join(dir, "gentle-root");
      await fs.mkdir(sourceDir, { recursive: true });

      const sourceVideoPath = path.join(sourceDir, "Sample Movie.mp4");
      const missingSubtitlePath = path.join(sourceDir, "missing.srt");
      await fs.writeFile(sourceVideoPath, "video");

      const movieId = client.createMovieId(sourceVideoPath);
      client.setRoots({
        normal: [sourceDir],
        gentle: [gentleRoot]
      });
      client.upsertMovie({
        id: movieId,
        title: "Sample Movie",
        year: 2024,
        videoId: "SAMPLE-001",
        sourcePath: sourceVideoPath,
        folderPath: sourceDir,
        libraryMode: "normal",
        resolution: "1080p",
        posterUrl: null,
        posterSource: "none",
        actresses: [],
        keywords: []
      });
      client.upsertSubtitle(movieId, missingSubtitlePath, "en");

      await expect(moveMovieToMode(client, movieId, "gentle")).rejects.toThrow();

      await expect(fs.readFile(sourceVideoPath, "utf8")).resolves.toBe("video");
      expect(client.getMovie(movieId)?.sourcePath).toBe(sourceVideoPath);
      expect(client.getMovie(movieId)?.libraryMode).toBe("normal");
    } finally {
      client.close();
      await cleanup();
    }
  });
});
