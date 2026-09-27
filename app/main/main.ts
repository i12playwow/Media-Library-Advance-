import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { spawn } from "node:child_process";
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron";
import { DatabaseClient } from "../database/database";
import { moveMovieToMode } from "../services/fileService";
import { buildTargetSubtitlePath } from "../services/libraryLayout";
import { DEFAULT_SCAN_OPTIONS, scanLibraries, createCancelToken, registerLocalFiles, type CancelToken } from "../services/libraryScanner";
import { extractSubtitleLanguage } from "../services/libraryScanner";
import { readGuardsChainState } from "../services/guardsChain";
import { SUBTITLE_EXTENSIONS } from "../shared/contracts";
import { enrichMoviePoster } from "../services/metadataService";
import { runFfmpeg } from "../services/ffmpegService";
import type {
  AppShellState,
  MetadataSettings,
  LibraryMode,
  LibraryRoots,
  MovieRecord,
  OnlineSubtitleResult,
  OrganizationSettings,
  PlayerSettings,
  PosterBackfillSummary,
  ScanAutomationOptions,
  ScanMode,
  ScanProgress,
  ScanSummary,
  SubtitleScanResult,
  SubtitleModelAvailability,
  SubtitleModelDownloadProgress,
  SubtitleModelDownloadResult,
  SubtitleGenerationOptions,
  SubtitleGenerationPreview,
  SubtitleGenerationResult
} from "../shared/contracts";

let mainWindow: BrowserWindow | null = null;
let database: DatabaseClient;
let gentleUnlocked = false;
let activeScanToken: CancelToken | null = null;
const activeSubtitleModelDownloads = new Map<SubtitleGenerationOptions["model"], Promise<SubtitleModelDownloadResult>>();

function broadcastGentleState(message: string): void {
  mainWindow?.show();
  mainWindow?.focus();
  mainWindow?.webContents.send("gentle:unlockResult", {
    ok: true,
    message
  });
}

function toggleGentleUnlocked(reason: string): boolean {
  gentleUnlocked = !gentleUnlocked;
  broadcastGentleState(
    gentleUnlocked
      ? `Gentle library enabled for this session (${reason}).`
      : `Gentle library disabled for this session (${reason}).`
  );
  return gentleUnlocked;
}

protocol.registerSchemesAsPrivileged([{
  scheme: "mla-media",
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true
  }
}]);

function resolveAppIconPath(): string {
  return path.join(app.getAppPath(), "resources", "icon.png");
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    title: "MLA+",
    icon: resolveAppIconPath(),
    backgroundColor: "#0f1217",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
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

function buildShellState(): AppShellState {
  return {
    version: app.getVersion(),
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

function emitScanProgress(progress: ScanProgress): void {
  mainWindow?.webContents.send("scan:progress", progress);
}

function emptyScanSummary(scannedRoots?: LibraryRoots): ScanSummary {
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

function buildCancelledProgress(mode: ScanMode): ScanProgress {
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

function buildTranscodeOutputPath(sourcePath: string): string {
  const cacheDir = path.join(app.getPath("userData"), "player-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const stat = fs.statSync(sourcePath);
  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  const safeBase = baseName.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "video";
  const signature = `${stat.size}-${Math.floor(stat.mtimeMs)}`;
  return path.join(cacheDir, `${safeBase}-${signature}.mp4`);
}

function resolveTargetMode(options: ScanAutomationOptions): LibraryMode {
  if (options.addToNormalModeLibrary === options.addToGentleModeLibrary) {
    throw new Error("Select either Normal Mode library or Gentle Mode library.");
  }

  return options.addToGentleModeLibrary ? "gentle" : "normal";
}

function normalizeRootList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return [value];
  }

  return [];
}

function emptyPosterBackfillSummary(requested: number): PosterBackfillSummary {
  return {
    requested,
    updated: 0,
    skipped: 0,
    errors: []
  };
}

function resolveSubGenScriptPath(): string {
  return path.join(app.getAppPath(), "resources", "subgen", "generate_subtitles.py");
}

function resolveSubGenModelsRoot(): string {
  return path.join(app.getPath("userData"), "subgen-models");
}

function buildSubGenSetupMessage(detail?: string): string {
  const suffix = detail ? ` ${detail}` : "";
  return `Sub-Gen needs a working Python install plus faster-whisper and huggingface_hub. Install the packages from resources/subgen/requirements.txt, then try again.${suffix}`;
}

function emitSubtitleModelDownloadProgress(progress: SubtitleModelDownloadProgress): void {
  mainWindow?.webContents.send("subtitle:modelDownloadProgress", progress);
}

function isSubtitleSetupRequiredMessage(output: string): boolean {
  const lowered = output.toLowerCase();
  return lowered.includes("no module named") || lowered.includes("python was not found") || lowered.includes("not recognized");
}

function parseSubtitleScriptPayload(line: string): { event?: string; progress?: SubtitleModelDownloadProgress; result?: unknown } | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as { event?: string; progress?: SubtitleModelDownloadProgress; result?: unknown };
  } catch {
    return null;
  }
}

function extractSubtitleScriptResult<T>(stdout: string): T | null {
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
      return (payload.result as T) ?? null;
    }

    return payload as T;
  }

  return null;
}

