import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseClient } from "../database/database";
import { probeVideoFile, runFfmpeg } from "./ffmpegService";
import {
  enrichMoviePoster,
  enrichActressPhotos,
  resolveOnlineMovieMetadata,
  type OnlineMovieMetadata
} from "./metadataService";
import {
  buildTargetSubtitlePath,
  buildTargetVideoPath,
  ensureLibraryTargetDirectory,
  readNfoMetadata,
  savePosterToFolder,
  writeMovieNfo
} from "./libraryLayout";
import { moveFile } from "./fileService";
import type {
  DuplicateFile,
  DuplicateGroup,
  MetadataSettings,
  LibraryMode,
  LibraryRoots,
  OrganizationSettings,
  ScanAutomationOptions,
  ScanMode,
  ScanProgress,
  ScanRejectedFile,
  ScanSummary,
  SubtitleLanguagePreference,
  SubtitleRecord
} from "../shared/contracts";
import {
  SUBTITLE_EXTENSIONS,
  VIDEO_EXTENSIONS
} from "../shared/contracts";
import { extractVideoId } from "../shared/videoId";

interface ParsedMetadata {
  title: string;
  year: number | null;
  videoId: string | null;
  resolution: string;
  keywords: string[];
}

interface ScanCandidate {
  mode: LibraryMode;
  root: string;
  videoFile: string;
  parsed: ParsedMetadata;
  fileSize: number;
}

interface SubtitleCandidate {
  language: string;
  path: string;
}

interface ProcessingResult {
  videoPath: string;
  folderPath: string;
  subtitles: SubtitleCandidate[];
  warnings: string[];
  subtitleSearchLog: string | null;
}

interface DownloadedSubtitleResult {
  subtitle: SubtitleCandidate;
  matchedQuery: string;
}

type ValidationResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      status: ScanRejectedFile["status"];
      reason: string;
    };

export const DEFAULT_SCAN_OPTIONS: ScanAutomationOptions = {
  importOnlyCompleteVideos: true,
  importBetterQuality: true,
  autoResolveDuplicates: false,
  moveRename: true,
  copyToLibrary: false,
  scanAllSubfolders: true,
  resolveLongPath: true,
  autoConvertToMp4: false,
  autoMatchSubtitle: true,
  autoDownloadSubtitleFromSubtitleCat: true,
  preferredSubtitleLanguage: "zh-hans",
  addToNormalModeLibrary: true,
  addToGentleModeLibrary: false
};

export interface CancelToken {
  cancelled: boolean;
}

export function createCancelToken(): CancelToken {
  return { cancelled: false };
}

