import type {
  MovieRecord,
  OrganizationSettings,
  PosterBackfillSummary,
  ScanProgress,
  ScanRejectedFile,
  ScanSummary,
} from "../../shared/contracts";
import {
  renderOrganizationFileTemplate,
  renderOrganizationPathTemplate,
  resolveOrganizationTemplateValues,
} from "../../shared/organizationTemplates";

export function srtToVtt(srt: string): string {
  return "WEBVTT\n\n" + srt
    .replace(/\r\n/g, "\n")
    .replace(/^\d+\n/gm, "")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
    .trim();
}

export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function inferActressFromPath(sourcePath: string): string | null {
  const parts = sourcePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const parent = parts[parts.length - 2];
  const generic = new Set([
    "movies", "videos", "media", "library", "normal", "gentle",
    "downloads", "desktop", "users", "documents", "c:", "d:", "e:", "f:"
  ]);
  if (generic.has(parent.toLowerCase())) return null;
  if (parent.length <= 2) return null;
  return parent;
}

export function getProgressPercent(progress: ScanProgress | null): number {
  if (!progress) return 0;
  if (progress.totalFiles === 0) {
    return progress.stage === "completed" ? 100 : progress.stage === "cancelled" ? 0 : 5;
  }
  return Math.min(100, Math.round((progress.processedFiles / progress.totalFiles) * 100));
}

export function getScanStageLabel(progress: ScanProgress | null): string {
  if (!progress) return "Idle";
  switch (progress.stage) {
    case "preparing": return "Preparing";
    case "discovering": return "Discovering";
    case "processing": return "Processing";
    case "completed": return "Completed";
    case "cancelled": return "Cancelled";
    case "error": return "Error";
    default: return "Idle";
  }
}

export function buildScanStatusMessage(summary: ScanSummary): string {
  if (summary.cancelled) return "Folder selection was cancelled.";
  if (summary.discovered === 0) {
    const errorSuffix = summary.errors.length > 0 ? ` First issue: ${summary.errors[0]}` : "";
    return `Scan finished, but no video files were found in the selected folder.${errorSuffix}`;
  }
  const subtitleSearchLogs = summary.subtitleSearchLogs ?? [];
  const scannedFolders = [...summary.scannedRoots.normal, ...summary.scannedRoots.gentle].length;
  const blockedSuffix =
    summary.invalidFiles.length > 0
      ? ` ${summary.invalidFiles.length} incomplete or corrupt file${summary.invalidFiles.length === 1 ? "" : "s"} were not imported.`
      : "";
  const additionalIssues = Math.max(summary.errors.length - summary.invalidFiles.length, 0);
  const issueSuffix =
    additionalIssues > 0
      ? ` ${additionalIssues} additional issue${additionalIssues === 1 ? "" : "s"} were logged.`
      : "";
  const subtitleSuffix =
    subtitleSearchLogs.length > 0
      ? ` Subtitle lookup: ${subtitleSearchLogs[0]}${subtitleSearchLogs.length > 1 ? ` (+${subtitleSearchLogs.length - 1} more)` : ""}`
      : "";
  return `Scan complete. ${summary.imported} entries synced across ${summary.discovered} discovered file${summary.discovered === 1 ? "" : "s"} from ${scannedFolders} folder${scannedFolders === 1 ? "" : "s"}.${blockedSuffix}${issueSuffix}${subtitleSuffix}`;
}

export function getRejectedStatusLabel(status: ScanRejectedFile["status"]): string {
  switch (status) {
    case "incomplete": return "Unfinished";
    case "corrupt": return "Corrupt";
    default: return "Invalid";
  }
}

export function buildPosterBackfillMessage(summary: PosterBackfillSummary): string {
  if (summary.requested === 0) return "Every movie in the library already has a poster.";
  const errorSuffix =
    summary.errors.length > 0
      ? ` ${summary.errors.length} file${summary.errors.length === 1 ? "" : "s"} still could not be turned into posters.`
      : "";
  return `Poster backfill finished. ${summary.updated} poster${summary.updated === 1 ? "" : "s"} added, ${summary.skipped} skipped.${errorSuffix}`;
}

export function buildPosterRefreshMessage(summary: PosterBackfillSummary): string {
  if (summary.requested === 0) return "No posters were selected for regeneration.";
  const errorSuffix =
    summary.errors.length > 0
      ? ` ${summary.errors.length} title${summary.errors.length === 1 ? "" : "s"} still could not be refreshed.`
      : "";
  return `Poster regeneration finished. ${summary.updated} poster${summary.updated === 1 ? "" : "s"} refreshed, ${summary.skipped} skipped.${errorSuffix}`;
}

