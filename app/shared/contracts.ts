export type LibraryMode = "normal" | "gentle";
export type ScanMode = LibraryMode | "all";

export type AppPage =
  | "home"
  | "library"
  | "search"
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
  year: number | null;
  videoId: string | null;
  sourcePath: string;
  folderPath: string;
  libraryMode: LibraryMode;
  resolution: string;
  posterUrl: string | null;
  posterSource: "none" | "local" | "web";
  actresses: string[];
  keywords: string[];
  subtitles: SubtitleRecord[];
  updatedAt: string;
}

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

export interface AppShellState {
  version: string;
  platform: string;
  gentleUnlocked: boolean;
  themeMode: "dark" | "light";
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
  copyToLibrary: boolean;
  scanAllSubfolders: boolean;
  resolveLongPath: boolean;
  autoConvertToMp4: boolean;
  autoMatchSubtitle: boolean;
  autoDownloadSubtitleFromSubtitleCat: boolean;
  preferredSubtitleLanguage: SubtitleLanguagePreference;
  addToNormalModeLibrary: boolean;
  addToGentleModeLibrary: boolean;
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