export async function scanLibraries(
  database: DatabaseClient,
  rootsToScan: LibraryRoots = database.getRoots(),
  options?: {
    mode?: ScanMode;
    onProgress?: (progress: ScanProgress) => void;
    scanOptions?: Partial<ScanAutomationOptions>;
    cancelToken?: CancelToken;
  }
): Promise<ScanSummary> {
  const mode = options?.mode ?? "all";
  const onProgress = options?.onProgress;
  const cancelToken = options?.cancelToken;
  const scanOptions = {
    ...DEFAULT_SCAN_OPTIONS,
    ...options?.scanOptions
  };
  const metadataSettings = database.getMetadataSettings();
  const organizationSettings = database.getOrganizationSettings();
  let imported = 0;
  let skipped = 0;
  let processedFiles = 0;
  const errors: string[] = [];
  const subtitleSearchLogs: string[] = [];
  const invalidFiles: ScanRejectedFile[] = [];
  const candidates: ScanCandidate[] = [];

  onProgress?.({
    stage: "preparing",
    mode,
    currentRoot: null,
    currentFile: null,
    processedFiles: 0,
    totalFiles: 0,
    imported: 0,
    skipped: 0,
    message: "Preparing sequential scan..."
  });

  for (const libraryMode of ["normal", "gentle"] as const) {
    for (const root of rootsToScan[libraryMode]) {
      onProgress?.({
        stage: "discovering",
        mode,
        currentRoot: root,
        currentFile: null,
        processedFiles: 0,
        totalFiles: 0,
        imported,
        skipped,
        message: `Finding media files in ${root}`
      });

      try {
        const videoFiles = await walkForVideos(root, scanOptions.scanAllSubfolders, (warning) => {
          errors.push(`${libraryMode}:${warning}`);
        });
        for (const videoFile of videoFiles) {
          const parsed = parseMetadata(
            path.basename(videoFile, path.extname(videoFile))
          );
          candidates.push({
            mode: libraryMode,
            root,
            videoFile,
            parsed,
            fileSize: await getFileSize(videoFile)
          });
        }
      } catch (error) {
        skipped += 1;
        errors.push(`${libraryMode}:${root} - ${formatError(error)}`);
      }
    }
  }

  // Deduplicate candidates by resolved file path (handles overlapping scan roots)
  const seenPaths = new Set<string>();
  const uniqueCandidates: ScanCandidate[] = [];
  for (const c of candidates) {
    const normalized = path.resolve(c.videoFile).toLowerCase();
    if (!seenPaths.has(normalized)) {
      seenPaths.add(normalized);
      uniqueCandidates.push(c);
    }
  }
  candidates.length = 0;
  candidates.push(...uniqueCandidates);

  const totalFiles = candidates.length;
  if (totalFiles === 0) {
    onProgress?.({
      stage: "completed",
      mode,
      currentRoot: null,
      currentFile: null,
      processedFiles: 0,
      totalFiles: 0,
      imported,
      skipped,
      message: "No media files were found in the selected folders."
    });

    return {
      discovered: 0,
      imported,
      skipped,
      errors,
      subtitleSearchLogs,
      invalidFiles,
      duplicateGroups: [],
      scannedRoots: rootsToScan,
      cancelled: false
    };
  }

  const processingGroups = buildProcessingGroups(
    candidates,
    scanOptions.importBetterQuality
  );

  // Collect groups that have more than one file (duplicates) for user review
  const duplicateGroups: DuplicateGroup[] = processingGroups
    .filter((group) => group.length > 1)
    .map((group) => ({
      key: group[0].parsed.videoId
        ? `id:${normalizeForKey(group[0].parsed.videoId)}`
        : `title:${normalizeForKey(group[0].parsed.title)}`,
      videoId: group[0].parsed.videoId,
      title: group[0].parsed.title,
      files: group.map((c, i): DuplicateFile => ({
        path: c.videoFile,
        resolution: c.parsed.resolution,
        fileSize: c.fileSize,
        autoSelected: i === 0
      }))
    }));

  // Diagnostic: log duplicate groups and file details for verification
  if (duplicateGroups.length > 0) {
    for (const dg of duplicateGroups) {
      // eslint-disable-next-line no-console
      console.log(`[scanner] DuplicateGroup key=${dg.key} videoId=${dg.videoId} title=${dg.title}`);
      for (const f of dg.files) {
        // eslint-disable-next-line no-console
        console.log(`[scanner]  - ${f.path} size=${f.fileSize} res=${f.resolution} auto=${f.autoSelected}`);
      }
    }
  }

  for (const group of processingGroups) {
    if (cancelToken?.cancelled) break;
    let importedFromGroup = false;

    for (const candidate of group) {
      if (cancelToken?.cancelled) break;
      onProgress?.({
        stage: "processing",
        mode,
        currentRoot: candidate.root,
        currentFile: candidate.videoFile,
        processedFiles,
        totalFiles,
        imported,
        skipped,
        message: `Processing ${processedFiles + 1} of ${totalFiles}`
      });

      if (importedFromGroup) {
        skipped += 1;
        errors.push(
          `${candidate.mode}:${candidate.videoFile} - Skipped lower-quality duplicate.`
        );
        processedFiles += 1;
        continue;
      }

      if (scanOptions.importOnlyCompleteVideos) {
        const validation = await validateCandidateBeforeImport(candidate.videoFile);
        if (!validation.ok) {
          skipped += 1;
          invalidFiles.push({
            path: candidate.videoFile,
            reason: validation.reason,
            status: validation.status
          });
          errors.push(
            `${candidate.mode}:${candidate.videoFile} - ${validation.reason}`
          );
          processedFiles += 1;
          continue;
        }
      }

      try {
        const onlineMetadata = await resolveOnlineImportMetadata(
          candidate.mode,
          candidate.parsed.videoId,
          candidate.parsed.title,
          candidate.parsed.year,
          candidate.videoFile,
          metadataSettings
        );
        // Read .nfo sidecar for metadata (actresses, title, etc.)
        const nfoData = await readNfoMetadata(candidate.videoFile);

        // Merge actress info: online > nfo > empty
        const resolvedVideoId = onlineMetadata?.videoId ?? candidate.parsed.videoId;
        const actresses = onlineMetadata?.actresses?.length
          ? onlineMetadata.actresses
          : nfoData.actresses?.length
            ? nfoData.actresses
            : [];

        // Fetch actress profile photos in background (best-effort)
        if (actresses.length > 0) {
          void enrichActressPhotos(database, actresses);
        }
        const subtitles = scanOptions.autoMatchSubtitle
          ? await findMatchingSubtitleCandidates(candidate.videoFile)
          : [];

        const processed = await applyProcessingOptions({
          libraryMode: candidate.mode,
          root: candidate.root,
          videoPath: candidate.videoFile,
          title: candidate.parsed.title,
          year: candidate.parsed.year ?? nfoData.year ?? null,
          videoId: resolvedVideoId ?? "",
          actresses,
          modelName: onlineMetadata?.modelName ?? nfoData.studio ?? null,
          subtitles,
          organizationSettings,
          scanOptions
        });

        for (const warning of processed.warnings) {
          errors.push(`${candidate.mode}:${processed.videoPath} - ${warning}`);
        }
        if (processed.subtitleSearchLog) {
          subtitleSearchLogs.push(`${candidate.parsed.title} - ${processed.subtitleSearchLog}`);
        }

        const existingId = database.findMovieIdBySourcePath(processed.videoPath);
        const movieId = existingId ?? database.createMovieId(processed.videoPath);
        const subtitleRecords: SubtitleRecord[] = processed.subtitles.map((subtitle) => ({
          id: database.createSubtitleId(movieId, subtitle.path),
          language: subtitle.language,
          path: subtitle.path
        }));

        database.upsertMovie({
          id: movieId,
          title: candidate.parsed.title,
          year: candidate.parsed.year,
          videoId: resolvedVideoId,
          sourcePath: processed.videoPath,
          folderPath: processed.folderPath,
          libraryMode: candidate.mode,
          resolution: candidate.parsed.resolution,
          posterUrl: onlineMetadata?.posterUrl ?? null,
          posterSource: onlineMetadata?.posterUrl ? "web" : "none",
          actresses,
          keywords: candidate.parsed.keywords
        });
        database.replaceSubtitles(movieId, subtitleRecords);
        imported += 1;
        importedFromGroup = scanOptions.importBetterQuality;

        try {
          await enrichMoviePoster(database, movieId, metadataSettings, {
            onProgress,
            progress: {
              stage: "processing",
              mode,
              currentRoot: candidate.root,
              currentFile: processed.videoPath,
              processedFiles,
              totalFiles,
              imported,
              skipped,
              message: `Fetching web poster for ${candidate.parsed.title}`
            }
          });
        } catch (error) {
          errors.push(`${candidate.mode}:${processed.videoPath} - ${formatError(error)}`);
        }

        // Save poster image file into the movie folder
        try {
          const posterMovie = database.getMovie(movieId);
          if (posterMovie?.posterUrl?.startsWith("http")) {
            await savePosterToFolder(processed.folderPath, posterMovie.posterUrl);
          }
        } catch {
          // Best-effort — ignore poster save failures
        }
      } catch (error) {
        skipped += 1;
        errors.push(`${candidate.mode}:${candidate.videoFile} - ${formatError(error)}`);
      }

      processedFiles += 1;
    }
  }

  const wasCancelled = Boolean(cancelToken?.cancelled);

  onProgress?.({
    stage: wasCancelled ? "cancelled" : "completed",
    mode,
    currentRoot: null,
    currentFile: null,
    processedFiles,
    totalFiles,
    imported,
    skipped,
    message: wasCancelled
      ? `Scan stopped after ${processedFiles} files. Imported ${imported}.`
      : `Processed ${processedFiles} files.`
  });

  return {
    discovered: totalFiles,
    imported,
    skipped,
    errors,
    subtitleSearchLogs,
    invalidFiles,
    duplicateGroups,
    scannedRoots: rootsToScan,
    cancelled: wasCancelled
  };
}

