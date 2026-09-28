import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseClient } from "../database/database";
import { resolveOnlineMovieMetadata } from "./metadataService";
import {
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
  const targetRoot = normalizeRootList(roots[targetMode])[0];
  if (!targetRoot) {
    throw new Error(
      `No ${targetMode} library root is configured yet. Add one in the Library page first.`
    );
  }

  const resolvedVideoId =
    movie.videoId ??
    extractVideoId(path.basename(movie.sourcePath, path.extname(movie.sourcePath)));
  const onlineMetadata = await resolveOnlineMovieMetadata(
    {
      title: movie.title,
      year: movie.year,
      videoId: resolvedVideoId,
      sourcePath: movie.sourcePath
    },
    database.getMetadataSettings()
  ).catch(() => null);
  const actresses =
    onlineMetadata?.actresses.length ? onlineMetadata.actresses : movie.actresses;
  const targetDirectory = await ensureLibraryTargetDirectory(targetRoot, {
    libraryMode: targetMode,
    title: movie.title,
    year: movie.year,
    videoId: resolvedVideoId,
    actresses,
    modelName: onlineMetadata?.modelName ?? null,
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
      modelName: onlineMetadata?.modelName ?? null,
      resolveLongPath: true,
      organizationSettings
    }, path.extname(movie.sourcePath))
  );
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
    throw new Error(`Cannot move "${path.basename(movie.sourcePath)}"${hint}`);
  }

  const movedSubtitles: SubtitleRecord[] = [];
  for (const subtitle of movie.subtitles) {
    const targetSubtitlePath = await ensureUniquePath(
      buildTargetSubtitlePath({
        directory: targetDirectory,
        title: movie.title,
        year: movie.year,
        videoId: resolvedVideoId,
        actresses,
        modelName: onlineMetadata?.modelName ?? null,
        language: subtitle.language,
        extension: path.extname(subtitle.path),
        subtitleCount: movie.subtitles.length,
        resolveLongPath: true,
        organizationSettings
      })
    );
    await moveFile(subtitle.path, targetSubtitlePath);
    movedSubtitles.push({
      ...subtitle,
      path: targetSubtitlePath
    });
  }

  await writeMovieNfo({
    directory: targetDirectory,
    libraryMode: targetMode,
    title: movie.title,
    year: movie.year,
    videoId: resolvedVideoId,
    actresses,
    modelName: onlineMetadata?.modelName ?? null,
    sourcePath: targetVideoPath,
    organizationSettings
  });

  database.upsertMovie({
    id: movie.id,
    title: movie.title,
    year: movie.year,
    videoId: resolvedVideoId,
    sourcePath: targetVideoPath,
    folderPath: targetDirectory,
    libraryMode: targetMode,
    resolution: movie.resolution,
    posterUrl: onlineMetadata?.posterUrl ?? movie.posterUrl,
    posterSource: onlineMetadata?.posterUrl ? onlineMetadata.source : movie.posterSource,
    actresses,
    keywords: movie.keywords
  });
  database.replaceSubtitles(movie.id, movedSubtitles);

  await cleanupDirectory(path.dirname(movie.sourcePath));

  return database.getMovie(movie.id) ?? {
    ...movie,
    sourcePath: targetVideoPath,
    folderPath: targetDirectory,
    libraryMode: targetMode,
    videoId: resolvedVideoId,
    subtitles: movedSubtitles
  };
}

async function ensureUniquePath(initialPath: string): Promise<string> {
  const extension = path.extname(initialPath);
  const stem = path.basename(initialPath, extension);
  const directory = path.dirname(initialPath);
  let candidate = initialPath;
  let index = 1;

  while (await exists(candidate)) {
    candidate = path.join(directory, `${stem} (${index})${extension}`);
    index += 1;
  }

  return candidate;
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
        await fs.copyFile(src, dst);
        await fs.chmod(src, 0o666).catch(() => undefined);
        await fs.unlink(src);
        return;
      }

      throw error;
    }
  }
}

async function cleanupDirectory(directory: string): Promise<void> {
  if (!(await exists(directory))) {
    return;
  }

  // readdir returns only user-visible names; use readdirSync equiv that includes hidden
  const remaining = await fs.readdir(directory);
  // Filter out Windows thumb/desktop.ini artifacts before deciding to remove
  const real = remaining.filter((f) => f !== "Thumbs.db" && f !== "desktop.ini" && f !== ".DS_Store");
  if (real.length === 0) {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}
