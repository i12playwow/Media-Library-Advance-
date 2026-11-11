import { lstat as defaultLstat, unlink as defaultUnlink } from "node:fs/promises";
import * as path from "node:path";
import { VIDEO_EXTENSIONS } from "../shared/contracts";
import { extractVideoId } from "../shared/videoId";

const MAX_DELETE_PATHS = 1000;
const MAX_PATH_LENGTH = 4096;

export interface DuplicateResolutionFailure {
  path: string;
  error: string;
}

export interface DuplicateResolutionResult {
  deleted: number;
  blocked: number;
  failed: DuplicateResolutionFailure[];
}

interface DuplicateResolutionMovie {
  libraryMode: "normal" | "gentle";
  sourcePath: string;
}

interface DuplicateResolutionDatabase {
  findMovieIdBySourcePath(sourcePath: string): string | null;
  getMovie(id: string): DuplicateResolutionMovie | null;
  deleteMovie(id: string): void;
  getRoots(): { normal: string[]; gentle: string[] };
  getOrganizationSettings?(): { normalLibraryPath: string; gentleLibraryPath: string };
}

export interface DuplicateResolutionOptions {
  database: DuplicateResolutionDatabase;
  keepPath: string;
  deletePaths: string[];
  /**
   * Main-process Gentle state. The renderer never supplies this: a deleted
   * duplicate must never be authorised by a flag the renderer itself chose.
   */
  isGentleUnlocked: () => boolean;
  /** Injectable for tests; production passes the real filesystem calls. */
  lstat?: typeof defaultLstat;
  removeFile?: typeof defaultUnlink;
}

function comparisonKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isInsideRoot(root: string, candidate: string): boolean {
  const rootKey = comparisonKey(root);
  const candidateKey = comparisonKey(candidate);
  const relative = path.relative(rootKey, candidateKey);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function configuredRoots(database: DuplicateResolutionDatabase): {
  normal: string[];
  gentle: string[];
} {
  const roots = database.getRoots();
  const organization = database.getOrganizationSettings?.();
  const clean = (values: Array<string | undefined>): string[] =>
    values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  return {
    normal: clean([...(roots.normal ?? []), organization?.normalLibraryPath]),
    gentle: clean([...(roots.gentle ?? []), organization?.gentleLibraryPath])
  };
}

function videoIdOf(filePath: string): string | null {
  return extractVideoId(path.basename(filePath, path.extname(filePath)));
}

/**
 * Deletes the duplicate copies the user chose to discard, keeping `keepPath`.
 *
 * Every candidate is validated before anything is unlinked:
 *  - the kept copy is never deleted, even if the renderer lists it;
 *  - only regular, non-symlinked, supported video files are touched;
 *  - a candidate must be catalogued in the library or live under a configured
 *    library root, so an arbitrary path cannot be named;
 *  - when both filenames carry a video ID, the IDs must match, so a different
 *    title cannot be passed off as a duplicate;
 *  - Gentle copies are blocked by the main process's lock, using the movie's
 *    stored mode (which survives a temporarily offline disk) or, for
 *    uncatalogued files, the Gentle roots.
 *
 * Deletions are counted only after the unlink resolves; per-path failures are
 * reported instead of being swallowed, so the caller can tell the user that a
 * file was not removed.
 */
export async function resolveDuplicateGroup({
  database,
  keepPath,
  deletePaths,
  isGentleUnlocked,
  lstat = defaultLstat,
  removeFile = defaultUnlink
}: DuplicateResolutionOptions): Promise<DuplicateResolutionResult> {
  if (typeof keepPath !== "string" || keepPath.trim().length === 0) {
    throw new Error("Choose which duplicate to keep.");
  }
  if (!Array.isArray(deletePaths)) {
    throw new Error("Choose the duplicate files to delete.");
  }
  if (deletePaths.length > MAX_DELETE_PATHS) {
    throw new Error("Too many duplicate files in one request.");
  }

  const keepKey = comparisonKey(keepPath);
  const keepVideoId = videoIdOf(keepPath);
  const roots = configuredRoots(database);
  const result: DuplicateResolutionResult = { deleted: 0, blocked: 0, failed: [] };
  const seen = new Set<string>();

  for (const candidate of deletePaths) {
    if (typeof candidate !== "string" || candidate.trim().length === 0 || candidate.length > MAX_PATH_LENGTH) {
      result.failed.push({ path: typeof candidate === "string" ? candidate : "", error: "Invalid file path." });
      continue;
    }

    const key = comparisonKey(candidate);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    // Defence in depth: never unlink the copy the user chose to keep, even if
    // the renderer mistakenly (or maliciously) includes it in deletePaths.
    if (key === keepKey) {
      result.failed.push({ path: candidate, error: "The kept copy is never deleted." });
      continue;
    }

    try {
      const info = await lstat(candidate);
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new Error("Only regular video files can be deleted.");
      }
      if (!VIDEO_EXTENSIONS.includes(path.extname(candidate).toLowerCase())) {
        throw new Error("Only supported video files can be deleted.");
      }

      const movieId =
        database.findMovieIdBySourcePath(candidate) ??
        database.findMovieIdBySourcePath(path.resolve(candidate));
      const movie = movieId ? database.getMovie(movieId) : null;

      if (movie) {
        if (movie.libraryMode === "gentle" && !isGentleUnlocked()) {
          result.blocked += 1;
          continue;
        }
      } else {
        if (roots.gentle.some((root) => isInsideRoot(root, candidate)) && !isGentleUnlocked()) {
          result.blocked += 1;
          continue;
        }
        if (![...roots.normal, ...roots.gentle].some((root) => isInsideRoot(root, candidate))) {
          throw new Error("This file is outside the configured library folders.");
        }
      }

      const candidateVideoId = videoIdOf(candidate);
      if (keepVideoId && candidateVideoId && keepVideoId !== candidateVideoId) {
        throw new Error("This file is not a duplicate of the kept copy.");
      }

      await removeFile(candidate);
      result.deleted += 1;

      if (movieId) {
        try {
          database.deleteMovie(movieId);
        } catch {
          // The file is gone, so the deletion is real. A stale row is hidden
          // by the library's missing-file filter and can be cleaned up later.
        }
      }
    } catch (error) {
      result.failed.push({
        path: candidate,
        error: error instanceof Error ? error.message : "The file could not be deleted."
      });
    }
  }

  return result;
}