async function walkForVideos(
  root: string,
  recursive: boolean,
  onWarning?: (warning: string) => void
): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(root, {
      withFileTypes: true
    });
  } catch (error) {
    onWarning?.(`${root} - ${formatError(error)}`);
    return [];
  }
  const videoFiles: string[] = [];

  for (const entry of entries) {
    const resolved = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (recursive) {
        videoFiles.push(...(await walkForVideos(resolved, true, onWarning)));
      }
      continue;
    }

    if (VIDEO_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
      videoFiles.push(resolved);
    }
  }

  return videoFiles;
}

async function findMatchingSubtitleCandidates(
  videoPath: string
): Promise<SubtitleCandidate[]> {
  const directory = path.dirname(videoPath);
  const basename = path
    .basename(videoPath, path.extname(videoPath))
    .toLowerCase();
  const entries = await fs.readdir(directory, {
    withFileTypes: true
  });

  return entries
    .filter((entry) => entry.isFile())
    .filter((entry) =>
      SUBTITLE_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())
    )
    .filter((entry) => {
      const subBasename = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
      // Match if subtitle name starts with video name (exact/extended subtitles)
      // OR video name starts with subtitle name (short subtitle like "IPX-787.srt" for "IPX-787 Full Title.mp4")
      return subBasename.startsWith(basename) || basename.startsWith(subBasename);
    })
    .map((entry) => ({
      language: extractSubtitleLanguage(entry.name),
      path: path.join(directory, entry.name)
    }));
}

