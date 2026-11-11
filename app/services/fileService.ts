import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseClient } from "../database/database";
import {
  assertPathWithinRoot,
  buildTargetNfoPath,
  buildTargetSubtitlePath,
  buildTargetVideoPath,
  ensureLibraryTargetDirectory,
  writeMovieNfo
} from "./libraryLayout";
import type {
  LibraryMode,
  MovieRecord,
  SubtitleRecord
} from "../shared/contracts";
import { extractVideoId } from "../shared/videoId";

function normalizeRootList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return typeof value === "string" && value.trim() ? [value.trim()] : [];
  }

  return value.filter((root): root is string => typeof root === "string" && root.trim().length > 0);
}

export async function moveMovieToMode(
  database: DatabaseClient,
  movieId: string,
  targetMode: LibraryMode
): Promise<MovieRecord> {
  const movie = database.getMovie(movieId);
  if (!movie) {
    throw new Error("Movie not found.");
  }

  const roots = database.getRoots();
  const organizationSettings = database.getOrganizationSettings();
  const storageFolder = targetMode === "gentle" ? organizationSettings.gentleLibraryPath : organizationSettings.normalLibraryPath;
  const targetRoot = storageFolder?.trim() || normalizeRootList(roots[targetMode])[0];
  if (!targetRoot) {
    throw new Error(
      `Choose a storage folder for the ${targetMode} library in Settings before moving files.`
    );
  }

  const resolvedVideoId =
    movie.videoId ??
    extractVideoId(path.basename(movie.sourcePath, path.extname(movie.sourcePath)));
  const actresses = movie.actresses;
  const targetDirectory = await ensureLibraryTargetDirectory(targetRoot, {
    libraryMode: targetMode,
    title: movie.title,
    year: movie.year,
    videoId: resolvedVideoId,
    actresses,
    modelName: null,
    resolveLongPath: true,
    organizationSettings
  });

  const targetVideoPath = await ensureUniquePath(
    buildTargetVideoPath(targetDirectory, {
      libraryMode: targetMode,
      title: movie.title,
      year: movie.year,
      videoId: resolvedVideoId,
      actresses,
      modelName: null,
      resolveLongPath: true,
      organizationSettings
    }, path.extname(movie.sourcePath))
  );
  assertPathWithinRoot(targetRoot, targetVideoPath);

  const targetNfoPath = assertPathWithinRoot(
    targetRoot,
    buildTargetNfoPath(targetDirectory, {
      libraryMode: targetMode,
      title: movie.title,
      year: movie.year,
      videoId: resolvedVideoId,
      actresses,
      modelName: null,
      resolveLongPath: true,
      organizationSettings
    })
  );
  const reservedPaths = new Set<string>();
  const movedFiles: Array<{ sourcePath: string; targetPath: string }> = [];
  const targetSubtitles: SubtitleRecord[] = [];

  for (const subtitle of movie.subtitles) {
    const targetSubtitlePath = await ensureUniquePath(
      buildTargetSubtitlePath({
        directory: targetDirectory,
        title: movie.title,
        year: movie.year,
        videoId: resolvedVideoId,
        actresses,
        modelName: null,
        language: subtitle.language,
        extension: path.extname(subtitle.path),
        subtitleCount: movie.subtitles.length,
        resolveLongPath: true,
        organizationSettings
      }),
      reservedPaths
    );
    assertPathWithinRoot(targetRoot, targetSubtitlePath);
    targetSubtitles.push({
      ...subtitle,
      path: targetSubtitlePath
    });
  }

  let previousNfo: Buffer | null = null;
  try {
    previousNfo = await fs.readFile(targetNfoPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  try {
    try {
      await moveFile(movie.sourcePath, targetVideoPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      const hint =
        code === "EPERM" || code === "EACCES"
          ? " — file may be read-only or open in another app"
          : code === "ENOSPC"
          ? " — destination disk is full"
          : code
          ? ` [${code}]`
          : "";
      throw new Error(`Cannot move "${path.basename(movie.sourcePath)}"${hint}`, {
        cause: error
      });
    }
    movedFiles.push({ sourcePath: movie.sourcePath, targetPath: targetVideoPath });
    for (let index = 0; index < movie.subtitles.length; index += 1) {
      const subtitle = movie.subtitles[index];
      const targetSubtitle = targetSubtitles[index];
      await moveFile(subtitle.path, targetSubtitle.path);
      movedFiles.push({ sourcePath: subtitle.path, targetPath: targetSubtitle.path });
    }

    await writeMovieNfo({
      directory: targetDirectory,
      libraryMode: targetMode,
      title: movie.title,
      year: movie.year,
      videoId: resolvedVideoId,
      actresses,
      modelName: null,
      sourcePath: targetVideoPath,
      organizationSettings
    });

    database.updateMovieAndSubtitles({
      id: movie.id,
      title: movie.title,
      year: movie.year,
      videoId: resolvedVideoId,
      sourcePath: targetVideoPath,
      folderPath: targetDirectory,
      libraryMode: targetMode,
      resolution: movie.resolution,
      posterUrl: movie.posterUrl,
      posterSource: movie.posterSource,
      actresses,
      keywords: movie.keywords
    }, targetSubtitles);
  } catch (error) {
    const rollbackErrors: string[] = [];
    for (const moved of movedFiles.reverse()) {
      try {
        await moveFile(moved.targetPath, moved.sourcePath);
      } catch (rollbackError) {
        rollbackErrors.push(`${moved.targetPath}: ${getErrorMessage(rollbackError)}`);
      }
    }

    try {
      if (previousNfo) {
        await fs.writeFile(targetNfoPath, previousNfo);
      } else {
        await fs.rm(targetNfoPath, { force: true });
      }
    } catch (rollbackError) {
      rollbackErrors.push(`${targetNfoPath}: ${getErrorMessage(rollbackError)}`);
    }

    if (rollbackErrors.length > 0) {
      throw new Error(
        `Move failed (${getErrorMessage(error)}) and rollback was incomplete: ${rollbackErrors.join("; ")}`,
        { cause: error }
      );
    }
    throw error;
  }

  await cleanupDirectory(path.dirname(movie.sourcePath)).catch(() => undefined);

  return database.getMovie(movie.id) ?? {
    ...movie,
    sourcePath: targetVideoPath,
    folderPath: targetDirectory,
    libraryMode: targetMode,
    videoId: resolvedVideoId,
    subtitles: targetSubtitles
  };
}

async function ensureUniquePath(
  initialPath: string,
  reservedPaths = new Set<string>()
): Promise<string> {
  const extension = path.extname(initialPath);
  const stem = path.basename(initialPath, extension);
  const directory = path.dirname(initialPath);
  const normalize = (candidate: string) =>
    process.platform === "win32" ? candidate.toLowerCase() : candidate;
  let candidate = initialPath;
  let index = 1;

  while (await exists(candidate) || reservedPaths.has(normalize(candidate))) {
    candidate = path.join(directory, `${stem} (${index})${extension}`);
    index += 1;
  }

  reservedPaths.add(normalize(candidate));
  return candidate;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Robust file move for Windows + cross-device scenarios.
 *  Handles: EXDEV (cross-drive), EPERM/EACCES (read-only attr / ACL),
 *  EBUSY (file locked — retries up to 5× with 300 ms back-off). */
export async function moveFile(sourcePath: string, targetPath: string): Promise<void> {
  const RETRIES = 5;
  const RETRY_DELAY_MS = 300;
  const isWindows = process.platform === "win32";

  function toExtended(p: string) {
    if (!isWindows) return p;
    // absolute path with backslashes
    const abs = path.resolve(p);
    if (abs.startsWith("\\\\?\\")) return abs;
    if (abs.startsWith("\\\\")) {
      // UNC path: convert \\server\share to \\?\UNC\server\share
      return `\\\\?\\UNC\\${abs.slice(2).replace(/\\/g, "\\")}`;
    }
    return `\\\\?\\${abs}`;
  }
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
      try {
      // Attempt using extended paths on Windows to resolve long-path issues
      const src = isWindows ? toExtended(sourcePath) : sourcePath;
      const dst = isWindows ? toExtended(targetPath) : targetPath;
      await fs.rename(src, dst);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if ((code === "EBUSY" || code === "EPERM") && attempt < RETRIES) {
        await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
        continue;
      }

      if (code === "EXDEV" || code === "EPERM" || code === "EACCES") {
        const src = isWindows ? toExtended(sourcePath) : sourcePath;
        const dst = isWindows ? toExtended(targetPath) : targetPath;
        await fs.copyFile(src, dst, fsConstants.COPYFILE_EXCL);
        await fs.chmod(src, 0o666).catch(() => undefined);
        try {
          await fs.unlink(src);
        } catch (unlinkError) {
          try {
            await fs.unlink(dst);
          } catch (cleanupError) {
            throw new Error(
              `Copied file remains at "${targetPath}" because the source could not be removed (${getErrorMessage(unlinkError)}) and the copy could not be cleaned up (${getErrorMessage(cleanupError)}).`,
              { cause: unlinkError }
            );
          }
          throw unlinkError;
        }
        return;
      }

      throw error;
    }
  }
}

async function cleanupDirectory(directory: string): Promise<void> {
  // Let the filesystem verify emptiness at deletion time. Another process may
  // have written into the source folder while the movie was moving.
  await fs.rmdir(directory);
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}
