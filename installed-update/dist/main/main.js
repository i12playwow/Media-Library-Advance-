"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const node_url_1 = require("node:url");
const node_fs_1 = __importDefault(require("node:fs"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_child_process_1 = require("node:child_process");
const electron_1 = require("electron");
const database_1 = require("../database/database");
const fileService_1 = require("../services/fileService");
const libraryLayout_1 = require("../services/libraryLayout");
const libraryScanner_1 = require("../services/libraryScanner");
const metadataService_1 = require("../services/metadataService");
const ffmpegService_1 = require("../services/ffmpegService");
const contracts_1 = require("../shared/contracts");
let mainWindow = null;
let database;
let gentleUnlocked = false;
let activeScanToken = null;
const activeSubtitleModelDownloads = new Map();
function broadcastGentleState(message) {
    mainWindow?.show();
    mainWindow?.focus();
    mainWindow?.webContents.send("gentle:unlockResult", {
        ok: true,
        message
    });
}
function toggleGentleUnlocked(reason) {
    gentleUnlocked = !gentleUnlocked;
    broadcastGentleState(gentleUnlocked
        ? `Gentle library enabled for this session (${reason}).`
        : `Gentle library disabled for this session (${reason}).`);
    return gentleUnlocked;
}
electron_1.protocol.registerSchemesAsPrivileged([{
        scheme: "mla-media",
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            stream: true
        }
    }]);
function resolveAppIconPath() {
    return node_path_1.default.join(electron_1.app.getAppPath(), "resources", "icon.png");
}
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1480,
        height: 920,
        minWidth: 1180,
        minHeight: 760,
        title: "MLA+",
        icon: resolveAppIconPath(),
        backgroundColor: "#0f1217",
        webPreferences: {
            preload: node_path_1.default.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    const rendererUrl = process.env.ELECTRON_RENDERER_URL;
    if (rendererUrl) {
        void mainWindow.loadURL(rendererUrl);
    }
    else {
        void mainWindow.loadFile(node_path_1.default.join(__dirname, "../renderer/index.html"));
    }
    // Forward renderer console messages to the main process terminal for debugging
    mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
        const levelName = level === 0 ? "LOG" : level === 1 ? "WARNING" : level === 2 ? "ERROR" : `LVL${level}`;
        // Print a compact log line to terminal
        // eslint-disable-next-line no-console
        console.log(`[renderer:${levelName}] ${message} (${sourceId}:${line})`);
    });
    // Also log unhandled renderer crashes
    mainWindow.webContents.on("render-process-gone", (_event, details) => {
        // eslint-disable-next-line no-console
        console.error(`[renderer:CRASH] Reason=${details.reason} exitCode=${details.exitCode}`);
    });
}
function buildShellState() {
    return {
        version: electron_1.app.getVersion(),
        platform: process.platform,
        gentleUnlocked,
        themeMode: database.getThemeMode(),
        roots: database.getRoots(),
        starterPinHint: database.getStarterPinHint(),
        metadataSettings: database.getMetadataSettings(),
        organizationSettings: database.getOrganizationSettings(),
        subtitleDirs: database.getSubtitleDirs(),
        scanHistory: database.getScanHistory()
    };
}
function emitScanProgress(progress) {
    mainWindow?.webContents.send("scan:progress", progress);
}
function emptyScanSummary(scannedRoots) {
    return {
        discovered: 0,
        imported: 0,
        skipped: 0,
        errors: [],
        subtitleSearchLogs: [],
        invalidFiles: [],
        scannedRoots: scannedRoots ?? {
            normal: [],
            gentle: []
        },
        duplicateGroups: [],
        cancelled: true
    };
}
function buildCancelledProgress(mode) {
    return {
        stage: "cancelled",
        mode,
        currentRoot: null,
        currentFile: null,
        processedFiles: 0,
        totalFiles: 0,
        imported: 0,
        skipped: 0,
        message: "Folder selection was cancelled."
    };
}
function buildTranscodeOutputPath(sourcePath) {
    const cacheDir = node_path_1.default.join(electron_1.app.getPath("userData"), "player-cache");
    node_fs_1.default.mkdirSync(cacheDir, { recursive: true });
    const stat = node_fs_1.default.statSync(sourcePath);
    const baseName = node_path_1.default.basename(sourcePath, node_path_1.default.extname(sourcePath));
    const safeBase = baseName.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "video";
    const signature = `${stat.size}-${Math.floor(stat.mtimeMs)}`;
    return node_path_1.default.join(cacheDir, `${safeBase}-${signature}.mp4`);
}
function resolveTargetMode(options) {
    if (options.addToNormalModeLibrary === options.addToGentleModeLibrary) {
        throw new Error("Select either Normal Mode library or Gentle Mode library.");
    }
    return options.addToGentleModeLibrary ? "gentle" : "normal";
}
function normalizeRootList(value) {
    if (Array.isArray(value)) {
        return value.filter((entry) => typeof entry === "string" && entry.trim().length > 0);
    }
    if (typeof value === "string" && value.trim().length > 0) {
        return [value];
    }
    return [];
}
function emptyPosterBackfillSummary(requested) {
    return {
        requested,
        updated: 0,
        skipped: 0,
        errors: []
    };
}
function resolveSubGenScriptPath() {
    return require("../services/subgenRuntime.cjs").scriptPath(electron_1.app);
}
function resolveSubGenModelsRoot() {
    return require("../services/subgenRuntime.cjs").modelsRoot(electron_1.app);
}
function buildSubGenSetupMessage(detail) {
    const suffix = detail ? ` ${detail}` : "";
    return `Sub-Gen needs a working Python install plus faster-whisper and huggingface_hub. Install the packages from resources/subgen/requirements.txt, then try again.${suffix}`;
}
function emitSubtitleModelDownloadProgress(progress) {
    mainWindow?.webContents.send("subtitle:modelDownloadProgress", progress);
}
function isSubtitleSetupRequiredMessage(output) {
    const lowered = output.toLowerCase();
    return lowered.includes("no module named") || lowered.includes("python was not found") || lowered.includes("not recognized");
}
function parseSubtitleScriptPayload(line) {
    const trimmed = line.trim();
    if (!trimmed) {
        return null;
    }
    try {
        return JSON.parse(trimmed);
    }
    catch {
        return null;
    }
}
function extractSubtitleScriptResult(stdout) {
    const lines = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        const payload = parseSubtitleScriptPayload(lines[index]);
        if (!payload) {
            continue;
        }
        if (payload.event === "result") {
            return payload.result ?? null;
        }
        return payload;
    }
    return null;
}
async function getSubtitleModelAvailability(model) { return require("../services/subgenRuntime.cjs").checkModel(electron_1.app, model); }