async function applyProcessingOptions(params: {
  libraryMode: LibraryMode;
  root: string;
  videoPath: string;
  title: string;
  year: number | null;
  videoId: string | null;
  actresses: string[];
  modelName: string | null;
  subtitles: SubtitleCandidate[];
  organizationSettings: OrganizationSettings;
  scanOptions: ScanAutomationOptions;
}): Promise<ProcessingResult> {
  const warnings: string[] = [];
  let currentVideoPath = params.videoPath;
  let currentFolderPath = path.dirname(currentVideoPath);
  let currentSubtitles = [...params.subtitles];
  let subtitleSearchLog: string | null = null;
  const originalVideoDirectory = path.dirname(params.videoPath);
  const workspaceRoot =
    params.libraryMode === "gentle"
      ? params.organizationSettings.gentleLibraryPath
      : params.organizationSettings.normalLibraryPath;
  const targetRoot = workspaceRoot.trim() || params.root;
  // Always organize: rename + move into structured library folders
  const needsOrganizedPlacement = true;

  if (
    params.scanOptions.autoConvertToMp4 &&
    path.extname(currentVideoPath).toLowerCase() !== ".mp4"
  ) {
    const convertDirectory = needsOrganizedPlacement
      ? await ensureLibraryTargetDirectory(targetRoot, {
          libraryMode: params.libraryMode,
          title: params.title,
          year: params.year,
          videoId: params.videoId,
          actresses: params.actresses,
          modelName: params.modelName,
          resolveLongPath: params.scanOptions.resolveLongPath,
          organizationSettings: params.organizationSettings
        })
      : currentFolderPath;

    const targetMp4Path = await ensureUniquePath(
      buildTargetVideoPath(convertDirectory, {
        libraryMode: params.libraryMode,
        title: params.title,
        year: params.year,
        videoId: params.videoId ?? "",
        actresses: params.actresses,
        modelName: params.modelName,
        resolveLongPath: params.scanOptions.resolveLongPath,
        organizationSettings: params.organizationSettings
      }, ".mp4")
    );

    try {
      await convertVideoToMp4(currentVideoPath, targetMp4Path);
      await fs.unlink(currentVideoPath).catch(() => undefined);
      currentVideoPath = targetMp4Path;
      currentFolderPath = path.dirname(currentVideoPath);
    } catch (error) {
      warnings.push(`MP4 conversion failed: ${formatError(error)}`);
    }
  }

  if (needsOrganizedPlacement) {
    try {
      const targetDirectory = await ensureLibraryTargetDirectory(targetRoot, {
        libraryMode: params.libraryMode,
        title: params.title,
        year: params.year,
        videoId: params.videoId ?? "",
        actresses: params.actresses,
        modelName: params.modelName,
        resolveLongPath: params.scanOptions.resolveLongPath,
        organizationSettings: params.organizationSettings
      });
      const targetVideoPath = await ensureUniquePath(
        buildTargetVideoPath(targetDirectory, {
          libraryMode: params.libraryMode,
          title: params.title,
          year: params.year,
          videoId: params.videoId,
          actresses: params.actresses,
          modelName: params.modelName,
          resolveLongPath: params.scanOptions.resolveLongPath,
          organizationSettings: params.organizationSettings
        }, path.extname(currentVideoPath))
      );

      if (path.resolve(targetVideoPath) !== path.resolve(currentVideoPath)) {
        await moveFile(currentVideoPath, targetVideoPath);
      }
      currentVideoPath = targetVideoPath;
      currentFolderPath = targetDirectory;
    } catch (error) {
      warnings.push(`Move/Rename failed: ${formatError(error)}`);
    }
  }

  if (currentSubtitles.length > 0 && needsOrganizedPlacement) {
    const movedSubtitles: SubtitleCandidate[] = [];

    for (const subtitle of currentSubtitles) {
      try {
        const extension = path.extname(subtitle.path);
        const targetSubtitlePath = await ensureUniquePath(
          buildTargetSubtitlePath({
            directory: currentFolderPath,
            title: params.title,
            year: params.year,
            videoId: params.videoId,
            actresses: params.actresses,
            modelName: params.modelName,
            language: subtitle.language,
            extension,
            subtitleCount: currentSubtitles.length,
            resolveLongPath: params.scanOptions.resolveLongPath,
            organizationSettings: params.organizationSettings
          })
        );

        if (path.resolve(targetSubtitlePath) !== path.resolve(subtitle.path)) {
          await moveFile(subtitle.path, targetSubtitlePath);
        }

        movedSubtitles.push({
          ...subtitle,
          path: targetSubtitlePath
        });
      } catch (error) {
        warnings.push(`Subtitle move failed: ${formatError(error)}`);
        movedSubtitles.push(subtitle);
      }
    }

    currentSubtitles = movedSubtitles;
  }

  // Write .nfo sidecar for all library modes
  if (needsOrganizedPlacement) {
    // Only fetch from SubtitleCat when no local subtitle was matched and moved.
    if (
      params.scanOptions.autoDownloadSubtitleFromSubtitleCat &&
      params.videoId &&
      currentSubtitles.length === 0
    ) {
      try {
        const downloadedSubtitle = await downloadBestSubtitleFromSubtitleCat({
          directory: currentFolderPath,
          title: params.title,
          year: params.year,
          videoId: params.videoId,
          actresses: params.actresses,
          modelName: params.modelName,
          preferredLanguage: params.scanOptions.preferredSubtitleLanguage,
          resolveLongPath: params.scanOptions.resolveLongPath,
          organizationSettings: params.organizationSettings
        });
        if (downloadedSubtitle && downloadedSubtitle.subtitle) {
          currentSubtitles.push(downloadedSubtitle.subtitle);
          subtitleSearchLog = downloadedSubtitle.matchedQuery === params.videoId
            ? `SubtitleCat matched using video ID "${downloadedSubtitle.matchedQuery}".`
            : `SubtitleCat matched using fallback query "${downloadedSubtitle.matchedQuery}".`;
        }
      } catch (e) {
        // Ignore subtitle download errors
      }
    }
  }

  try {
    await writeMovieNfo({
      directory: currentFolderPath,
      libraryMode: params.libraryMode,
      title: params.title,
      year: params.year,
      videoId: params.videoId,
      actresses: params.actresses,
      modelName: params.modelName,
      sourcePath: currentVideoPath,
      organizationSettings: params.organizationSettings
    });
  } catch (error) {
    warnings.push(`NFO write failed: ${formatError(error)}`);
  }

  await cleanupDirectory(originalVideoDirectory);
  for (const subtitle of params.subtitles) {
    await cleanupDirectory(path.dirname(subtitle.path));
  }

  return {
    videoPath: currentVideoPath,
    folderPath: currentFolderPath,
    subtitles: currentSubtitles,
    warnings,
    subtitleSearchLog
  };
}

