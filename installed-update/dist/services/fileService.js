"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.moveMovieToMode = moveMovieToMode;
exports.moveFile = moveFile;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const libraryLayout_1 = require("./libraryLayout");
const videoId_1 = require("../shared/videoId");
function normalizeRootList(value) {
    if (!Array.isArray(value)) {
        return typeof value === "string" && value.trim() ? [value.trim()] : [];
    }
    return value.filter((root) => typeof root === "string" && root.trim().length > 0);
}
async function moveMovieToMode(database, movieId, targetMode, options) {
    const performMove = options?.moveFile ?? moveFile;
    const movie = database.getMovie(movieId);
    if (!movie) {
        throw new Error("Movie not found.");
    }
    const roots = database.getRoots();
    const organizationSettings = database.getOrganizationSettings();
    const storageFolder = targetMode === "gentle" ? organizationSettings.gentleLibraryPath : organizationSettings.normalLibraryPath;
  const targetRoot = storageFolder?.trim() || normalizeRootList(roots[targetMode])[0];
    if (!targetRoot) {
        throw new Error(`Choose a storage folder for the ${targetMode} library in Settings before moving files.`);
    }
    const resolvedVideoId = movie.videoId ??
        (0, videoId_1.extractVideoId)(node_path_1.default.basename(movie.sourcePath, node_path_1.default.extname(movie.sourcePath)));
    const actresses = movie.actresses;
  const targetDirectory = await (0, libraryLayout_1.ensureLibraryTargetDirectory)(targetRoot, {
        libraryMode: targetMode,
        title: movie.title,
        year: movie.year,
        videoId: resolvedVideoId,
        actresses,
        modelName: null,
        resolveLongPath: true,
        organizationSettings
    });
    const targetVideoPath = await ensureUniquePath((0, libraryLayout_1.buildTargetVideoPath)(targetDirectory, {
        libraryMode: targetMode,
        title: movie.title,
        year: movie.year,
        videoId: resolvedVideoId,
        actresses,
        modelName: null,
        resolveLongPath: true,
        organizationSettings
    }, node_path_1.default.extname(movie.sourcePath)));
    try {
        await performMove(movie.sourcePath, targetVideoPath);
    }
    catch (error) {
        const code = error.code;
        const hint = code === "EPERM" || code === "EACCES"
            ? " — file may be read-only or open in another app"
            : code === "ENOSPC"
                ? " — destination disk is full"
                : code
                    ? ` [${code}]`
                    : "";
        throw new Error(`Cannot move "${node_path_1.default.basename(movie.sourcePath)}"${hint}`);
    }
    // Move subtitles one by one, tracking what has moved so a failure can be
    // undone — a partially moved movie would be invisible to the library.
    const movedSubtitles = [];
    try {
        for (const subtitle of movie.subtitles) {
            const targetSubtitlePath = await ensureUniquePath((0, libraryLayout_1.buildTargetSubtitlePath)({
                directory: targetDirectory,
                title: movie.title,
                year: movie.year,
                videoId: resolvedVideoId,
                actresses,
                modelName: null,
                language: subtitle.language,
                extension: node_path_1.default.extname(subtitle.path),
                subtitleCount: movie.subtitles.length,
                resolveLongPath: true,
                organizationSettings
            }));
            await performMove(subtitle.path, targetSubtitlePath);
            movedSubtitles.push({
                record: { ...subtitle, path: targetSubtitlePath },
                sourcePath: subtitle.path
            });
        }
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        // Roll back in reverse order: subtitles first, then the video itself.
        const rollbackMove = async (originalPath, movedPath) => {
            try {
                await performMove(movedPath, originalPath);
                return true;
            }
            catch (rollbackError) {
                // eslint-disable-next-line no-console
                console.error(`Failed to roll back move of "${movedPath}" to "${originalPath}": ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
                return false;
            }
        };
        for (const entry of [...movedSubtitles].reverse()) {
            await rollbackMove(entry.sourcePath, entry.record.path);
        }
        const videoRestored = await rollbackMove(movie.sourcePath, targetVideoPath);
        await cleanupDirectory(targetDirectory);
        // Prune now-empty intermediate directories up to (but never including)
        // the library root so a failed move leaves no ghost folders behind.
        let parent = node_path_1.default.dirname(targetDirectory);
        while (parent.length > targetRoot.length &&
            node_path_1.default.relative(targetRoot, parent).length > 0 &&
            !node_path_1.default.relative(targetRoot, parent).startsWith("..")) {
            try {
                await promises_1.default.rmdir(parent); // fails with ENOTEMPTY if anything remains
            }
            catch {
                break;
            }
            parent = node_path_1.default.dirname(parent);
        }
        throw new Error(videoRestored
            ? `Move failed and was rolled back: ${detail}. "${node_path_1.default.basename(movie.sourcePath)}" remains in its original location.`
            : `Move failed and could not be fully rolled back: ${detail}. The video is at "${targetVideoPath}" but the library still points at the original location — move it back manually or re-scan.`);
    }
    await (0, libraryLayout_1.writeMovieNfo)({
        directory: targetDirectory,
        libraryMode: targetMode,
        title: movie.title,
        year: movie.year,
        videoId: resolvedVideoId,
        actresses,
        modelName: null,
        sourcePath: targetVideoPath,
        organizationSettings
    }).catch(() => undefined);
    database.upsertMovie({
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
    });
    database.replaceSubtitles(movie.id, movedSubtitles.map((entry) => entry.record));
    await cleanupDirectory(node_path_1.default.dirname(movie.sourcePath)).catch(() => undefined);
    return database.getMovie(movie.id) ?? {
        ...movie,
        sourcePath: targetVideoPath,
        folderPath: targetDirectory,
        libraryMode: targetMode,
        videoId: resolvedVideoId,
        subtitles: movedSubtitles.map((entry) => entry.record)
    };
}
async function ensureUniquePath(initialPath) {
    const extension = node_path_1.default.extname(initialPath);
    const stem = node_path_1.default.basename(initialPath, extension);
    const directory = node_path_1.default.dirname(initialPath);
    let candidate = initialPath;
    let index = 1;
    while (await exists(candidate)) {
        candidate = node_path_1.default.join(directory, `${stem} (${index})${extension}`);
        index += 1;
    }
    return candidate;
}
/** Robust file move for Windows + cross-device scenarios.
 *  Handles: EXDEV (cross-drive), EPERM/EACCES (read-only attr / ACL),
 *  EBUSY (file locked — retries up to 5× with 300 ms back-off). */
async function moveFile(sourcePath, targetPath) {
    const RETRIES = 5;
    const RETRY_DELAY_MS = 300;
    const isWindows = process.platform === "win32";
    function toExtended(p) {
        if (!isWindows)
            return p;
        // absolute path with backslashes
        const abs = node_path_1.default.resolve(p);
        if (abs.startsWith("\\\\?\\"))
            return abs;
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
            await promises_1.default.rename(src, dst);
            return;
        }
        catch (error) {
            const code = error.code;
            if ((code === "EBUSY" || code === "EPERM") && attempt < RETRIES) {
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
                continue;
            }
            if (code === "EXDEV" || code === "EPERM" || code === "EACCES") {
                const src = isWindows ? toExtended(sourcePath) : sourcePath;
                const dst = isWindows ? toExtended(targetPath) : targetPath;
                await promises_1.default.copyFile(src, dst);
                await promises_1.default.chmod(src, 0o666).catch(() => undefined);
                await promises_1.default.unlink(src);
                return;
            }
            throw error;
        }
    }
}
async function cleanupDirectory(directory) {
    // Let the filesystem verify emptiness at deletion time.
    await promises_1.default.rmdir(directory);
}
async function exists(candidate) {
    try {
        await promises_1.default.access(candidate);
        return true;
    }
    catch {
        return false;
    }
}