async function downloadSubtitleModel(model) {
    const activeDownload = activeSubtitleModelDownloads.get(model);
    if (activeDownload) {
        return activeDownload;
    }
    const downloadPromise = (async () => {
        const scriptPath = resolveSubGenScriptPath();
        const modelsRoot = resolveSubGenModelsRoot();
        try {
            await promises_1.default.access(scriptPath);
        }
        catch {
            return {
                ok: false,
                model,
                available: false,
                modelPath: null,
                message: buildSubGenSetupMessage("The generator script was not found."),
                setupRequired: true
            };
        }
        return new Promise((resolve) => {
            const child = require("../services/subgenRuntime.cjs").spawnPython(electron_1.app, [scriptPath, "download-model", "--model", model, "--models-root", modelsRoot], {
                cwd: electron_1.app.getAppPath(),
                windowsHide: true
            });
            let stdout = "";
            let stderr = "";
            let stdoutBuffer = "";
            let finalResult = null;
            child.stdout.on("data", (chunk) => {
                const text = chunk.toString();
                stdout += text;
                stdoutBuffer += text;
                const lines = stdoutBuffer.split(/\r?\n/);
                stdoutBuffer = lines.pop() ?? "";
                for (const line of lines) {
                    const payload = parseSubtitleScriptPayload(line);
                    if (!payload) {
                        continue;
                    }
                    if (payload.event === "progress" && payload.progress) {
                        emitSubtitleModelDownloadProgress(payload.progress);
                        continue;
                    }
                    if (payload.event === "result") {
                        finalResult = payload.result;
                    }
                }
            });
            child.stderr.on("data", (chunk) => {
                stderr += chunk.toString();
            });
            child.on("error", (error) => {
                const message = buildSubGenSetupMessage(error.message);
                emitSubtitleModelDownloadProgress({
                    model,
                    stage: "error",
                    fileName: null,
                    filesCompleted: 0,
                    totalFiles: 0,
                    downloadedBytes: 0,
                    totalBytes: null,
                    percent: 0,
                    message
                });
                resolve({
                    ok: false,
                    model,
                    available: false,
                    modelPath: null,
                    message,
                    setupRequired: true
                });
            });
            child.on("close", (code) => {
                if (stdoutBuffer.trim().length > 0) {
                    const payload = parseSubtitleScriptPayload(stdoutBuffer);
                    if (payload?.event === "progress" && payload.progress) {
                        emitSubtitleModelDownloadProgress(payload.progress);
                    }
                    else if (payload?.event === "result") {
                        finalResult = payload.result;
                    }
                }
                if (finalResult) {
                    resolve(finalResult);
                    return;
                }
                const message = stderr.trim() || stdout.trim() || `Whisper model download failed with exit code ${code}.`;
                const setupRequired = isSubtitleSetupRequiredMessage(`${stdout}\n${stderr}`);
                emitSubtitleModelDownloadProgress({
                    model,
                    stage: "error",
                    fileName: null,
                    filesCompleted: 0,
                    totalFiles: 0,
                    downloadedBytes: 0,
                    totalBytes: null,
                    percent: 0,
                    message: setupRequired ? buildSubGenSetupMessage(message) : message
                });
                resolve({
                    ok: false,
                    model,
                    available: false,
                    modelPath: null,
                    message: setupRequired ? buildSubGenSetupMessage(message) : message,
                    setupRequired
                });
            });
        });
    })();
    activeSubtitleModelDownloads.set(model, downloadPromise);
    try {
        return await downloadPromise;
    }
    finally {
        activeSubtitleModelDownloads.delete(model);
    }
}
function normalizeSubtitleOutputFileName(value) {
    const trimmed = value.trim();
    if (!trimmed) {
        return "";
    }
    const sanitized = trimmed
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
        .replace(/[. ]+$/g, "");
    if (!sanitized) {
        return "";
    }
    return sanitized.toLowerCase().endsWith(".srt") ? sanitized : `${sanitized}.srt`;
}
function resolveSubtitleOutputPath(movie, options) {
    const targetPath = (0, libraryLayout_1.buildTargetSubtitlePath)({
        directory: movie.folderPath,
        title: movie.title,
        year: movie.year,
        videoId: movie.videoId,
        actresses: movie.actresses,
        modelName: movie.videoId?.split("-")[0] ?? null,
        language: options.language === "auto" ? "und" : options.language,
        extension: ".srt",
        subtitleCount: Math.max(movie.subtitles.length + 1, 1),
        resolveLongPath: true,
        organizationSettings: database.getOrganizationSettings()
    });
    const customFileName = options.outputFileName?.trim()
        ? normalizeSubtitleOutputFileName(options.outputFileName)
        : "";
    const targetDirectory = options.outputMode === "custom-directory"
        ? options.outputDirectory?.trim() ?? ""
        : node_path_1.default.dirname(targetPath);
    const finalTargetPath = options.outputMode === "output-srt"
        ? node_path_1.default.join(movie.folderPath, "output.srt")
        : options.outputMode === "custom-directory"
            ? options.outputDirectory?.trim()
                ? node_path_1.default.join(options.outputDirectory.trim(), customFileName || node_path_1.default.basename(targetPath))
                : ""
            : customFileName
                ? node_path_1.default.join(node_path_1.default.dirname(targetPath), customFileName)
                : targetPath;
    if (options.outputMode === "custom-directory" && !finalTargetPath) {
        return {
            outputPath: null,
            message: "Choose an output folder before generating subtitles."
        };
    }
    if (options.outputFileName?.trim() && !customFileName) {
        return {
            outputPath: null,
            message: "Choose a valid subtitle file name."
        };
    }
    if (!targetDirectory.trim()) {
        return {
            outputPath: null,
            message: "Choose a valid output folder."
        };
    }
    return {
        outputPath: finalTargetPath,
        message: null
    };
}
async function runSubtitleGeneration(movie, options) {
    const scriptPath = resolveSubGenScriptPath();
    const modelsRoot = resolveSubGenModelsRoot();
    try {
        await promises_1.default.access(scriptPath);
    }
    catch {
        return {
            ok: false,
            message: buildSubGenSetupMessage("The generator script was not found."),
            subtitlePath: null,
            detectedLanguage: null,
            setupRequired: true
        };
    }
    const resolvedOutput = resolveSubtitleOutputPath(movie, options);
    if (!resolvedOutput.outputPath) {
        return {
            ok: false,
            message: resolvedOutput.message ?? "Unable to resolve subtitle output path.",
            subtitlePath: null,
            detectedLanguage: null,
            setupRequired: false
        };
    }
    const finalTargetPath = resolvedOutput.outputPath;
    const args = [scriptPath, "generate", "--input", movie.sourcePath, "--output", finalTargetPath, "--model", options.model, "--models-root", modelsRoot];
    if (options.language !== "auto") {
        args.push("--language", options.language);
    }
    return new Promise((resolve) => {
        const child = require("../services/subgenRuntime.cjs").spawnPython(electron_1.app, args, {
            cwd: electron_1.app.getAppPath(),
            windowsHide: true
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString();
        });
        child.on("error", (error) => {
            resolve({
                ok: false,
                message: buildSubGenSetupMessage(error.message),
                subtitlePath: null,
                detectedLanguage: null,
                setupRequired: true
            });
        });
        child.on("close", (code) => {
            if (code !== 0) {
                const setupRequired = isSubtitleSetupRequiredMessage(`${stdout}\n${stderr}`);
                resolve({
                    ok: false,
                    message: setupRequired ? buildSubGenSetupMessage(stderr.trim() || stdout.trim()) : (stderr.trim() || stdout.trim() || `Subtitle generation failed with exit code ${code}.`),
                    subtitlePath: null,
                    detectedLanguage: null,
                    setupRequired
                });
                return;
            }
            try {
                const payload = JSON.parse(stdout.trim());
                const detectedLanguage = payload.detected_language?.trim() || (options.language === "auto" ? "und" : options.language);
                database.upsertSubtitle(movie.id, payload.output, detectedLanguage);
                resolve({
                    ok: true,
                    message: `Subtitle generated at ${payload.output}`,
                    subtitlePath: payload.output,
                    detectedLanguage,
                    setupRequired: false
                });
            }
            catch {
                resolve({
                    ok: false,
                    message: stderr.trim() || "Subtitle generation completed but returned invalid output.",
                    subtitlePath: null,
                    detectedLanguage: null,
                    setupRequired: false
                });
            }
        });
    });
}
async function backfillMoviePosters(movieIds, options) {
    const summary = emptyPosterBackfillSummary(movieIds.length);
    const metadataSettings = database.getMetadataSettings();
    const forceRefresh = options?.forceRefresh ?? false;
    for (let index = 0; index < movieIds.length; index += 1) {
        const movieId = movieIds[index];
        const movie = database.getMovie(movieId);
        if (!movie) {
            summary.skipped += 1;
            summary.errors.push(`${movieId} - Movie not found.`);
            continue;
        }
        if (movie.posterUrl && !forceRefresh) {
            summary.skipped += 1;
            continue;
        }
        emitScanProgress({
            stage: "processing",
            mode: "all",
            currentRoot: movie.folderPath,
            currentFile: movie.sourcePath,
            processedFiles: index,
            totalFiles: movieIds.length,
            imported: 0,
            skipped: summary.skipped,
            message: `Generating poster for ${movie.title}`
        });
        try {
            const posterUrl = await (0, metadataService_1.enrichMoviePoster)(database, movie.id, metadataSettings, {
                forceRefresh,
                onProgress: emitScanProgress,
                progress: {
                    stage: "processing",
                    mode: "all",
                    currentRoot: movie.folderPath,
                    currentFile: movie.sourcePath,
                    processedFiles: index,
                    totalFiles: movieIds.length,
                    imported: 0,
                    skipped: summary.skipped,
                    message: `Generating poster for ${movie.title}`
                }
            });
            if (posterUrl) {
                summary.updated += 1;
            }
            else {
                summary.skipped += 1;
            }
        }
        catch (error) {
            summary.skipped += 1;
            summary.errors.push(`${movie.sourcePath} - ${error instanceof Error ? error.message : "Poster backfill failed."}`);
        }
    }
    emitScanProgress({
        stage: "completed",
        mode: "all",
        currentRoot: null,
        currentFile: null,
        processedFiles: movieIds.length,
        totalFiles: movieIds.length,
        imported: summary.updated,
        skipped: summary.skipped,
        message: summary.updated > 0 ? "Poster backfill completed." : "Poster backfill finished."
    });
    return summary;
}
async function fetchSubtitleCatResults(query) {
    async function searchOnce(q) {
        const url = `https://www.subtitlecat.com/index.php?search=${encodeURIComponent(q)}`;
        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5"
            }
        });
        if (!response.ok)
            return [];
        const html = await response.text();
        const results = [];
        // Merge both subtitle row parsing strategies for robustness
        // 1. Table row regex (original)
        const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
        const rows = html.match(rowRegex) ?? [];
        for (const row of rows) {
            const pageLinkMatch = row.match(/href="(subs\/[^"]+\.html)"/i);
            if (!pageLinkMatch)
                continue;
            const detailUrl = `https://www.subtitlecat.com/${pageLinkMatch[1]}`;
            const downloadsMatch = row.match(/(\d+)\s+downloads?/i);
            const rowDownloads = downloadsMatch ? Number(downloadsMatch[1]) : 0;
            const rowTitleMatch = row.match(/<a[^>]+href="subs\/[^"]+\.html"[^>]*>([^<]+)<\/a>/i);
            const rowTitle = rowTitleMatch?.[1]?.trim() ?? q;
            try {
                const detailResponse = await fetch(detailUrl, {
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
                        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                        "Accept-Language": "en-US,en;q=0.5"
                    }
                });
                if (!detailResponse.ok)
                    continue;
                const detailHtml = await detailResponse.text();
                const detailMatches = Array.from(detailHtml.matchAll(/<a[^>]+id="download_([a-z]{2}(?:-[A-Z]{2})?)"[^>]+href="([^"]+\.srt[^"]*)"[^>]*>(?:Download)?<\/a>/gi));
                for (const match of detailMatches) {
                    const langCode = match[1].toLowerCase();
                    const downloadUrl = match[2].startsWith("http")
                        ? match[2]
                        : `https://www.subtitlecat.com${match[2]}`;
                    const language = languageLabelFromCode(langCode);
                    const id = `${langCode}-${results.length}`;
                    if (!results.some((r) => r.downloadUrl === downloadUrl)) {
                        results.push({
                            id,
                            title: rowTitle,
                            language,
                            languageCode: langCode,
                            downloadUrl,
                            downloads: rowDownloads
                        });
                    }
                }
            }
            catch {
                // ignore failed detail page fetches
            }
        }
        // 2. Line-based parsing (new)
        const lines = html.split(/\r?\n/);
        for (const line of lines) {
            const linkMatch = line.match(/href=\"(\/sub\/[^\"]+\.srt)\"/i);
            if (!linkMatch)
                continue;
            const rawUrl = linkMatch[1];
            const downloadUrl = `https://www.subtitlecat.com${rawUrl}`;
            const titleMatch = line.match(/>(SONE-[^<]+)</i) || line.match(/>([^<]{3,})<\/a>/i);
            const title = titleMatch?.[1]?.trim() ?? q;
            const langMatch = line.match(/translated from ([A-Za-z]+)/i) || line.match(/alt=\"([A-Za-z ]{2,30})\"/i);
            const language = langMatch?.[1]?.trim() ?? "Unknown";
            const langCode = language.toLowerCase().slice(0, 2);
            const downloadsMatch = line.match(/(\d[\d,]*)\s*(?:downloads?|dl)\b/i) ||
                line.match(/\u2b07\s*(\d[\d,]*)/i);
            const downloads = downloadsMatch ? Number(downloadsMatch[1].replace(/,/g, "")) : 0;
            const id = `${langCode}-${results.length}`;
            if (!results.some((r) => r.downloadUrl === downloadUrl)) {
                results.push({ id, title, language, languageCode: langCode, downloadUrl, downloads });
            }
        }
        const normalizedQuery = q.toUpperCase();
        return results
            .filter((result) => result.title.toUpperCase().includes(normalizedQuery) || normalizedQuery.includes(result.title.toUpperCase()))
            .sort((left, right) => right.downloads - left.downloads || left.title.localeCompare(right.title))
            .slice(0, 30);
    }
    try {
        let results = await searchOnce(query);
        if (results.length === 0 && query !== query.toUpperCase()) {
            results = await searchOnce(query.toUpperCase());
        }
        return results;
    }
    catch {
        return [];
    }
}
function languageLabelFromCode(code) {
    const normalized = code.toLowerCase();
    if (normalized === "zh-hans")
        return "Chinese Simplified";
    if (normalized === "zh-hant" || normalized === "zh-tw")
        return "Chinese Traditional";
    if (normalized === "zh")
        return "Chinese";
    if (normalized === "en")
        return "English";
    if (normalized === "ja")
        return "Japanese";
    if (normalized === "ko")
        return "Korean";
    if (normalized === "es")
        return "Spanish";
    if (normalized === "fr")
        return "French";
    if (normalized === "de")
        return "German";
    if (normalized === "pt")
        return "Portuguese";
    if (normalized === "ar")
        return "Arabic";
    if (normalized === "ru")
        return "Russian";
    if (normalized === "it")
        return "Italian";
    return code.length > 0 ? code.toUpperCase() : "Unknown";
}
function registerHandlers() {
    electron_1.ipcMain.handle("settings:getGentleShortcut", async () => {
        return database.getGentleShortcut();
    });
    electron_1.ipcMain.handle("settings:setGentleShortcut", async (_event, shortcut) => {
        database.setGentleShortcut(shortcut);
        return true;
    });
    electron_1.ipcMain.handle("gentle:toggle", async () => {
        toggleGentleUnlocked("button");
        return buildShellState();
    });
    electron_1.ipcMain.handle("settings:verifyGentlePin", async (_event, pin) => {
        const result = database.attemptGentlePinVerify(pin);
        const ok = result.ok;
        const message = result.message;
        if (ok) {
            gentleUnlocked = true;
            broadcastGentleState(message);
        }
        return { ok, message };
    });
    electron_1.ipcMain.handle("settings:getThemeMode", async () => {
        return database.getThemeMode();
    });
    electron_1.ipcMain.handle("settings:setThemeMode", async (_event, themeMode) => {
        database.setThemeMode(themeMode);
        return buildShellState();
    });
    electron_1.ipcMain.handle("app:getState", async () => buildShellState());
    electron_1.ipcMain.handle("settings:saveMetadata", async (_event, settings) => {
        database.setMetadataSettings(settings);
        return buildShellState();
    });
    electron_1.ipcMain.handle("settings:saveOrganization", async (_event, settings) => {
        database.setOrganizationSettings(settings);
        return buildShellState();
    });
    electron_1.ipcMain.handle("movies:list", async (_event, args) => {
        return database.listMovies({
            includeGentle: gentleUnlocked,
            query: args?.query ?? "",
            limit: args?.limit ?? 200,
            offset: args?.offset ?? 0,
            sortOrder: args?.sortOrder === "recency" ? "recency" : "rank"
        });
    });
    electron_1.ipcMain.handle("movies:count", async (_event, args) => {
        return database.countMovies({
            includeGentle: gentleUnlocked,
            query: args?.query ?? ""
        });
    });
    // Always returns all movies from both modes — used for actress directory
    electron_1.ipcMain.handle("movies:selectModeIds", (event, mode) => { if (event.sender !== mainWindow?.webContents) throw new Error("Unavailable outside the main app."); return require("../services/modeSelection.cjs").selectModeIds(database, mode, gentleUnlocked); });
    electron_1.ipcMain.handle("movies:listAll", async () => {
        return database.listMovies({ includeGentle: true, query: "", limit: 99999, offset: 0 });
    });
    electron_1.ipcMain.handle("movies:ensurePosters", async (_event, movieIds) => {
        const dedupedIds = Array.from(new Set(movieIds)).filter(Boolean);
        return backfillMoviePosters(dedupedIds);
    });
    electron_1.ipcMain.handle("movies:refreshPosters", async (_event, movieIds) => {
        const dedupedIds = Array.from(new Set(movieIds)).filter(Boolean);
        return backfillMoviePosters(dedupedIds, {
            forceRefresh: true
        });
    });
    electron_1.ipcMain.handle("movies:backfillPosters", async () => {
        const movieIds = database
            .listMovies({
            includeGentle: true,
            query: ""
        })
            .filter((movie) => !movie.posterUrl)
            .map((movie) => movie.id);
        return backfillMoviePosters(movieIds);
    });
    electron_1.ipcMain.handle("movies:pickScan", async (_event, scanOptions) => {
        const targetMode = resolveTargetMode(scanOptions);
        const result = await electron_1.dialog.showOpenDialog(mainWindow, {
            properties: ["openDirectory", "createDirectory"]
        });
        if (result.canceled || result.filePaths.length === 0) {
            emitScanProgress(buildCancelledProgress(targetMode));
            return emptyScanSummary();
        }
        // The picked folder is the SOURCE — don't save it as a library root.
        // Files will be moved into the configured library path (from organization settings).
        // If no library path is configured, the source folder acts as the de-facto root.
        // However, also update roots for completeness (merge logic from incoming branch):
        const currentRoots = database.getRoots();
        const nextRoots = {
            ...currentRoots,
            [targetMode]: Array.from(new Set([
                ...normalizeRootList(currentRoots[targetMode]),
                ...result.filePaths
            ]))
        };
        database.setRoots(nextRoots);
        const rootsToScan = targetMode === "normal"
            ? { normal: result.filePaths, gentle: [] }
            : { normal: [], gentle: result.filePaths };
        activeScanToken = (0, libraryScanner_1.createCancelToken)();
        // Scans add/move/delete many files: drop cached existsSync results so
        // views reflect fresh disk state during and after the scan.
        database.clearFileExistsCache();
        try {
            const summary = await (0, libraryScanner_1.scanLibraries)(database, rootsToScan, {
                mode: targetMode,
                onProgress: emitScanProgress,
                scanOptions,
                cancelToken: activeScanToken
            });
            if (!summary.cancelled) {
                database.appendScanHistory(summary);
            }
            return summary;
        }
        finally {
            activeScanToken = null;
            database.clearFileExistsCache();
        }
    });
    electron_1.ipcMain.handle("movies:scanWholeSystem", async (event, options) => {
        if (event.sender !== mainWindow?.webContents) throw new Error("Unavailable outside the main app.");
        if (activeScanToken) throw new Error("A scan is already running.");
        const mode = resolveTargetMode(options);
        if (mode === "gentle" && !gentleUnlocked) throw new Error("Unlock Gentle mode before scanning into it.");
        const scanner = require("../services/wholeSystemScan.cjs");
        activeScanToken = { cancelled: false };
        database.clearFileExistsCache();
        emitScanProgress({ stage: "preparing", mode, currentRoot: null, currentFile: null, processedFiles: 0, totalFiles: 0, imported: 0, skipped: 0, message: "Whole-system scan: finding connected drives..." });
        try {
            const roots = await scanner.connectedDrives({ cancelToken: activeScanToken });
            const summary = await scanner.scanWholeSystem(database, { roots, validateComplete: options?.importOnlyCompleteVideos !== false, autoConvertToMp4: Boolean(options?.autoConvertToMp4), autoResolveDuplicates: Boolean(options?.autoResolveDuplicates), mode, cancelToken: activeScanToken, onProgress: emitScanProgress, excludedPaths: [electron_1.app.getPath("userData")] });
            if (!summary.cancelled) database.appendScanHistory(summary);
            return summary;
        } catch (error) { emitScanProgress({ stage: "cancelled", mode, currentRoot: null, currentFile: null, processedFiles: 0, totalFiles: 0, imported: 0, skipped: 0, message: error.message || "Whole-system scan stopped." }); throw error; } finally { activeScanToken = null; database.clearFileExistsCache(); }
    });
    electron_1.ipcMain.handle("movies:scan", async (_event, options) => {
        activeScanToken = (0, libraryScanner_1.createCancelToken)();
        // Scans add/move/delete many files: drop cached existsSync results so
        // views reflect fresh disk state during and after the scan.
        database.clearFileExistsCache();
        try {
            const summary = await (0, libraryScanner_1.scanLibraries)(database, database.getRoots(), {
                mode: "all",
                onProgress: emitScanProgress,
                scanOptions: options ?? libraryScanner_1.DEFAULT_SCAN_OPTIONS,
                cancelToken: activeScanToken
            });
            if (!summary.cancelled) {
                database.appendScanHistory(summary);
            }
            return summary;
        }
        finally {
            activeScanToken = null;
            database.clearFileExistsCache();
        }
    });
    electron_1.ipcMain.handle("scan:cancel", () => {
        if (activeScanToken) {
            activeScanToken.cancelled = true;
        }
    });
    electron_1.ipcMain.handle("library:addRoot", async (_event, mode) => {
        const result = await electron_1.dialog.showOpenDialog(mainWindow, {
            properties: ["openDirectory", "createDirectory"]
        });
        if (!result.canceled && result.filePaths.length > 0) {
            const roots = database.getRoots();
            database.setRoots({
                ...roots,
                [mode]: Array.from(new Set([
                    ...normalizeRootList(roots[mode]),
                    ...result.filePaths
                ]))
            });
        }
        return buildShellState();
    });
    electron_1.ipcMain.handle("settings:pickLibraryFolder", async () => {
        const result = await electron_1.dialog.showOpenDialog(mainWindow, {
            title: "Choose library storage folder",
            properties: ["openDirectory", "createDirectory"]
        });
        if (result.canceled || result.filePaths.length === 0) {
            return null;
        }
        return result.filePaths[0];
    });
    electron_1.ipcMain.handle("shell:openFile", async (_event, filePath) => {
        await electron_1.shell.openPath(filePath);
    });
    electron_1.ipcMain.handle("shell:showInFolder", (_event, filePath) => {
        electron_1.shell.showItemInFolder(filePath);
    });
    electron_1.ipcMain.handle("movies:moveMode", async (_event, movieId, mode) => {
        return (0, fileService_1.moveMovieToMode)(database, movieId, mode);
    });
    electron_1.ipcMain.handle("movies:batchMoveMode", async (_event, movieIds, mode) => {
        const moved = [];
        for (const movieId of movieIds) {
            moved.push(await (0, fileService_1.moveMovieToMode)(database, movieId, mode));
        }
        return moved;
    });
    electron_1.ipcMain.handle("duplicates:resolve", async (_event, keepPath, deletePaths, gentleUnlocked) => {
        let deleted = 0;
        let blocked = 0;
        let unregistered = 0;
        for (const p of deletePaths) {
            try {
                const movieId = database.findMovieIdBySourcePath(p);
                // Only files the library actually tracks may be deleted. This keeps a
                // compromised renderer from unlinking arbitrary filesystem paths.
                if (!movieId) {
                    unregistered += 1;
                    continue;
                }
                const movie = database.getMovie(movieId);
                if (movie && movie.libraryMode === "gentle" && !gentleUnlocked) {
                    blocked += 1;
                    continue;
                }
                try {
                    await promises_1.default.unlink(p);
                }
                catch {
                    // ignore error
                }
                database.deleteMovie(movieId);
                deleted += 1;
            }
            catch (error) {
                // ignore individual delete errors but proceed
                // eslint-disable-next-line no-console
                console.error(`Failed to delete duplicate ${p}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        return { deleted, blocked, unregistered };
    });
    electron_1.ipcMain.handle("settings:getFtsHealth", () => {
        return database.getFtsHealth();
    });
    electron_1.ipcMain.handle("settings:rebuildFtsIndex", () => {
        return database.rebuildFtsIndexNow();
    });
    electron_1.ipcMain.handle("movies:sweepMissing", async () => {
        // sweepMissingMovies also reconciles the internal fileExistsCache.
        return database.sweepMissingMoviesAsync();
    });
    electron_1.ipcMain.handle("movies:forgetMissing", async (_event, movieId) => {
        // Only allow forgetting rows that are *currently* missing — a fresh check,
        // not a client-trusted flag, so a compromised renderer can't use this
        // channel to delete arbitrary registered movies.
        const missing = database.listMissingMovies();
        if (!missing.some((movie) => movie.id === movieId)) {
            return { deleted: false };
        }
        database.deleteMovie(movieId);
        return { deleted: true };
    });
    electron_1.ipcMain.handle("movies:relinkMissing", async (_event, movieId) => {
        // The caller supplies only a movie id: the file picker runs here in main.
        const movie = database.getMovie(movieId);
        if (!movie) {
            return { ok: false, sourcePath: null, error: "Movie not found." };
        }
        const result = await electron_1.dialog.showOpenDialog(mainWindow, {
            title: `Relink "${movie.title}" to its new video file`,
            properties: ["openFile"],
            filters: [{ name: "Video files", extensions: contracts_1.VIDEO_EXTENSIONS.map((ext) => ext.slice(1)) }]
        });
        if (result.canceled || result.filePaths.length === 0) {
            return { ok: false, sourcePath: null, error: null }; // user cancelled
        }
        const chosenPath = result.filePaths[0];
        if (!node_fs_1.default.existsSync(chosenPath)) {
            return { ok: false, sourcePath: null, error: "Selected file does not exist." };
        }
        const extension = node_path_1.default.extname(chosenPath).toLowerCase();
        if (!contracts_1.VIDEO_EXTENSIONS.includes(extension)) {
            return {
                ok: false,
                sourcePath: null,
                error: `Not a video file (${contracts_1.VIDEO_EXTENSIONS.join(", ")}).`
            };
        }
        database.relinkMovieSourcePath(movieId, {
            sourcePath: chosenPath,
            folderPath: node_path_1.default.dirname(chosenPath)
        });
        const relinked = database.getMovie(movieId);
        return { ok: true, sourcePath: relinked?.sourcePath ?? chosenPath, error: null };
    });
    electron_1.ipcMain.handle("auth:toggleGentle", async () => {
        gentleUnlocked = !gentleUnlocked;
        return buildShellState();
    });
    electron_1.ipcMain.handle("auth:unlockGentle", async (_event, pin) => {
        const result = database.attemptGentlePinVerify(pin);
        const ok = result.ok;
        const message = result.message;
        if (ok) {
            gentleUnlocked = true;
            broadcastGentleState(message);
        }
        return { ok, message };
    });
    electron_1.ipcMain.handle("actress:getPhotos", async () => {
        return database.getAllActressPhotos();
    });
    electron_1.ipcMain.handle("actress:getRegions", async () => {
        return database.getActressRegions();
    });
    electron_1.ipcMain.handle("actress:getRegion", async (_event, name) => {
        return database.getActressRegion(name);
    });
    electron_1.ipcMain.handle("actress:listPhotos", async (_event, name) => {
        return database.getActressPhotos(name);
    });
    electron_1.ipcMain.handle("actress:refreshPhotos", async () => {
        const { enrichActressPhotos } = await Promise.resolve().then(() => __importStar(require("../services/metadataService.js")));
        const allMovies = database.listMovies({ includeGentle: true, query: "" });
        const names = new Set();
        for (const movie of allMovies) {
            for (const name of movie.actresses) {
                if (name.trim())
                    names.add(name);
            }
        }
        await enrichActressPhotos(database, Array.from(names));
        return database.getAllActressPhotos();
    });
    electron_1.ipcMain.handle("actress:setPhoto", async (_event, name) => {
        // Let the user pick an image file and store a file:// URL in DB
        const result = await electron_1.dialog.showOpenDialog(mainWindow, {
            title: `Choose photo for ${name}`,
            properties: ["openFile"],
            filters: [
                { name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif"] },
            ],
        });
        if (result.canceled || result.filePaths.length === 0) {
            return database.getAllActressPhotos();
        }
        const picked = result.filePaths[0];
        const normalized = picked.replace(/\\/g, "/");
        const url = `file:///${normalized}`;
        database.addActressPhoto(name, url);
        database.setActressPhoto(name, url);
        return database.getAllActressPhotos();
    });
    electron_1.ipcMain.handle("actress:setRegion", async (_event, name, region) => {
        database.setActressRegion(name, region);
        return database.getActressRegions();
    });
    electron_1.ipcMain.handle("actress:removePhoto", async (_event, name, photoUrl) => {
        database.removeActressPhoto(name, photoUrl);
        return database.getAllActressPhotos();
    });
    electron_1.ipcMain.handle("actress:setPrimaryPhoto", async (_event, name, photoUrl) => {
        database.setPrimaryActressPhoto(name, photoUrl);
        return database.getAllActressPhotos();
    });
    electron_1.ipcMain.handle("player:fetchSubtitles", async (_event, dvdId) => {
        return fetchSubtitleCatResults(dvdId);
    });
    electron_1.ipcMain.handle("player:downloadSubtitle", async (_event, url) => {
        try {
            if (url.startsWith("file://")) {
                return await promises_1.default.readFile((0, node_url_1.fileURLToPath)(url), "utf8");
            }
            if (url.startsWith("mla-media:")) {
                const filePath = (0, node_url_1.fileURLToPath)(url.replace(/^mla-media:/, "file:"));
                return await promises_1.default.readFile(filePath, "utf8");
            }
            const response = await fetch(url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                }
            });
            if (!response.ok)
                return null;
            return await response.text();
        }
        catch {
            return null;
        }
    });
    electron_1.ipcMain.handle("player:installSubtitle", async (_event, movieId, language, content) => {
        const movie = database.getMovie(movieId);
        if (!movie) {
            throw new Error("Movie not found.");
        }
        const targetPath = (0, libraryLayout_1.buildTargetSubtitlePath)({
            directory: movie.folderPath,
            title: movie.title,
            year: movie.year,
            videoId: movie.videoId,
            actresses: movie.actresses,
            modelName: movie.videoId?.split("-")[0] ?? null,
            language,
            extension: ".srt",
            subtitleCount: Math.max(movie.subtitles.length + 1, 1),
            resolveLongPath: true,
            organizationSettings: database.getOrganizationSettings()
        });
        await promises_1.default.mkdir(node_path_1.default.dirname(targetPath), { recursive: true });
        await promises_1.default.writeFile(targetPath, content, "utf8");
        database.upsertSubtitle(movieId, targetPath, language);
        return targetPath;
    });
    electron_1.ipcMain.handle("player:getSettings", () => {
        return database.getPlayerSettings();
    });
    electron_1.ipcMain.handle("player:saveSettings", (_event, settings) => {
        database.setPlayerSettings(settings);
        return settings;
    });
    electron_1.ipcMain.handle("player:getPlaybackCheckpoint", (_event, movieId) => {
        return database.getPlaybackCheckpoint(movieId);
    });
    electron_1.ipcMain.handle("player:savePlaybackCheckpoint", (_event, movieId, positionSeconds) => {
        return database.savePlaybackCheckpoint(movieId, positionSeconds);
    });
    electron_1.ipcMain.handle("player:clearPlaybackCheckpoint", (_event, movieId) => {
        database.clearPlaybackCheckpoint(movieId);
    });
    electron_1.ipcMain.handle("player:getFileUrl", (_event, filePath, folderPath) => {
        const resolvedPath = node_path_1.default.isAbsolute(filePath)
            ? filePath
            : folderPath
                ? node_path_1.default.join(folderPath, filePath)
                : filePath;
        const fileUrl = (0, node_url_1.pathToFileURL)(node_path_1.default.resolve(resolvedPath)).href;
        return fileUrl.replace(/^file:/, "mla-media:");
    });
    electron_1.ipcMain.handle("player:convertToMp4", async (_event, filePath) => {
        try {
            const outputPath = buildTranscodeOutputPath(filePath);
            if (!node_fs_1.default.existsSync(outputPath) || node_fs_1.default.statSync(outputPath).size === 0) {
                await (0, ffmpegService_1.runFfmpeg)([
                    "-y",
                    "-i",
                    filePath,
                    "-c:v",
                    "libx264",
                    "-preset",
                    "veryfast",
                    "-crf",
                    "23",
                    "-pix_fmt",
                    "yuv420p",
                    "-c:a",
                    "aac",
                    "-b:a",
                    "192k",
                    outputPath
                ]);
            }
            const fileUrl = (0, node_url_1.pathToFileURL)(outputPath).href;
            return { ok: true, url: fileUrl.replace(/^file:/, "mla-media:") };
        }
        catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : "Unknown conversion error"
            };
        }
    });
    electron_1.ipcMain.handle("subtitle:generateForMovie", async (_event, movieId, options) => {
        const movie = database.getMovie(movieId);
        if (!movie) {
            return {
                ok: false,
                message: "Movie not found.",
                subtitlePath: null,
                detectedLanguage: null,
                setupRequired: false
            };
        }
        return runSubtitleGeneration(movie, options);
    });
    electron_1.ipcMain.handle("subtitle:getModelAvailability", async (_event, model) => {
        return getSubtitleModelAvailability(model);
    });
    electron_1.ipcMain.handle("subtitle:downloadModel", async (_event, model) => {
        return downloadSubtitleModel(model);
    });
    electron_1.ipcMain.handle("subtitle:previewOutput", async (_event, movieId, options) => {
        const movie = database.getMovie(movieId);
        if (!movie) {
            return {
                outputPath: null,
                message: "Movie not found."
            };
        }
        return resolveSubtitleOutputPath(movie, options);
    });
}
electron_1.app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
electron_1.app.commandLine.appendSwitch("disable-http-cache");
const userDataOverride = process.env.MLA_USER_DATA_DIR?.trim();
if (userDataOverride) {
    electron_1.app.setPath("userData", node_path_1.default.resolve(userDataOverride));
}
electron_1.app.whenReady().then(() => {
    const databasePath = node_path_1.default.join(electron_1.app.getPath("userData"), "mla-plus.db");
    database = new database_1.DatabaseClient(databasePath);
    require("../services/subtitleWorkspace.cjs").registerSubtitleWorkspace({ ipcMain: electron_1.ipcMain, getDatabase: () => database, getWindow: () => mainWindow, isGentleUnlocked: () => gentleUnlocked });
    require("../services/deviceShare.cjs").registerDeviceSharing({ app: electron_1.app, ipcMain: electron_1.ipcMain, getDatabase: () => database, getWindow: () => mainWindow });
    // Periodically fresh-stat source paths so the persisted source_missing flag
    // (used by the SQL search filter) tracks reality.
    database.startMissingSweepTimer();
    electron_1.protocol.registerFileProtocol("mla-media", (request, callback) => {
        try {
            const parsed = new URL(request.url);
            let filePath;
            if (process.platform === "win32" && /^[a-z]$/i.test(parsed.hostname)) {
                const drive = `${parsed.hostname.toUpperCase()}:`;
                const normalizedPath = decodeURIComponent(parsed.pathname).replace(/\//g, node_path_1.default.sep);
                filePath = node_path_1.default.normalize(`${drive}${normalizedPath}`);
            }
            else if (process.platform === "win32" && /^\/[a-z]:/i.test(parsed.pathname)) {
                filePath = node_path_1.default.normalize(decodeURIComponent(parsed.pathname.slice(1)).replace(/\//g, node_path_1.default.sep));
            }
            else {
                const fileUrl = request.url.replace(/^mla-media:/, "file:");
                filePath = (0, node_url_1.fileURLToPath)(fileUrl);
            }
            callback({ path: filePath });
        }
        catch {
            callback({ error: -6 });
        }
    });
    registerHandlers();
    createWindow();
    electron_1.app.on("activate", () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        electron_1.app.quit();
    }
});
electron_1.app.on("before-quit", () => {
    database?.stopMissingSweepTimer();
    database?.close();
});