async function convertVideoToMp4(sourcePath: string, targetPath: string): Promise<void> {
  await runFfmpeg([
    "-y",
    "-i",
    sourcePath,
    "-c:v",
    "libx264",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    targetPath
  ]);
}

async function downloadBestSubtitleFromSubtitleCat(params: {
  directory: string;
  title: string;
  year: number | null;
  videoId: string;
  actresses: string[];
  modelName: string | null;
  preferredLanguage: SubtitleLanguagePreference;
  resolveLongPath: boolean;
  organizationSettings: OrganizationSettings;
}): Promise<DownloadedSubtitleResult | null> {
  const searchQueries = buildSubtitleSearchQueries(params.videoId, params.title);
  const { query: matchedQuery, results } = await fetchSubtitleCatResultsForQueries(searchQueries);
  if (!matchedQuery || results.length === 0) {
    return null;
  }

  const preferred =
    results.find((result) => matchesPreferredSubtitleLanguage(result, params.preferredLanguage)) ??
    results.find((result) => matchesPreferredSubtitleLanguage(result, "en")) ??
    results[0];
  const content = await downloadSubtitleContent(preferred.downloadUrl);
  if (!content) {
    return null;
  }

  const targetSubtitlePath = await ensureUniquePath(
    buildTargetSubtitlePath({
      directory: params.directory,
      title: params.title,
      year: params.year,
      videoId: params.videoId,
      actresses: params.actresses,
      modelName: params.modelName,
      language: preferred.languageCode || "und",
      extension: ".srt",
      subtitleCount: 1,
      resolveLongPath: params.resolveLongPath,
      organizationSettings: params.organizationSettings
    })
  );

  await fs.writeFile(targetSubtitlePath, content, "utf8");

  return {
    subtitle: {
      language: (preferred.languageCode || "und").toUpperCase(),
      path: targetSubtitlePath
    },
    matchedQuery
  };
}