async function getSubtitleModelAvailability(model: SubtitleGenerationOptions["model"]): Promise<SubtitleModelAvailability> {
  const scriptPath = resolveSubGenScriptPath();
  const modelsRoot = resolveSubGenModelsRoot();
  try {
    await fsp.access(scriptPath);
  } catch {
    return {
      model,
      available: false,
      modelPath: null,
      message: buildSubGenSetupMessage("The generator script was not found.")
    };
  }

  return new Promise<SubtitleModelAvailability>((resolve) => {
    const child = spawn("python", [scriptPath, "check-model", "--model", model, "--models-root", modelsRoot], {
      cwd: app.getAppPath(),
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
        model,
        available: false,
        modelPath: null,
        message: buildSubGenSetupMessage(error.message)
      });
    });
    child.on("close", () => {
      const result = extractSubtitleScriptResult<SubtitleModelAvailability>(stdout);
      if (result) {
        resolve(result);
        return;
      }

      resolve({
        model,
        available: false,
        modelPath: null,
        message: stderr.trim() || "Unable to check the selected Whisper model."
      });
    });
  });
}

async function downloadSubtitleModel(model: SubtitleGenerationOptions["model"]): Promise<SubtitleModelDownloadResult> {
  const activeDownload = activeSubtitleModelDownloads.get(model);
  if (activeDownload) {
    return activeDownload;
  }

  const downloadPromise = (async (): Promise<SubtitleModelDownloadResult> => {
    const scriptPath = resolveSubGenScriptPath();
    const modelsRoot = resolveSubGenModelsRoot();
    try {
      await fsp.access(scriptPath);
    } catch {
      return {
        ok: false,
        model,
        available: false,
        modelPath: null,
        message: buildSubGenSetupMessage("The generator script was not found."),
        setupRequired: true
      };
    }

    return new Promise<SubtitleModelDownloadResult>((resolve) => {
      const child = spawn("python", [scriptPath, "download-model", "--model", model, "--models-root", modelsRoot], {
        cwd: app.getAppPath(),
        windowsHide: true
      });
      let stdout = "";
      let stderr = "";
      let stdoutBuffer = "";
      let finalResult: SubtitleModelDownloadResult | null = null;

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
            finalResult = payload.result as SubtitleModelDownloadResult;
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
          } else if (payload?.event === "result") {
            finalResult = payload.result as SubtitleModelDownloadResult;
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
  } finally {
    activeSubtitleModelDownloads.delete(model);
  }
}

function normalizeSubtitleOutputFileName(value: string): string {
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

function resolveSubtitleOutputPath(movie: MovieRecord, options: SubtitleGenerationOptions): SubtitleGenerationPreview {
  const targetPath = buildTargetSubtitlePath({
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
  const targetDirectory =
    options.outputMode === "custom-directory"
      ? options.outputDirectory?.trim() ?? ""
      : path.dirname(targetPath);
  const finalTargetPath =
    options.outputMode === "output-srt"
      ? path.join(movie.folderPath, "output.srt")
      : options.outputMode === "custom-directory"
        ? options.outputDirectory?.trim()
          ? path.join(options.outputDirectory.trim(), customFileName || path.basename(targetPath))
          : ""
        : customFileName
          ? path.join(path.dirname(targetPath), customFileName)
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

async function runSubtitleGeneration(movie: MovieRecord, options: SubtitleGenerationOptions): Promise<SubtitleGenerationResult> {
  const scriptPath = resolveSubGenScriptPath();
  const modelsRoot = resolveSubGenModelsRoot();
  try {
    await fsp.access(scriptPath);
  } catch {
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

  return new Promise<SubtitleGenerationResult>((resolve) => {
    const child = spawn("python", args, {
      cwd: app.getAppPath(),
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
        const payload = JSON.parse(stdout.trim()) as { output: string; detected_language?: string | null };
        const detectedLanguage = payload.detected_language?.trim() || (options.language === "auto" ? "und" : options.language);
        database.upsertSubtitle(movie.id, payload.output, detectedLanguage);
        resolve({
          ok: true,
          message: `Subtitle generated at ${payload.output}`,
          subtitlePath: payload.output,
          detectedLanguage,
          setupRequired: false
        });
      } catch {
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

async function backfillMoviePosters(
  movieIds: string[],
  options?: {
    forceRefresh?: boolean;
  }
): Promise<PosterBackfillSummary> {
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
      const posterUrl = await enrichMoviePoster(database, movie.id, metadataSettings, {
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
      } else {
        summary.skipped += 1;
      }
    } catch (error) {
      summary.skipped += 1;
      summary.errors.push(
        `${movie.sourcePath} - ${error instanceof Error ? error.message : "Poster backfill failed."}`
      );
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

async function fetchSubtitleCatResults(query: string): Promise<OnlineSubtitleResult[]> {
  async function searchOnce(q: string): Promise<OnlineSubtitleResult[]> {
    const url = `https://www.subtitlecat.com/index.php?search=${encodeURIComponent(q)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
      }
    });
    if (!response.ok) return [];
    const html = await response.text();
    const results: OnlineSubtitleResult[] = [];

    // Merge both subtitle row parsing strategies for robustness
    // 1. Table row regex (original)
    const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
    const rows = html.match(rowRegex) ?? [];
    for (const row of rows) {
      const pageLinkMatch = row.match(/href="(subs\/[^"]+\.html)"/i);
      if (!pageLinkMatch) continue;
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
        if (!detailResponse.ok) continue;
        const detailHtml = await detailResponse.text();
        const detailMatches = Array.from(
          detailHtml.matchAll(
            /<a[^>]+id="download_([a-z]{2}(?:-[A-Z]{2})?)"[^>]+href="([^"]+\.srt[^"]*)"[^>]*>(?:Download)?<\/a>/gi
          )
        );
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
      } catch {
        // ignore failed detail page fetches
      }
    }

    // 2. Line-based parsing (new)
    const lines = html.split(/\r?\n/);
    for (const line of lines) {
      const linkMatch = line.match(/href=\"(\/sub\/[^\"]+\.srt)\"/i);
      if (!linkMatch) continue;
      const rawUrl = linkMatch[1];
      const downloadUrl = `https://www.subtitlecat.com${rawUrl}`;
      const titleMatch = line.match(/>(SONE-[^<]+)</i) || line.match(/>([^<]{3,})<\/a>/i);
      const title = titleMatch?.[1]?.trim() ?? q;
      const langMatch = line.match(/translated from ([A-Za-z]+)/i) || line.match(/alt=\"([A-Za-z ]{2,30})\"/i);
      const language = langMatch?.[1]?.trim() ?? "Unknown";
      const langCode = language.toLowerCase().slice(0, 2);
      const downloadsMatch =
        line.match(/(\d[\d,]*)\s*(?:downloads?|dl)\b/i) ||
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
  } catch {
    return [];
  }
}

function languageLabelFromCode(code: string): string {
  const normalized = code.toLowerCase();
  if (normalized === "zh-hans") return "Chinese Simplified";
  if (normalized === "zh-hant" || normalized === "zh-tw") return "Chinese Traditional";
  if (normalized === "zh") return "Chinese";
  if (normalized === "en") return "English";
  if (normalized === "ja") return "Japanese";
  if (normalized === "ko") return "Korean";
  if (normalized === "es") return "Spanish";
  if (normalized === "fr") return "French";
  if (normalized === "de") return "German";
  if (normalized === "pt") return "Portuguese";
  if (normalized === "ar") return "Arabic";
  if (normalized === "ru") return "Russian";
  if (normalized === "it") return "Italian";
  return code.length > 0 ? code.toUpperCase() : "Unknown";
}

function registerHandlers(): void {
    ipcMain.handle("settings:getGentleShortcut", async () => {
      return database.getGentleShortcut();
    });

  ipcMain.handle("settings:setGentleShortcut", async (_event, shortcut: string) => {
    database.setGentleShortcut(shortcut);
    return true;
  });

  ipcMain.handle("gentle:toggle", async () => {
    toggleGentleUnlocked("button");
    return buildShellState();
  });

  ipcMain.handle("settings:verifyGentlePin", async (_event, pin: string) => {
    const ok = database.verifyGentlePin(pin);
    const message = ok
      ? "Gentle library unlocked with PIN."
      : "Incorrect PIN.";

    if (ok) {
      gentleUnlocked = true;
      broadcastGentleState(message);
    }

    return { ok, message };
  });

  ipcMain.handle("settings:getThemeMode", async () => {
    return database.getThemeMode();
  });

  ipcMain.handle("settings:setThemeMode", async (_event, themeMode: "dark" | "light") => {
    database.setThemeMode(themeMode);
    return buildShellState();
  });

  ipcMain.handle("app:getState", async () => buildShellState());

  // ── Guards chain state (Settings → System) ─────────────────────────────────
  // The renderer never reads the log from disk itself; main verifies the
  // tamper-evident chain at read time through the same replay the doc-drift
  // lint performs, so the GUI shows the state npm test would compute.
  ipcMain.handle("guards:getChainState", async () => readGuardsChainState());

  ipcMain.handle("settings:saveMetadata", async (_event, settings: MetadataSettings) => {
    database.setMetadataSettings(settings);
    return buildShellState();
  });

  ipcMain.handle(
    "settings:saveOrganization",
    async (_event, settings: OrganizationSettings) => {
      database.setOrganizationSettings(settings);
      return buildShellState();
    }
  );

  ipcMain.handle("movies:list", async (_event, args?: { query?: string; limit?: number; offset?: number }) => {
    return database.listMovies({
      includeGentle: gentleUnlocked,
      query: args?.query ?? "",
      limit: args?.limit ?? 200,
      offset: args?.offset ?? 0
    });
  });

  ipcMain.handle("movies:count", async (_event, args?: { query?: string }) => {
    return database.countMovies({
      includeGentle: gentleUnlocked,
      query: args?.query ?? ""
    });
  });

  // Always returns all movies from both modes — used for actress directory
  ipcMain.handle("movies:listAll", async () => {
    return database.listMovies({ includeGentle: true, query: "", limit: 99999, offset: 0 });
  });

  ipcMain.handle("movies:ensurePosters", async (_event, movieIds: string[]) => {
    const dedupedIds = Array.from(new Set(movieIds)).filter(Boolean);
    return backfillMoviePosters(dedupedIds);
  });

  ipcMain.handle("movies:refreshPosters", async (_event, movieIds: string[]) => {
    const dedupedIds = Array.from(new Set(movieIds)).filter(Boolean);
    return backfillMoviePosters(dedupedIds, {
      forceRefresh: true
    });
  });

  ipcMain.handle("movies:backfillPosters", async () => {
    const movieIds = database
      .listMovies({
        includeGentle: true,
        query: ""
      })
      .filter((movie) => !movie.posterUrl)
      .map((movie) => movie.id);

    return backfillMoviePosters(movieIds);
  });

  ipcMain.handle("movies:pickScan", async (_event, scanOptions: ScanAutomationOptions) => {
    const targetMode = resolveTargetMode(scanOptions);
    const result = await dialog.showOpenDialog(mainWindow!, {
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
      [targetMode]: Array.from(
        new Set([
          ...normalizeRootList(currentRoots[targetMode]),
          ...result.filePaths
        ])
      )
    };
    database.setRoots(nextRoots);
    const rootsToScan: LibraryRoots =
      targetMode === "normal"
        ? { normal: result.filePaths, gentle: [] }
        : { normal: [], gentle: result.filePaths };

    activeScanToken = createCancelToken();
    try {
      const summary = await scanLibraries(database, rootsToScan, {
        mode: targetMode,
        onProgress: emitScanProgress,
        scanOptions,
        cancelToken: activeScanToken
      });
      if (!summary.cancelled) {
        database.appendScanHistory(summary);
      }
      return summary;
    } finally {
      activeScanToken = null;
    }
  });

  ipcMain.handle("movies:scan", async (_event, options?: ScanAutomationOptions) => {
    activeScanToken = createCancelToken();
    try {
      const summary = await scanLibraries(database, database.getRoots(), {
        mode: "all",
        onProgress: emitScanProgress,
        scanOptions: options ?? DEFAULT_SCAN_OPTIONS,
        cancelToken: activeScanToken
      });
      if (!summary.cancelled) {
        database.appendScanHistory(summary);
      }
      return summary;
    } finally {
      activeScanToken = null;
    }
  });

  ipcMain.handle("scan:cancel", () => {
    if (activeScanToken) {
      activeScanToken.cancelled = true;
    }
  });

  ipcMain.handle("library:addRoot", async (_event, mode: LibraryMode) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory", "createDirectory"]
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const roots = database.getRoots();
      database.setRoots({
        ...roots,
        [mode]: Array.from(
          new Set([
            ...normalizeRootList(roots[mode]),
            ...result.filePaths
          ])
        )
      });
    }

    return buildShellState();
  });

  ipcMain.handle("settings:pickLibraryFolder", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Choose library storage folder",
      properties: ["openDirectory", "createDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle("shell:openFile", async (_event, filePath: string) => {
    await shell.openPath(filePath);
  });

  ipcMain.handle("shell:showInFolder", (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle(
    "movies:moveMode",
    async (_event, movieId: string, mode: LibraryMode) => {
      return moveMovieToMode(database, movieId, mode);
    }
  );

  ipcMain.handle(
    "movies:batchMoveMode",
    async (_event, movieIds: string[], mode: LibraryMode) => {
      const moved: MovieRecord[] = [];
      for (const movieId of movieIds) {
        moved.push(await moveMovieToMode(database, movieId, mode));
      }
      return moved;
    }
  );

  ipcMain.handle(
    "duplicates:resolve",
    async (_event, keepPath: string, deletePaths: string[], gentleUnlocked?: boolean) => {
      let deleted = 0;
      let blocked = 0;
      for (const p of deletePaths) {
        try {
          const movieId = database.findMovieIdBySourcePath(p);
          const movie = movieId ? database.getMovie(movieId) : null;

          if (movie && movie.libraryMode === "gentle" && !gentleUnlocked) {
            blocked += 1;
            continue;
          }

          try {
            await fsp.unlink(p);
          } catch {
            // ignore error
          }

          if (movieId) {
            database.deleteMovie(movieId);
          }

          deleted += 1;
        } catch (error) {
          // ignore individual delete errors but proceed
          // eslint-disable-next-line no-console
          console.error(`Failed to delete duplicate ${p}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      return { deleted, blocked };
    }
  );

  ipcMain.handle("auth:toggleGentle", async () => {
    gentleUnlocked = !gentleUnlocked;
    return buildShellState();
  });

  ipcMain.handle("auth:unlockGentle", async (_event, pin: string) => {
    const ok = database.verifyGentlePin(pin);
    const message = ok
      ? "Gentle library unlocked with PIN."
      : "Incorrect PIN.";

    if (ok) {
      gentleUnlocked = true;
      broadcastGentleState(message);
    }

    return { ok, message };
  });

  ipcMain.handle("actress:getPhotos", async () => {
    return database.getAllActressPhotos();
  });

  ipcMain.handle("actress:getRegions", async () => {
    return database.getActressRegions();
  });

  ipcMain.handle("actress:getRegion", async (_event, name: string) => {
    return database.getActressRegion(name);
  });

  ipcMain.handle("actress:listPhotos", async (_event, name: string) => {
    return database.getActressPhotos(name);
  });

  ipcMain.handle("actress:refreshPhotos", async () => {
    const { enrichActressPhotos } = await import("../services/metadataService.js");
    const allMovies = database.listMovies({ includeGentle: true, query: "" });
    const names = new Set<string>();
    for (const movie of allMovies) {
      for (const name of movie.actresses) {
        if (name.trim()) names.add(name);
      }
    }
    await enrichActressPhotos(database, Array.from(names));
    return database.getAllActressPhotos();
  });

  ipcMain.handle("actress:setPhoto", async (_event, name: string) => {
    // Let the user pick an image file and store a file:// URL in DB
    const result = await dialog.showOpenDialog(mainWindow!, {
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

  ipcMain.handle("actress:setRegion", async (_event, name: string, region: string) => {
    database.setActressRegion(name, region);
    return database.getActressRegions();
  });

  ipcMain.handle("actress:removePhoto", async (_event, name: string, photoUrl?: string) => {
    database.removeActressPhoto(name, photoUrl);
    return database.getAllActressPhotos();
  });

  ipcMain.handle("actress:setPrimaryPhoto", async (_event, name: string, photoUrl: string) => {
    database.setPrimaryActressPhoto(name, photoUrl);
    return database.getAllActressPhotos();
  });

  ipcMain.handle("player:fetchSubtitles", async (_event, dvdId: string): Promise<OnlineSubtitleResult[]> => {
    return fetchSubtitleCatResults(dvdId);
  });

  ipcMain.handle("player:downloadSubtitle", async (_event, url: string): Promise<string | null> => {
    try {
      if (url.startsWith("file://")) {
        return await fsp.readFile(fileURLToPath(url), "utf8");
      }

      if (url.startsWith("mla-media:")) {
        const filePath = fileURLToPath(url.replace(/^mla-media:/, "file:"));
        return await fsp.readFile(filePath, "utf8");
      }

      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      });
      if (!response.ok) return null;
      return await response.text();
    } catch {
      return null;
    }
  });

  ipcMain.handle(
    "player:installSubtitle",
    async (_event, movieId: string, language: string, content: string): Promise<string> => {
      const movie = database.getMovie(movieId);
      if (!movie) {
        throw new Error("Movie not found.");
      }

      const targetPath = buildTargetSubtitlePath({
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

      await fsp.mkdir(path.dirname(targetPath), { recursive: true });
      await fsp.writeFile(targetPath, content, "utf8");
      database.upsertSubtitle(movieId, targetPath, language);
      return targetPath;
    }
  );

  ipcMain.handle("player:getSettings", () => {
    return database.getPlayerSettings();
  });

  ipcMain.handle("player:saveSettings", (_event, settings: PlayerSettings) => {
    database.setPlayerSettings(settings);
    return settings;
  });

  ipcMain.handle("player:getPlaybackCheckpoint", (_event, movieId: string) => {
    return database.getPlaybackCheckpoint(movieId);
  });

  ipcMain.handle("player:savePlaybackCheckpoint", (_event, movieId: string, positionSeconds: number) => {
    return database.savePlaybackCheckpoint(movieId, positionSeconds);
  });

  ipcMain.handle("player:clearPlaybackCheckpoint", (_event, movieId: string) => {
    database.clearPlaybackCheckpoint(movieId);
  });

  // ── Subtitle directories + local subtitle scan ───────────────────────────
  // These handlers were lost from the checkout; the renderer's Settings UI
  // (useMediaActions) and preload exposes were still calling them. Behavior
  // follows the scanner's own matching convention (libraryScanner.ts).
  ipcMain.handle("subtitle:addDir", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Add subtitle directory",
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return buildShellState();
    const dirs = new Set(database.getSubtitleDirs());
    dirs.add(result.filePaths[0]);
    database.setSubtitleDirs([...dirs]);
    return buildShellState();
  });

  ipcMain.handle("subtitle:removeDir", async (_event, dir: string) => {
    database.setSubtitleDirs(
      database.getSubtitleDirs().filter((existing) => existing !== dir)
    );
    return buildShellState();
  });

  ipcMain.handle("subtitle:scan", async () => {
    const dirs = database.getSubtitleDirs();
    const movies = database.listMovies({ includeGentle: true });
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
      database.upsertSubtitle(movie.id, first.path, first.language);
      result.matched++;
      continue;
    }
    return result;
  });

  ipcMain.handle("movies:addFiles", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Add video files",
      properties: ["openFile", "multiSelections"]
    });
    if (result.canceled || result.filePaths.length === 0) return { added: 0, skipped: 0 };
    return registerLocalFiles(database, result.filePaths, "normal");
  });

  ipcMain.handle("player:getFileUrl", (_event, filePath: string, folderPath?: string | null): string => {
    const resolvedPath =
      path.isAbsolute(filePath)
        ? filePath
        : folderPath
          ? path.join(folderPath, filePath)
          : filePath;
    const fileUrl = pathToFileURL(path.resolve(resolvedPath)).href;
    return fileUrl.replace(/^file:/, "mla-media:");
  });

  ipcMain.handle("player:convertToMp4", async (_event, filePath: string): Promise<{ ok: boolean; url?: string; error?: string }> => {
    try {
      const outputPath = buildTranscodeOutputPath(filePath);
      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        await runFfmpeg([
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
      const fileUrl = pathToFileURL(outputPath).href;
      return { ok: true, url: fileUrl.replace(/^file:/, "mla-media:") };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown conversion error"
      };
    }
  });

  ipcMain.handle("subtitle:generateForMovie", async (_event, movieId: string, options: SubtitleGenerationOptions): Promise<SubtitleGenerationResult> => {
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

  ipcMain.handle("subtitle:getModelAvailability", async (_event, model: SubtitleGenerationOptions["model"]): Promise<SubtitleModelAvailability> => {
    return getSubtitleModelAvailability(model);
  });

  ipcMain.handle("subtitle:downloadModel", async (_event, model: SubtitleGenerationOptions["model"]): Promise<SubtitleModelDownloadResult> => {
    return downloadSubtitleModel(model);
  });

  ipcMain.handle("subtitle:previewOutput", async (_event, movieId: string, options: SubtitleGenerationOptions): Promise<SubtitleGenerationPreview> => {
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

app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
app.commandLine.appendSwitch("disable-http-cache");

const userDataOverride = process.env.MLA_USER_DATA_DIR?.trim();
if (userDataOverride) {
  app.setPath("userData", path.resolve(userDataOverride));
}

app.whenReady().then(() => {

  const databasePath = path.join(app.getPath("userData"), "mla-plus.db");
  database = new DatabaseClient(databasePath);
  protocol.registerFileProtocol("mla-media", (request, callback) => {
    try {
      const parsed = new URL(request.url);
      let filePath: string;

      if (process.platform === "win32" && /^[a-z]$/i.test(parsed.hostname)) {
        const drive = `${parsed.hostname.toUpperCase()}:`;
        const normalizedPath = decodeURIComponent(parsed.pathname).replace(/\//g, path.sep);
        filePath = path.normalize(`${drive}${normalizedPath}`);
      } else if (process.platform === "win32" && /^\/[a-z]:/i.test(parsed.pathname)) {
        filePath = path.normalize(decodeURIComponent(parsed.pathname.slice(1)).replace(/\//g, path.sep));
      } else {
        const fileUrl = request.url.replace(/^mla-media:/, "file:");
        filePath = fileURLToPath(fileUrl);
      }

      callback({ path: filePath });
    } catch {
      callback({ error: -6 });
    }
  });
  registerHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  database?.close();
});
