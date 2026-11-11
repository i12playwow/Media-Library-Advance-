// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveDuplicateGroup } from "../../../services/duplicateResolution";

type LibraryMode = "normal" | "gentle";

interface FakeMovie {
  id: string;
  sourcePath: string;
  libraryMode: LibraryMode;
}

function createDatabase(
  movies: FakeMovie[],
  roots: { normal: string[]; gentle: string[] }
) {
  const byId = new Map(movies.map((movie) => [movie.id, movie]));
  const idByPath = new Map(movies.map((movie) => [movie.sourcePath, movie.id]));
  return {
    findMovieIdBySourcePath: (sourcePath: string) => idByPath.get(sourcePath) ?? null,
    getMovie: (id: string) => byId.get(id) ?? null,
    deleteMovie: (id: string) => {
      const movie = byId.get(id);
      if (movie) idByPath.delete(movie.sourcePath);
      byId.delete(id);
    },
    getRoots: () => roots,
    getOrganizationSettings: () => ({ normalLibraryPath: "", gentleLibraryPath: "" })
  };
}

let tempRoot: string;
let libraryRoot: string;
let gentleRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mla-plus-duplicates-"));
  libraryRoot = path.join(tempRoot, "library");
  gentleRoot = path.join(tempRoot, "gentle");
  await fs.mkdir(libraryRoot, { recursive: true });
  await fs.mkdir(gentleRoot, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tempRoot, { recursive: true, force: true });
});

async function writeVideo(folder: string, name: string): Promise<string> {
  const fullPath = path.join(folder, name);
  await fs.writeFile(fullPath, "synthetic video");
  return fullPath;
}

async function exists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false
  );
}

const roots = () => ({ normal: [libraryRoot], gentle: [gentleRoot] });

describe("duplicate resolution", () => {
  it("never deletes the kept copy, even when it is listed as a deletion", async () => {
    const keep = await writeVideo(libraryRoot, "ABCD-001.mp4");
    const copy = await writeVideo(libraryRoot, "ABCD-001 copy.mp4");
    const database = createDatabase([], roots());

    const result = await resolveDuplicateGroup({
      database,
      keepPath: keep,
      deletePaths: [keep, copy],
      isGentleUnlocked: () => false
    });

    expect(await exists(keep)).toBe(true);
    expect(await exists(copy)).toBe(false);
    expect(result.deleted).toBe(1);
    expect(result.blocked).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toMatch(/kept copy is never deleted/i);
  });

  it("refuses a path outside the configured library folders", async () => {
    const keep = await writeVideo(libraryRoot, "ABCD-001.mp4");
    const unrelated = await writeVideo(tempRoot, "ABCD-001.mp4");
    const database = createDatabase([], roots());

    const result = await resolveDuplicateGroup({
      database,
      keepPath: keep,
      deletePaths: [unrelated],
      isGentleUnlocked: () => false
    });

    expect(await exists(unrelated)).toBe(true);
    expect(result.deleted).toBe(0);
    expect(result.failed[0].error).toMatch(/outside the configured library folders/i);
  });

  it("refuses a non-video file and a different title inside the library", async () => {
    const keep = await writeVideo(libraryRoot, "ABCD-001.mp4");
    const notes = path.join(libraryRoot, "notes.txt");
    await fs.writeFile(notes, "not a video");
    const otherTitle = await writeVideo(libraryRoot, "WXYZ-999.mp4");
    const database = createDatabase([], roots());

    const result = await resolveDuplicateGroup({
      database,
      keepPath: keep,
      deletePaths: [notes, otherTitle],
      isGentleUnlocked: () => false
    });

    expect(await exists(notes)).toBe(true);
    expect(await exists(otherTitle)).toBe(true);
    expect(result.deleted).toBe(0);
    expect(result.failed.map((entry) => entry.error).join(" ")).toMatch(
      /supported video files|not a duplicate/i
    );
  });

  it("blocks a catalogued Gentle duplicate while locked and deletes it when unlocked", async () => {
    const keep = await writeVideo(libraryRoot, "ABCD-001.mp4");
    const gentleCopy = await writeVideo(gentleRoot, "ABCD-001.mp4");
    const movies: FakeMovie[] = [
      { id: "gentle-copy", sourcePath: gentleCopy, libraryMode: "gentle" }
    ];
    const database = createDatabase(movies, roots());

    const locked = await resolveDuplicateGroup({
      database,
      keepPath: keep,
      deletePaths: [gentleCopy],
      isGentleUnlocked: () => false
    });

    expect(locked.blocked).toBe(1);
    expect(locked.deleted).toBe(0);
    expect(await exists(gentleCopy)).toBe(true);
    expect(database.getMovie("gentle-copy")).not.toBeNull();

    const unlocked = await resolveDuplicateGroup({
      database,
      keepPath: keep,
      deletePaths: [gentleCopy],
      isGentleUnlocked: () => true
    });

    expect(unlocked.deleted).toBe(1);
    expect(await exists(gentleCopy)).toBe(false);
    expect(database.getMovie("gentle-copy")).toBeNull();
  });

  it("blocks an uncatalogued file discovered in a Gentle root while locked", async () => {
    const keep = await writeVideo(libraryRoot, "ABCD-001.mp4");
    const gentleCopy = await writeVideo(gentleRoot, "ABCD-001.mp4");
    const database = createDatabase([], roots());

    const result = await resolveDuplicateGroup({
      database,
      keepPath: keep,
      deletePaths: [gentleCopy],
      isGentleUnlocked: () => false
    });

    expect(result.blocked).toBe(1);
    expect(result.deleted).toBe(0);
    expect(await exists(gentleCopy)).toBe(true);
  });

  it("counts only successful deletions and reports the failure", async () => {
    const keep = await writeVideo(libraryRoot, "ABCD-001.mp4");
    const first = await writeVideo(libraryRoot, "ABCD-001-a.mp4");
    const second = await writeVideo(libraryRoot, "ABCD-001-b.mp4");
    const database = createDatabase(
      [{ id: "second", sourcePath: second, libraryMode: "normal" }],
      roots()
    );

    const result = await resolveDuplicateGroup({
      database,
      keepPath: keep,
      deletePaths: [first, second],
      isGentleUnlocked: () => false,
      removeFile: async (target) => {
        if (target === second) throw new Error("The file is in use.");
        await fs.unlink(target);
      }
    });

    expect(result.deleted).toBe(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toBe("The file is in use.");
    expect(await exists(first)).toBe(false);
    expect(await exists(second)).toBe(true);
    // A failed unlink must not remove the library record.
    expect(database.getMovie("second")).not.toBeNull();
  });

  it("ignores repeated deletion paths", async () => {
    const keep = await writeVideo(libraryRoot, "ABCD-001.mp4");
    const copy = await writeVideo(libraryRoot, "ABCD-001 copy.mp4");
    const database = createDatabase([], roots());

    const result = await resolveDuplicateGroup({
      database,
      keepPath: keep,
      deletePaths: [copy, copy],
      isGentleUnlocked: () => false
    });

    expect(result.deleted).toBe(1);
    expect(result.failed).toHaveLength(0);
    expect(await exists(copy)).toBe(false);
  });
});