async function fetchSubtitleCatResultsForQueries(
  queries: string[]
): Promise<{ query: string | null; results: SubtitleCatResult[] }> {
  for (const query of queries) {
    const results = await fetchSubtitleCatResults(query);
    if (results.length > 0) {
      return { query, results };
    }
  }

  return { query: null, results: [] };
}

function buildSubtitleSearchQueries(videoId: string, title: string): string[] {
  const cleanedTitle = title
    .replace(/[._]+/g, " ")
    .replace(/\b(19\d{2}|20\d{2})\b/g, " ")
    .replace(/\b(2160p|1080p|720p|480p|4k|bluray|webrip|x264|x265|aac|h264)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return Array.from(
    new Set(
      [videoId, cleanedTitle, title]
        .map((value) => value.trim())
        .filter((value) => value.length >= 3)
    )
  );
}

interface SubtitleCatResult {
  id: string;
  title: string;
  language: string;
  languageCode: string;
  downloadUrl: string;
  downloads: number;
}

async function fetchSubtitleCatResults(query: string): Promise<SubtitleCatResult[]> {
  async function searchOnce(q: string): Promise<SubtitleCatResult[]> {
    const url = `https://www.subtitlecat.com/index.php?search=${encodeURIComponent(q)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5"
      }
    });
    if (!response.ok) return [];
    const html = await response.text();
    const results: SubtitleCatResult[] = [];
    const lines = html.split(/\r?\n/);

    for (const line of lines) {
      const linkMatch = line.match(/href=\"(\/sub\/[^\"]+\.srt)\"/i);
      if (!linkMatch) continue;

      const rawUrl = linkMatch[1];
      const downloadUrl = `https://www.subtitlecat.com${rawUrl}`;
      const titleMatch = line.match(/>([^<]{3,})<\/a>/i);
      const title = titleMatch?.[1]?.trim() ?? q;
      const langMatch =
        line.match(/translated from ([A-Za-z]+)/i) ??
        line.match(/alt=\"([A-Za-z ]{2,30})\"/i);
      const language = langMatch?.[1]?.trim() ?? "Unknown";
      const languageCode = language.toLowerCase().slice(0, 2) || "und";
      const downloadsMatch =
        line.match(/(\d[\d,]*)\s*(?:downloads?|dl)\b/i) ??
        line.match(/⬇\s*(\d[\d,]*)/i);
      const downloads = downloadsMatch ? Number(downloadsMatch[1].replace(/,/g, "")) : 0;
      const id = `${languageCode}-${results.length}`;

      if (!results.some((result) => result.downloadUrl === downloadUrl)) {
        results.push({ id, title, language, languageCode, downloadUrl, downloads });
      }
    }

    const normalizedQuery = q.toUpperCase();
    return results
      .filter(
        (result) =>
          result.title.toUpperCase().includes(normalizedQuery) ||
          normalizedQuery.includes(result.title.toUpperCase())
      )
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

async function downloadSubtitleContent(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });
    if (!response.ok) {
      return null;
    }
    return await response.text();
  } catch {
    return null;
  }
}

function matchesPreferredSubtitleLanguage(
  result: SubtitleCatResult,
  preferredLanguage: SubtitleLanguagePreference
): boolean {
  const language = result.language.toLowerCase();
  const code = result.languageCode.toLowerCase();

  if (preferredLanguage === "zh-hans") {
    return code === "zh" || language.includes("simplified") || language.includes("chinese simplified");
  }

  if (preferredLanguage === "zh-hant") {
    return code === "zh" || language.includes("traditional") || language.includes("chinese traditional");
  }

  if (preferredLanguage === "zh") {
    return code === "zh" || language.includes("chinese");
  }

  return code === preferredLanguage || language.includes(expandLanguageLabel(preferredLanguage));
}

function expandLanguageLabel(preferredLanguage: SubtitleLanguagePreference): string {
  switch (preferredLanguage) {
    case "en":
      return "english";
    case "ja":
      return "japanese";
    case "ko":
      return "korean";
    case "fr":
      return "french";
    case "es":
      return "spanish";
    case "de":
      return "german";
    case "pt":
      return "portuguese";
    case "th":
      return "thai";
    case "vi":
      return "vietnamese";
    case "id":
      return "indonesian";
    case "ar":
      return "arabic";
    case "ru":
      return "russian";
    case "it":
      return "italian";
    case "zh-hans":
      return "simplified";
    case "zh-hant":
      return "traditional";
    case "zh":
      return "chinese";
    default:
      return preferredLanguage;
  }
}

