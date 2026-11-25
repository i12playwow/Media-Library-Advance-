export type LibraryMode = "normal" | "gentle";
export type ScanMode = LibraryMode | "all";

export type AppPage =
  | "home"
  | "library"
  | "search"
  | "generation"
  | "actresses"
  | "player"
  | "settings";

export interface SubtitleRecord {
  id: string;
  language: string;
  path: string;
}

export type SubtitleGenerationLanguage = "auto" | "ja" | "zh";
export type SubtitleGenerationModel = "small" | "medium" | "large-v3";
export type SubtitleGenerationOutputMode = "library-default" | "output-srt" | "custom-directory";

export interface SubtitleGenerationOptions {
  language: SubtitleGenerationLanguage;
  model: SubtitleGenerationModel;
  outputMode: SubtitleGenerationOutputMode;
  outputDirectory?: string | null;
  outputFileName?: string | null;
}

export interface SubtitleGenerationResult {
  ok: boolean;
  message: string;
  subtitlePath: string | null;
  detectedLanguage: string | null;
  setupRequired: boolean;
}

export interface SubtitleGenerationPreview {
  outputPath: string | null;
  message: string | null;
}

export interface SubtitleModelAvailability {
  model: SubtitleGenerationModel;
  available: boolean;
  modelPath: string | null;
  message: string | null;
}

export interface SubtitleModelDownloadProgress {
  model: SubtitleGenerationModel;
  stage: "starting" | "downloading" | "completed" | "error";
  fileName: string | null;
  filesCompleted: number;
  totalFiles: number;
  downloadedBytes: number;
  totalBytes: number | null;
  percent: number;
  message: string;
}

export interface SubtitleModelDownloadResult {
  ok: boolean;
  model: SubtitleGenerationModel;
  available: boolean;
  modelPath: string | null;
  message: string;
  setupRequired: boolean;
}

export interface MovieModeCounts {
  /** Total titles matching the current filter; vanished files excluded. */
  total: number;
  normal: number;
  gentle: number;
}

export interface OnlineSubtitleResult {
  id: string;
  title: string;
  language: string;
  languageCode: string;
  downloadUrl: string;
  downloads: number;
}

export interface PlayerSettings {
  defaultVolume: number;
  subtitleFontSize: number;
  subtitleColor: string;
  autoPlayNext: boolean;
  rememberPosition: boolean;
  seekDuration: number;
  videoFilterPreset: "none" | "vivid" | "warm" | "cool" | "mono" | "sepia";
  videoFilterStrength: number;
}

export interface PlaybackCheckpoint {
  movieId: string;
  positionSeconds: number;
  updatedAt: string;
}

export interface MovieRecord {
  id: string;
  title: string;
  displayName: string | null;
  year: number | null;
  videoId: string | null;
  sourcePath: string;
  folderPath: string;
  libraryMode: LibraryMode;
  resolution: string;
  posterUrl: string | null;
  posterSource: PosterSource;
  actresses: string[];
  keywords: string[];
  /** Maker/label from the embedded NFO sidecar, when one was present. */
  studio?: string | null;
  /** Series name from the embedded NFO sidecar, when one was present. */
  series?: string | null;
  subtitles: SubtitleRecord[];
  updatedAt: string;
  sourceMissing?: boolean;
}

// Health snapshot of the search index, shown on the Settings screen.
export interface FtsHealth {
  available: boolean;
  movieCount: number;
  ftsCount: number;
  lastSweepAt: string | null;
  lastRebuildAt: string | null;
  recentSweeps: Array<{ at: string; durationMs: number; changedRows: number }>;
}

// Result of relinking a missing movie to its new video file.
export interface RelinkMissingResult {
  ok: boolean;
  sourcePath: string | null;
  error: string | null;
}

export type PosterSource = "none" | "local" | "web" | "javdatabase" | "javbus" | "imdb" | "tmdb" | "javdb";

// The specific web sources behind a poster, persisted in poster_source so
// the UI can attribute each cover to the site that served it.
export type MetadataSourceKind = "javdatabase" | "javbus" | "imdb" | "tmdb" | "javdb";

export interface LibraryRoots {
  normal: string[];
  gentle: string[];
}

export interface SubtitleScanResult {
  total: number;
  matched: number;
  skipped: number;
  unmatched: number;
}

export interface ConvertVideoResult {
  ok: boolean;
  url?: string;
  error?: string;
}

