// @vitest-environment node
// Integration tests for the four IPC handlers that were rebuilt after being
// lost from the checkout: `subtitle:addDir`, `subtitle:removeDir`,
// `subtitle:scan` and `movies:addFiles` (registered in main.ts ahead of
// `player:getFileUrl`).
//
// main.ts cannot be imported under vitest: it pulls in Electron and registers
// every handler at module scope. Following the pattern of
// database.integration.test.ts, these tests drive the same DatabaseClient and
// libraryScanner APIs the handlers call, against a real temp-file database and
// real directories, through thin mirrors of each handler body. The mirrors
// exist only to replace the native dialog step with a plain parameter; if a
// handler changes, update its mirror in the same commit.
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DatabaseClient } from "../../../database/database";
import { extractSubtitleLanguage, registerLocalFiles } from "../../../services/libraryScanner";
import { SUBTITLE_EXTENSIONS, type SubtitleScanResult } from "../../../shared/contracts";

async function createTempDatabase(): Promise<{
  client: DatabaseClient;
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "mla-plus-handlers-"));
  const client = new DatabaseClient(path.join(dir, "mla-plus.db"));
  return {
    client,
    dir,
    cleanup: async () => {
      client.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  };
}

async function createFile(dir: string, name: string): Promise<string> {
  await fsp.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, name);
  await fsp.writeFile(filePath, "mla+ test fixture");
  return filePath;
}

function seedMovie(
  client: DatabaseClient,
  sourcePath: string,
  overrides: Partial<Omit<Parameters<DatabaseClient["upsertMovie"]>[0], "id">> = {}
): string {
  const id = client.createMovieId(sourcePath);
  client.upsertMovie({
    id,
    title: path.basename(sourcePath, path.extname(sourcePath)),
    year: null,
    videoId: null,
    sourcePath,
    folderPath: path.dirname(sourcePath),
    libraryMode: "normal",
    resolution: "Unknown",
    posterUrl: null,
    posterSource: "none",
    actresses: [],
    keywords: [],
    ...overrides
  });
  return id;
}

// Mirror of the `subtitle:addDir` handler: merge the picked directory into the
// stored set (de-duplicated) and hand back the persisted list. The real
// handler resolves `pickedDirs` from a native open dialog and returns the full
// shell state — its `subtitleDirs` field is what these assertions observe.
async function addSubtitleDir(client: DatabaseClient, pickedDirs: string[] | null): Promise<string[]> {
  if (!pickedDirs || pickedDirs.length === 0) return client.getSubtitleDirs();
  const dirs = new Set(client.getSubtitleDirs());
  dirs.add(pickedDirs[0]);
  client.setSubtitleDirs([...dirs]);
  return client.getSubtitleDirs();
}

// Mirror of the `subtitle:removeDir` handler: filter the requested directory
// out of the stored set and hand back the persisted list.
function removeSubtitleDir(client: DatabaseClient, dir: string): string[] {
  client.setSubtitleDirs(
    client.getSubtitleDirs().filter((existing) => existing !== dir)
  );
  return client.getSubtitleDirs();
}