function buildProcessingGroups(
  candidates: ScanCandidate[],
  preferBetterQuality: boolean
): ScanCandidate[][] {
  if (!preferBetterQuality) {
    return candidates.map((candidate) => [candidate]);
  }

  const groupedCandidates = new Map<string, ScanCandidate[]>();

  for (const candidate of candidates) {
    const key = candidate.parsed.videoId
      ? `id:${normalizeForKey(candidate.parsed.videoId)}`
      : `${normalizeForKey(candidate.parsed.title)}:${candidate.parsed.year ?? "unknown"}`;
    const current = groupedCandidates.get(key) ?? [];
    current.push(candidate);
    groupedCandidates.set(key, current);
  }

  return Array.from(groupedCandidates.values()).map((group) =>
    [...group].sort((left, right) => compareCandidateQuality(right, left))
  );
}

function compareCandidateQuality(left: ScanCandidate, right: ScanCandidate): number {
  // Primary preference: larger file size
  const sizeDiff = left.fileSize - right.fileSize;
  if (sizeDiff !== 0) return sizeDiff;

  // Secondary preference: prefer base name (no A/B suffix) over suffixed variants
  const leftStem = path.basename(left.videoFile, path.extname(left.videoFile));
  const rightStem = path.basename(right.videoFile, path.extname(right.videoFile));
  const leftSuffixMatch = leftStem.match(/[- _]([A-Za-z])$/);
  const rightSuffixMatch = rightStem.match(/[- _]([A-Za-z])$/);
  const leftSuffix = leftSuffixMatch ? leftSuffixMatch[1].toUpperCase() : null;
  const rightSuffix = rightSuffixMatch ? rightSuffixMatch[1].toUpperCase() : null;

  if (leftSuffix && !rightSuffix) return -1; // right is base -> prefer right
  if (!leftSuffix && rightSuffix) return 1;  // left is base -> prefer left

  // If both have single-letter suffixes, prefer A over B
  if (leftSuffix && rightSuffix && leftSuffix !== rightSuffix) {
    if (leftSuffix === "A" && rightSuffix === "B") return 1;
    if (leftSuffix === "B" && rightSuffix === "A") return -1;
  }

  // Fallback to resolution score
  const leftResolution = resolutionScore(left.parsed.resolution);
  const rightResolution = resolutionScore(right.parsed.resolution);
  if (leftResolution !== rightResolution) return leftResolution - rightResolution;

  return 0;
}

function resolutionScore(resolution: string): number {
  switch (resolution.toUpperCase()) {
    case "4K":
    case "2160P":
      return 4;
    case "1080P":
      return 3;
    case "720P":
      return 2;
    case "480P":
      return 1;
    default:
      return 0;
  }
}

function normalizeForKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

async function validateCandidateBeforeImport(
  filePath: string
): Promise<ValidationResult> {
  const stableCheck = await ensureFileIsStable(filePath);
  if (!stableCheck.ok) {
    return stableCheck;
  }

  const probeResult = await probeVideoFile(filePath);
  if (!probeResult.valid) {
    return {
      ok: false,
      status: probeResult.status ?? "invalid",
      reason: probeResult.reason ?? "The media probe rejected this file."
    };
  }

  if (
    typeof probeResult.durationSeconds === "number" &&
    probeResult.durationSeconds < 20 * 60
  ) {
    return {
      ok: false,
      status: "incomplete",
      reason: "File is shorter than 20 minutes and does not meet the completed-file import rule."
    };
  }

  return { ok: true };
}