export function buildOrganizationPreview(
  settings: OrganizationSettings,
  movie: MovieRecord | null
): { normalPath: string; gentlePath: string; fileName: string } {
  const values = resolveOrganizationTemplateValues({
    title: movie?.title ?? "Sample Title",
    year: movie?.year ?? 2024,
    videoId: movie?.videoId ?? "FSDSS-799",
    actresses: movie?.actresses.length ? movie.actresses : ["Chiharu Mitsuha"],
    studio: movie?.videoId?.split("-")[0] ?? "FSDSS"
  });
  const fallbackMovieName = values.dvdId || values.title;
  return {
    normalPath: renderOrganizationPathTemplate(
      settings.normalPathTemplate, values, [fallbackMovieName]
    ).join("/"),
    gentlePath: renderOrganizationPathTemplate(
      settings.gentlePathTemplate, values, [values.studio, values.actress, fallbackMovieName]
    ).join("/"),
    fileName: renderOrganizationFileTemplate(settings.fileNameTemplate, values, fallbackMovieName)
  };
}

export function deriveStudioName(movie: Pick<MovieRecord, "videoId" | "keywords">): string {
  return movie.videoId?.split("-")[0] ?? movie.keywords[0] ?? "Unknown Studio";
}

export function deriveTagLabel(movie: Pick<MovieRecord, "keywords" | "libraryMode">): string {
  return movie.keywords[0] ?? movie.libraryMode;
}

export function deriveRegionLabel(
  movie: Pick<MovieRecord, "title" | "keywords" | "videoId" | "libraryMode">
): string {
  const haystack = [
    movie.title,
    movie.videoId ?? "",
    movie.keywords.join(" "),
    movie.libraryMode
  ]
    .join(" ")
    .toLowerCase();

  const rules: Array<[string, RegExp[]]> = [
    ["Japan", [/\bjapan(?:ese)?\b/i, /\bjav\b/i, /\bjp\b/i]],
    ["Chinese", [/\bchina(?:ese)?\b/i, /\bcn\b/i, /\bmandarin\b/i]],
    ["America", [/\bamerica(?:n)?\b/i, /\busa\b/i, /\bus\b/i, /\benglish\b/i]],
    ["Spain", [/\bspain(?:ish)?\b/i, /\bes\b/i, /\bespa(?:ña|na)\b/i]],
    ["Korea", [/\bkorea(?:n)?\b/i, /\bkr\b/i]],
    ["France", [/\bfrance(?:se|es)?\b/i, /\bfr\b/i]],
    ["Germany", [/\bgermany(?:an)?\b/i, /\bde\b/i]],
    ["Italy", [/\bitaly(?:an)?\b/i, /\bit\b/i]],
  ];

  for (const [region, patterns] of rules) {
    if (patterns.some((pattern) => pattern.test(haystack))) {
      return region;
    }
  }

  if (movie.libraryMode === "gentle" || /\b[0-9]{2,4}[a-z]{0,2}-[0-9]{2,4}\b/i.test(haystack)) {
    return "Japan";
  }

  return "Unknown";
}

export function getPosterSourceLabel(source: MovieRecord["posterSource"]): string {
  switch (source) {
    case "local": return "Local video frame";
    case "web": return "Web metadata";
    case "javdatabase": return "javdatabase poster";
    case "javbus": return "javbus poster";
    case "imdb": return "IMDb poster";
    case "tmdb": return "TMDB poster";
    default: return "No poster yet";
  }
}

// Short attribution badges: which site served this movie's cover. The
// legacy "web" (pre-attribution rows) renders as WEB.
export function getPosterSourceBadge(source: string): string | null {
  switch (source) {
    case "javdatabase": return "JDB";
    case "javbus": return "JAVBUS";
    case "imdb": return "IMDB";
    case "tmdb": return "TMDB";
    case "web": return "WEB";
    case "local": return null; // local frames are the app's own work — no badge
    default: return null;
  }
}

export function getPosterFallbackBackground(title: string): string {
  const palette = [
    ["#ff7a3d", "#3b1d11"],
    ["#00bcd4", "#10203a"],
    ["#8bc34a", "#1c2615"],
    ["#f44336", "#2b1120"],
    ["#ffb300", "#31240b"],
    ["#6cc6bb", "#15262b"]
  ];
  const hash = Array.from(title).reduce((total, character) => total + character.charCodeAt(0), 0);
  const [startColor, endColor] = palette[hash % palette.length];
  return `linear-gradient(180deg, ${startColor}, ${endColor})`;
}
