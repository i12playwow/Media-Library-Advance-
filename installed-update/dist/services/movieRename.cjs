"use strict";

const fs = require("node:fs/promises");
const { COPYFILE_EXCL } = require("node:fs").constants;
const path = require("node:path");

const copyFallbackErrors = new Set(["EXDEV", "EPERM", "EACCES", "ENOSYS", "ENOTSUP", "EMLINK"]);

function validateFilename(filename, extension) {
  if (path.extname(filename).toLowerCase() !== extension.toLowerCase()) {
    throw new Error(`Keep the ${extension} extension when renaming the video.`);
  }
  if (/[<>:"/\\|?*\x00-\x1F]/.test(filename) || /[. ]$/.test(filename) ||
      /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(filename) ||
      !path.basename(filename, extension).trim()) {
    throw new Error("Choose a valid video filename.");
  }
}

async function relocateVideo(database, movie, targetPath, targetDirectory) {
  const original = { sourcePath: movie.sourcePath, folderPath: movie.folderPath, libraryMode: movie.libraryMode };
  const updated = { ...original, sourcePath: targetPath, folderPath: targetDirectory };

  // A case-only rename on Windows refers to the same directory entry.
  if (process.platform === "win32" && movie.sourcePath.toLowerCase() === targetPath.toLowerCase()) {
    const [source, target] = await Promise.all([fs.lstat(movie.sourcePath), fs.lstat(targetPath)]);
    if (source.ino !== target.ino || source.dev !== target.dev) throw new Error("A file with that name already exists.");
    await fs.rename(movie.sourcePath, targetPath);
    try {
      database.updateMovieLocation(movie.id, updated);
    } catch (error) {
      await fs.rename(targetPath, movie.sourcePath);
      throw error;
    }
    return;
  }

  // Create the destination exclusively so an existing video is never replaced.
  try {
    await fs.link(movie.sourcePath, targetPath);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("A file with that name already exists.");
    if (!copyFallbackErrors.has(error.code)) throw error;
    try {
      await fs.copyFile(movie.sourcePath, targetPath, COPYFILE_EXCL);
    } catch (copyError) {
      if (copyError.code === "EEXIST") throw new Error("A file with that name already exists.");
      throw copyError;
    }
  }

  try {
    database.updateMovieLocation(movie.id, updated);
    await fs.unlink(movie.sourcePath);
  } catch (error) {
    try {
      database.updateMovieLocation(movie.id, original);
    } catch {
      throw new Error(`Could not finish the rename. Both video paths may exist. Check "${movie.sourcePath}" and "${targetPath}".`);
    }
    await fs.unlink(targetPath).catch(() => {});
    throw error;
  }
}

function decodeTitle(title) {
  const entities = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ", ndash: "–", mdash: "—" };
  return title.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, key) => {
    if (!key.startsWith("#")) return entities[key.toLowerCase()] ?? entity;
    const number = /^#x/i.test(key) ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return number > 0 && number <= 0x10ffff ? String.fromCodePoint(number) : entity;
  });
}

async function suggestJavDatabaseName(movie, extension, lookup) {
  const { extractVideoId } = require("../shared/videoId");
  const code = extractVideoId(movie.videoId || "") ?? extractVideoId(path.basename(movie.sourcePath, extension));
  if (!code) throw new Error("No movie code found for a JAVDatabase lookup.");

  let metadata;
  try {
    metadata = await lookup(code, AbortSignal.timeout(12000));
  } catch {
    throw new Error("Could not reach JAVDatabase. Try again or use manual rename.");
  }
  const pageTitle = decodeTitle(metadata?.pageTitle ?? "").replace(/\s*[|–—-]\s*JAV\s*Database\s*$/i, "").trim();
  const codePattern = new RegExp("\\b" + code.replace(/-/g, "[-_ ]?") + "\\b", "i");
  if (!codePattern.test(pageTitle)) {
    throw new Error("JAVDatabase did not return a matching title for " + code + ".");
  }
  const title = pageTitle.replace(codePattern, "").replace(/^[\s|:–—-]+|[\s|:–—-]+$/g, "");
  const safeTitle = title.replace(/[<>:"/\\|?*\x00-\x1F]/g, " ").replace(/\s+/g, " ").trim();
  const stem = Array.from(safeTitle ? code + " - " + safeTitle : code).slice(0, 120).join("").replace(/[ .]+$/, "");
  return stem + extension;
}

function createMovieRenamer({ database, dialog, getWindow, isUnlocked, canRename, lookupJavDatabase = require('./metadataService').fetchJavDatabaseMetadata }) {
  let busy = false;

  async function rename(event, id, action) {
    const window = getWindow();
    if (!window || event.sender !== window.webContents) throw new Error("Use the main library window to rename videos.");
    if (typeof id !== "string" || !id || !["rename", "move", "javdatabase"].includes(action)) throw new Error("Choose a video and rename action.");
    if (busy || !canRename()) throw new Error("Wait for the current scan or file operation to finish.");
    busy = true;
    try {
      const movie = database.getMovie(id);
      if (!movie || (movie.libraryMode === "gentle" && !isUnlocked())) throw new Error("Video unavailable. Unlock Gentle mode if needed.");
      const extension = path.extname(movie.sourcePath);
      const sourceDirectory = await fs.realpath(path.dirname(movie.sourcePath));
      const source = await fs.lstat(movie.sourcePath);
      if (!source.isFile() || source.isSymbolicLink()) throw new Error("Only regular video files can be renamed.");
      const automatic = action === "javdatabase";
      const defaultPath = automatic
        ? path.join(sourceDirectory, await suggestJavDatabaseName(movie, extension, lookupJavDatabase))
        : movie.sourcePath;
      if (movie.libraryMode === "gentle" && !isUnlocked()) throw new Error("Gentle mode was locked.");
      const choice = await dialog.showSaveDialog(window, {
        title: automatic ? "Review JAVDatabase filename" : action === "rename" ? "Rename video in its current folder" : "Rename and move video",
        defaultPath,
        buttonLabel: automatic ? "Apply filename" : action === "rename" ? "Rename" : "Rename and move",
        filters: [{ name: "Video", extensions: [extension.slice(1)] }],
      });
      if (choice.canceled || !choice.filePath) return { changed: false };
      const current = database.getMovie(id);
      if (!current || current.sourcePath !== movie.sourcePath || current.libraryMode !== movie.libraryMode ||
          (current.libraryMode === "gentle" && !isUnlocked()) || !canRename()) {
        throw new Error("The video or library changed. Reopen the rename action and try again.");
      }
      const filename = path.basename(choice.filePath);
      validateFilename(filename, extension);
      const targetDirectory = await fs.realpath(path.dirname(choice.filePath));
      if (action === "rename" && sourceDirectory !== targetDirectory) {
        throw new Error("Choose a filename in the current folder, or use Rename and move video.");
      }
      if (sourceDirectory === targetDirectory && filename === path.basename(movie.sourcePath)) return { changed: false };
      const latest = await fs.lstat(movie.sourcePath);
      if (latest.dev !== source.dev || latest.ino !== source.ino || !latest.isFile() || latest.isSymbolicLink()) {
        throw new Error("The file changed while the dialog was open. Try again.");
      }
      const targetPath = path.join(targetDirectory, filename);
      await relocateVideo(database, movie, targetPath, targetDirectory);
      return { changed: true, fileName: filename };
    } finally {
      busy = false;
    }
  }

  return { rename, isBusy: () => busy };
}

module.exports = { createMovieRenamer };