// Mirror of the `subtitle:scan` handler: sweep every registered movie,
// skipping ones that already carry subtitles, match the rest against the
// subtitle directories by basename prefix (either direction,
// case-insensitive), and upsert the first candidate found.
async function scanSubtitleDirs(client: DatabaseClient, dirs: string[]): Promise<SubtitleScanResult> {
  const movies = client.listMovies({ includeGentle: true });
  const result: SubtitleScanResult = { total: 0, matched: 0, skipped: 0, unmatched: 0 };
  for (const movie of movies) {
    result.total++;
    if (movie.subtitles.length > 0) {
      result.skipped++;
      continue;
    }
    const candidates: Array<{ language: string; path: string }> = [];
    for (const dir of dirs) {
      let entries: string[] = [];
      try {
        entries = await fs.promises.readdir(dir);
      } catch {
        continue; // vanished or unreadable directory — nothing to match
      }
      for (const entry of entries) {
        const ext = path.extname(entry).toLowerCase();
        if (!SUBTITLE_EXTENSIONS.includes(ext as (typeof SUBTITLE_EXTENSIONS)[number])) continue;
        const videoBasename = path.basename(movie.sourcePath, path.extname(movie.sourcePath)).toLowerCase();
        const subBasename = path.basename(entry, ext).toLowerCase();
        if (!subBasename.startsWith(videoBasename) && !videoBasename.startsWith(subBasename)) continue;
        candidates.push({ path: path.join(dir, entry), language: extractSubtitleLanguage(entry) });
      }
    }
    if (candidates.length === 0) {
      result.unmatched++;
      continue;
    }
    const first = candidates[0];
    client.upsertSubtitle(movie.id, first.path, first.language);
    result.matched++;
    continue;
  }
  return result;
}

// Mirror of the `movies:addFiles` handler: register the picked files in place
// as normal-mode movies via registerLocalFiles.
async function addVideoFiles(
  client: DatabaseClient,
  pickedFiles: string[] | null
): Promise<{ added: number; skipped: number }> {
  if (!pickedFiles || pickedFiles.length === 0) return { added: 0, skipped: 0 };
  return registerLocalFiles(client, pickedFiles, "normal");
}