async function ensureFileIsStable(filePath: string): Promise<ValidationResult> {
  try {
    const firstStats = await fs.stat(filePath);
    if (firstStats.size <= 0) {
      return {
        ok: false,
        status: "invalid",
        reason: "File is empty."
      };
    }

    await delay(1000);

    const secondStats = await fs.stat(filePath);
    if (secondStats.size <= 0) {
      return {
        ok: false,
        status: "invalid",
        reason: "File became empty during validation."
      };
    }

    if (
      firstStats.size !== secondStats.size ||
      Math.trunc(firstStats.mtimeMs) !== Math.trunc(secondStats.mtimeMs)
    ) {
      return {
        ok: false,
        status: "incomplete",
        reason: "File is still changing on disk and looks like an unfinished download."
      };
    }
  } catch (error) {
    return {
      ok: false,
      status: "invalid",
      reason: `File could not be read during validation: ${formatError(error)}`
    };
  }

  return {
    ok: true
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function getFileSize(filePath: string): Promise<number> {
  try {
    const stats = await fs.stat(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

export function extractSubtitleLanguage(filename: string): string {
  const stem = path.basename(filename, path.extname(filename));
  const segments = stem.split(".");
  const candidate = segments[segments.length - 1];

  if (candidate.length >= 2 && candidate.length <= 5) {
    return candidate.toUpperCase();
  }

  return "UND";
}

function parseMetadata(stem: string): ParsedMetadata {
  const normalized = stem.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  const withoutDuplicateMarkers = normalized
    .replace(/\((?:\d+)\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const videoId = extractVideoId(withoutDuplicateMarkers);
  const yearMatch = normalized.match(/\b(19\d{2}|20\d{2})\b/);
  const resolutionMatch = normalized.match(/\b(2160p|1080p|720p|480p|4k)\b/i);

  let title = withoutDuplicateMarkers
    .replace(/\b(19\d{2}|20\d{2})\b/, "")
    .replace(
      /\b(2160p|1080p|720p|480p|4k|bluray|webrip|x264|x265|aac|h264)\b/gi,
      ""
    )
    .replace(/\b\d{5,8}(?=\s+[A-Z]{2,10}[- ]?\d{2,6}\b)/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (videoId) {
    title = title
      .replace(new RegExp(`\\b${videoId.replace(/-/g, "[- ]?")}\\b`, "i"), " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const cleanedTitle = title || normalized;
  const keywords = Array.from(
    new Set(
      [videoId, ...cleanedTitle.split(" ")]
        .filter((token): token is string => Boolean(token))
        .map((token) => token.trim())
        .filter((token) => token.length > 2)
    )
  )
    .slice(0, 8);

  return {
    title: title || videoId || cleanedTitle,
    year: yearMatch ? Number(yearMatch[1]) : null,
    videoId,
    resolution: resolutionMatch ? resolutionMatch[1].toUpperCase() : "Unknown",
    keywords
  };
}

async function resolveOnlineImportMetadata(
  mode: LibraryMode,
  videoId: string | null,
  title: string,
  year: number | null,
  sourcePath: string,
  metadataSettings: MetadataSettings
): Promise<OnlineMovieMetadata | null> {
  if (!videoId) {
    return null;
  }
  try {
    return await resolveOnlineMovieMetadata(
      {
        title,
        year,
        videoId,
        sourcePath
      },
      metadataSettings,
      {
        progress: {
          stage: "processing",
          mode,
          currentRoot: null,
          currentFile: sourcePath,
          processedFiles: 0,
          totalFiles: 0,
          imported: 0,
          skipped: 0,
          message: "Resolving metadata"
        }
      }
    );
  } catch {
    return null;
  }
}

/**
 * Register existing local video files into the library without moving or copying them.
 * Files stay exactly where they are on disk — only their path is recorded in the DB.
 */
export async function registerLocalFiles(
  database: DatabaseClient,
  filePaths: string[],
  mode: LibraryMode = "normal"
): Promise<{ added: number; skipped: number }> {
  let added = 0;
  let skipped = 0;

  for (const filePath of filePaths) {
    const ext = path.extname(filePath).toLowerCase();
    if (!VIDEO_EXTENSIONS.includes(ext as (typeof VIDEO_EXTENSIONS)[number])) {
      skipped++;
      continue;
    }

    if (database.findMovieIdBySourcePath(filePath)) {
      skipped++;
      continue;
    }

    const stem = path.basename(filePath, ext);
    const parsed = parseMetadata(stem);

    let resolution = parsed.resolution;
    try {
      const probe = await probeVideoFile(filePath);
      if (probe.valid && probe.height) {
        if (probe.height >= 2160) resolution = "2160P";
        else if (probe.height >= 1080) resolution = "1080P";
        else if (probe.height >= 720) resolution = "720P";
        else if (probe.height >= 480) resolution = "480P";
      }
    } catch { /* use filename-derived resolution if probe unavailable */ }

    database.upsertMovie({
      id: database.createMovieId(filePath),
      title: parsed.title || stem,
      year: parsed.year,
      videoId: parsed.videoId,
      sourcePath: filePath,
      folderPath: path.dirname(filePath),
      libraryMode: mode,
      resolution,
      posterUrl: null,
      posterSource: "none",
      actresses: [],
      keywords: parsed.keywords,
    });
    added++;
  }

  return { added, skipped };
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
// Use robust moveFile from fileService (handles long-path, locks, EXDEV, etc.)

async function cleanupDirectory(directory: string): Promise<void> {
  if (!(await exists(directory))) {
    return;
  }

  const remaining = await fs.readdir(directory);
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

function formatError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code;
    const hint =
      code === "EPERM" || code === "EACCES"
        ? " (permission denied — file may be in use or read-only)"
        : code === "ENOENT"
        ? " (source file not found)"
        : code === "ENOSPC"
        ? " (disk full)"
        : code
        ? ` [${code}]`
        : "";
    return `${error.message}${hint}`;
  }
  return "Unknown scanner error";
}