export type MediaProcessingJobKind = "convert-mp4" | "generate-subtitle";
export type MediaProcessingJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface MediaProcessingJob {
  id: string;
  movieId: string;
  movieTitle: string;
  kind: MediaProcessingJobKind;
  status: MediaProcessingJobStatus;
  progress: number;
  message: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MediaProcessingQueueState {
  jobs: MediaProcessingJob[];
  running: boolean;
}

/** What a subtitle job should do when the queue reaches it. The Sub-Gen page
 *  sends this so the Generation Center runs the exact settings the operator
 *  picked (language, model, output destination) instead of the defaults. */
export interface SubtitleQueueOptions {
  language: SubtitleGenerationLanguage;
  model: SubtitleGenerationModel;
  outputMode: SubtitleGenerationOutputMode;
  outputDirectory?: string | null;
  outputFileName?: string | null;
}

export interface MediaJobEnqueueResult {
  queue: MediaProcessingQueueState;
  /** Newly created job id — null when an identical job was already pending. */
  jobId: string | null;
}

export type MovieLabelMode = "display-name" | "title" | "filename";

/** Which metadata lines a library card shows. See shared/movieLabels.ts for
 *  the catalogue; `title` is always present so a card is never blank. */
import type { MovieLabelField } from "./movieLabels";
export type { MovieLabelField } from "./movieLabels";

export interface AppShellState {
  version: string;
  platform: string;
  gentleUnlocked: boolean;
  themeMode: "dark" | "light";
  displayName: string;
  movieLabelMode: MovieLabelMode;
  /** Ordered list of metadata lines shown on library cards. */
  movieLabelFields: MovieLabelField[];
  roots: LibraryRoots;
  subtitleDirs: string[];
  starterPinHint: string;
  metadataSettings: MetadataSettings;
  organizationSettings: OrganizationSettings;
  scanHistory: ScanHistoryEntry[];
}

export interface ScanRejectedFile {
  path: string;
  reason: string;
  status: "incomplete" | "corrupt" | "invalid";
}

export interface DuplicateFile {
  path: string;
  resolution: string;
  fileSize: number;
  autoSelected: boolean;
}

export interface DuplicateGroup {
  key: string;
  videoId: string | null;
  title: string;
  files: DuplicateFile[];
}

export interface PosterBackfillSummary {
  requested: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface ScanSummary {
  skippedAlreadyScanned?: number;
  discovered: number;
  imported: number;
  skipped: number;
  errors: string[];
  subtitleSearchLogs: string[];
  invalidFiles: ScanRejectedFile[];
  duplicateGroups: DuplicateGroup[];
  scannedRoots: LibraryRoots;
  cancelled: boolean;
}

export interface ScanHistoryEntry {
  createdAt: string;
  summary: ScanSummary;
}

export type ScanStage =
  | "idle"
  | "preparing"
  | "discovering"
  | "processing"
  | "completed"
  | "cancelled"
  | "error";

export interface ScanProgress {
  stage: ScanStage;
  mode: ScanMode;
  currentRoot: string | null;
  currentFile: string | null;
  processedFiles: number;
  totalFiles: number;
  imported: number;
  skipped: number;
  message: string;
}

export interface MetadataSettings {
  tmdbReadAccessToken: string;
  language: string;
  region: string;
  autoFetchWebPosters: boolean;
  tmdbNonCommercialUse: boolean;
  sourceProfile: MetadataSourceProfile;
}

export type MetadataSourceProfile =
  | "auto"
  | "adult-first"
  | "mainstream-first"
  | "local-only";

export interface OrganizationSettings {
  normalPathTemplate: string;
  gentlePathTemplate: string;
  fileNameTemplate: string;
  normalLibraryPath: string;
  gentleLibraryPath: string;
}

export type SubtitleLanguagePreference =
  | "en"
  | "ja"
  | "zh-hans"
  | "zh-hant"
  | "zh"
  | "ko"
  | "fr"
  | "es"
  | "de"
  | "pt"
  | "th"
  | "vi"
  | "id"
  | "ar"
  | "ru"
  | "it";

export interface ScanAutomationOptions {
  importOnlyCompleteVideos: boolean;
  importBetterQuality: boolean;
  autoResolveDuplicates: boolean;
  moveRename: boolean;
  renameOnly?: boolean;
  copyToLibrary: boolean;
  scanAllSubfolders: boolean;
  resolveLongPath: boolean;
  autoConvertToMp4: boolean;
  autoMatchSubtitle: boolean;
  autoDownloadSubtitleFromSubtitleCat: boolean;
  preferredSubtitleLanguage: SubtitleLanguagePreference;
  addToNormalModeLibrary: boolean;
  addToGentleModeLibrary: boolean;
  /** When true (default), files without a recognizable JAV-style code in the
   *  filename or parent folder are skipped during scanning. Set to false to
   *  import all video files regardless of filename pattern. */
  javOnly?: boolean;
  /** When true, online metadata (title from JAVDatabase, JavDB, IMDb, or TMDB)
   *  is used to rename the file and folder before placing it in the library.
   *  Only effective when moveRename is true. Falls back to the filename-parsed
   *  title when no online metadata is available. */
  autoMetadataRename?: boolean;
}

export const VIDEO_EXTENSIONS = [
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".wmv",
  ".m4v",
  ".webm"
];

export const SUBTITLE_EXTENSIONS = [".srt", ".vtt", ".ass", ".ssa"];

export interface GuardsChainState {
  ok: boolean;
  segments: number;
  entries: number;
  tipDigest: string | null;
  lastRun: string | null;
  verifiedAt: string;
}

// Per-segment breakdown of the chained log (guards:listSegments): each
// segment is a drill entry or an absorbed CI batch, ending in a chain line
// whose digest covers every byte before it.
export interface GuardsChainSegmentItem {
  kind: "entry" | "ci";
  timestamp: string;
  verdict: "holds" | "BROKEN";
  digestPrefix: string;
}

export interface GuardsChainSegment {
  kind: "entry" | "ci-batch";
  items: GuardsChainSegmentItem[];
  digest: string;
  entriesAtChain: number;
}

// Result of guards:listSegments. A discriminated union on purpose: verified
// means the full hash-chain replay passed; unverified means it failed and
// the attached parse-only breakdown (possibly null) is for inspection only;
// unavailable means the log could not be read at all. Callers must branch —
// there is no shape that shows segments without the caller knowing which
// guarantee backs them.
export type GuardsChainSegmentsResult =
  | { status: "verified"; segments: GuardsChainSegment[] }
  | { status: "unverified"; reason: "tampered"; segments: GuardsChainSegment[] | null }
  | { status: "unavailable" };

export interface LibraryMoveResult {
  moved: string[];
  failed: Array<{ id: string; error: string }>;
  skipped: number;
  cancelled: boolean;
}
export interface ActressMetadataRescanSummary {
  checked: number;
  updated: number;
  unknown: number;
  unreadable: number;
}