describe("restored subtitle + addFiles handlers", () => {
  describe("subtitle:addDir", () => {
    it("merges the picked directory into the stored set without duplicates", async () => {
      const { client, cleanup } = await createTempDatabase();
      try {
        client.setSubtitleDirs(["C:/subs/alpha"]);

        expect(await addSubtitleDir(client, ["C:/subs/beta"])).toEqual([
          "C:/subs/alpha",
          "C:/subs/beta"
        ]);
        expect(await addSubtitleDir(client, ["C:/subs/beta"])).toEqual([
          "C:/subs/alpha",
          "C:/subs/beta"
        ]);
        expect(client.getSubtitleDirs()).toEqual(["C:/subs/alpha", "C:/subs/beta"]);
      } finally {
        await cleanup();
      }
    });

    it("leaves the stored set untouched when the dialog is canceled", async () => {
      const { client, cleanup } = await createTempDatabase();
      try {
        client.setSubtitleDirs(["C:/subs/alpha"]);

        expect(await addSubtitleDir(client, [])).toEqual(["C:/subs/alpha"]);
        expect(await addSubtitleDir(client, null)).toEqual(["C:/subs/alpha"]);
        expect(client.getSubtitleDirs()).toEqual(["C:/subs/alpha"]);
      } finally {
        await cleanup();
      }
    });
  });

  describe("subtitle:removeDir", () => {
    it("removes only the requested directory", async () => {
      const { client, cleanup } = await createTempDatabase();
      try {
        client.setSubtitleDirs(["C:/subs/a", "C:/subs/b", "C:/subs/c"]);

        expect(removeSubtitleDir(client, "C:/subs/b")).toEqual(["C:/subs/a", "C:/subs/c"]);
        expect(client.getSubtitleDirs()).toEqual(["C:/subs/a", "C:/subs/c"]);
      } finally {
        await cleanup();
      }
    });

    it("ignores directories that were never registered", async () => {
      const { client, cleanup } = await createTempDatabase();
      try {
        client.setSubtitleDirs(["C:/subs/a", "C:/subs/c"]);

        expect(removeSubtitleDir(client, "C:/subs/ghost")).toEqual(["C:/subs/a", "C:/subs/c"]);
        expect(client.getSubtitleDirs()).toEqual(["C:/subs/a", "C:/subs/c"]);
      } finally {
        await cleanup();
      }
    });
  });

  describe("subtitle:scan", () => {
    it("matches a movie to one subtitle, storing language and absolute path", async () => {
      const { client, dir, cleanup } = await createTempDatabase();
      try {
        const videoDir = path.join(dir, "videos");
        const subsDir = path.join(dir, "subs");
        const videoPath = await createFile(videoDir, "beach trip (2021).mp4");
        await createFile(subsDir, "beach trip (2021).en.srt");
        await createFile(subsDir, "unrelated.srt");
        await createFile(subsDir, "notes.txt");
        const movieId = seedMovie(client, videoPath);
        client.setSubtitleDirs([subsDir]);

        const result = await scanSubtitleDirs(client, client.getSubtitleDirs());

        expect(result).toEqual({ total: 1, matched: 1, skipped: 0, unmatched: 0 });
        const subtitles = client.getMovie(movieId)?.subtitles ?? [];
        expect(subtitles).toHaveLength(1);
        expect(subtitles[0].language).toBe("EN");
        expect(subtitles[0].path).toBe(path.join(subsDir, "beach trip (2021).en.srt"));
      } finally {
        await cleanup();
      }
    });

    it("matches a short subtitle name where the video name starts with it", async () => {
      const { client, dir, cleanup } = await createTempDatabase();
      try {
        const subsDir = path.join(dir, "subs");
        const videoPath = await createFile(path.join(dir, "videos"), "IPX-787 Full Title.mp4");
        await createFile(subsDir, "IPX-787.srt");
        const movieId = seedMovie(client, videoPath);
        client.setSubtitleDirs([subsDir]);

        const result = await scanSubtitleDirs(client, client.getSubtitleDirs());

        expect(result).toEqual({ total: 1, matched: 1, skipped: 0, unmatched: 0 });
        const subtitles = client.getMovie(movieId)?.subtitles ?? [];
        expect(subtitles).toHaveLength(1);
        expect(subtitles[0].language).toBe("UND"); // "IPX-787" is not a language segment
      } finally {
        await cleanup();
      }
    });

    it("matches subtitle names case-insensitively", async () => {
      const { client, dir, cleanup } = await createTempDatabase();
      try {
        const subsDir = path.join(dir, "subs");
        const videoPath = await createFile(path.join(dir, "videos"), "Beach Trip.mp4");
        await createFile(subsDir, "beach TRIP.en.SRT");
        const movieId = seedMovie(client, videoPath);
        client.setSubtitleDirs([subsDir]);

        const result = await scanSubtitleDirs(client, client.getSubtitleDirs());

        expect(result).toEqual({ total: 1, matched: 1, skipped: 0, unmatched: 0 });
        expect(client.getMovie(movieId)?.subtitles[0]?.language).toBe("EN");
      } finally {
        await cleanup();
      }
    });

    it("skips movies that already carry a subtitle and leaves their rows alone", async () => {
      const { client, dir, cleanup } = await createTempDatabase();
      try {
        const subsDir = path.join(dir, "subs");
        const videoA = await createFile(path.join(dir, "videos"), "carried feature.mp4");
        const videoB = await createFile(path.join(dir, "videos"), "fresh one.mp4");
        await createFile(subsDir, "carried feature.en.srt"); // would match movie A
        await createFile(subsDir, "fresh one.fr.vtt");
        const movieIdA = seedMovie(client, videoA);
        const movieIdB = seedMovie(client, videoB);
        const existingRowPath = path.join(subsDir, "old-sub.srt");
        client.upsertSubtitle(movieIdA, existingRowPath, "EN");
        client.setSubtitleDirs([subsDir]);

        const result = await scanSubtitleDirs(client, client.getSubtitleDirs());

        expect(result).toEqual({ total: 2, matched: 1, skipped: 1, unmatched: 0 });
        const subtitlesA = client.getMovie(movieIdA)?.subtitles ?? [];
        expect(subtitlesA).toHaveLength(1);
        expect(subtitlesA[0].path).toBe(existingRowPath);
        expect(subtitlesA[0].language).toBe("EN");
        const subtitlesB = client.getMovie(movieIdB)?.subtitles ?? [];
        expect(subtitlesB).toHaveLength(1);
        expect(subtitlesB[0].language).toBe("FR");
      } finally {
        await cleanup();
      }
    });

    it("treats vanished subtitle directories as no candidates", async () => {
      const { client, dir, cleanup } = await createTempDatabase();
      try {
        const videoPath = await createFile(path.join(dir, "videos"), "orphan reel.mp4");
        const movieId = seedMovie(client, videoPath);
        client.setSubtitleDirs([path.join(dir, "ghost")]); // never created

        const result = await scanSubtitleDirs(client, client.getSubtitleDirs());

        expect(result).toEqual({ total: 1, matched: 0, skipped: 0, unmatched: 1 });
        expect(client.getMovie(movieId)?.subtitles).toEqual([]);
      } finally {
        await cleanup();
      }
    });

    it("sweeps gentle-mode movies alongside normal ones", async () => {
      const { client, dir, cleanup } = await createTempDatabase();
      try {
        const subsDir = path.join(dir, "subs");
        const videoPath = await createFile(path.join(dir, "videos"), "gentle flick.mp4");
        await createFile(subsDir, "gentle flick.srt");
        const movieId = seedMovie(client, videoPath, { libraryMode: "gentle" });
        client.setSubtitleDirs([subsDir]);

        const result = await scanSubtitleDirs(client, client.getSubtitleDirs());

        expect(result).toEqual({ total: 1, matched: 1, skipped: 0, unmatched: 0 });
        expect(client.getMovie(movieId)?.subtitles[0]?.language).toBe("UND");
      } finally {
        await cleanup();
      }
    });
  });

  describe("movies:addFiles", () => {
    it("registers picked video files in place as normal-mode movies", async () => {
      const { client, dir, cleanup } = await createTempDatabase();
      try {
        const videosDir = path.join(dir, "picked");
        const fileA = await createFile(videosDir, "sample one.mp4");
        const fileB = await createFile(videosDir, "sample two.mkv");

        const result = await addVideoFiles(client, [fileA, fileB]);

        expect(result).toEqual({ added: 2, skipped: 0 });
        for (const filePath of [fileA, fileB]) {
          const movieId = client.findMovieIdBySourcePath(filePath);
          expect(movieId).toBeTruthy();
          const movie = client.getMovie(movieId!);
          expect(movie?.sourcePath).toBe(filePath);
          expect(movie?.folderPath).toBe(videosDir);
          expect(movie?.libraryMode).toBe("normal");
        }
      } finally {
        await cleanup();
      }
    });

    it("skips duplicate and non-video picks, adding only new videos", async () => {
      const { client, dir, cleanup } = await createTempDatabase();
      try {
        const videosDir = path.join(dir, "picked");
        const fileA = await createFile(videosDir, "sample one.mp4");
        const notes = await createFile(videosDir, "notes.txt");
        const fileC = await createFile(videosDir, "second reel.mp4");
        await addVideoFiles(client, [fileA]);

        const result = await addVideoFiles(client, [fileA, notes, fileC]);

        expect(result).toEqual({ added: 1, skipped: 2 });
        expect(client.countMovies({ includeGentle: true })).toBe(2);
        expect(client.findMovieIdBySourcePath(fileC)).toBeTruthy();
      } finally {
        await cleanup();
      }
    });

    it("returns zeroes without touching the library when the dialog is canceled", async () => {
      const { client, cleanup } = await createTempDatabase();
      try {
        expect(await addVideoFiles(client, [])).toEqual({ added: 0, skipped: 0 });
        expect(await addVideoFiles(client, null)).toEqual({ added: 0, skipped: 0 });
        expect(client.countMovies({ includeGentle: true })).toBe(0);
      } finally {
        await cleanup();
      }
    });
  });
});
