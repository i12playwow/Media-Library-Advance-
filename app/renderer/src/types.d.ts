import type { ActressMetadataRescanSummary, LibraryMoveResult, FtsHealth, RelinkMissingResult } from "../../shared/contracts";
import type {
  AppShellState,
  ConvertVideoResult,
  GuardsChainSegmentsResult,
  GuardsChainState,
  MetadataSettings,
  LibraryMode,
  MovieModeCounts,
  MovieRecord,
  OnlineSubtitleResult,
  OrganizationSettings,
  MovieLabelMode,
  PlaybackCheckpoint,
  PlayerSettings,
  PosterBackfillSummary,
  ScanAutomationOptions,
  ScanProgress,
  ScanSummary,
  SubtitleModelAvailability,
  SubtitleModelDownloadProgress,
  SubtitleModelDownloadResult,
  SubtitleGenerationOptions,
  SubtitleGenerationPreview,
  SubtitleGenerationResult,
  SubtitleScanResult,
  MediaProcessingQueueState,
  MediaJobEnqueueResult,
  SubtitleQueueOptions
} from "../../shared/contracts";

declare global {
  interface Window {
    desktopApi: {
      getGentleShortcut: () => Promise<string>;
      setGentleShortcut: (shortcut: string) => Promise<boolean>;
      toggleGentleMode: () => Promise<AppShellState>;
      verifyGentlePin: (pin: string) => Promise<{ ok: boolean; message: string }>;
      getThemeMode: () => Promise<"dark" | "light">;
      setThemeMode: (themeMode: "dark" | "light") => Promise<AppShellState>;
      setDisplayName: (name: string) => Promise<AppShellState>;
      setMovieLabelMode: (mode: MovieLabelMode) => Promise<AppShellState>;
      getAppState: () => Promise<AppShellState>;
      openBrowser?: () => Promise<void>;
      getGuardsChainState: () => Promise<GuardsChainState>;
      listGuardsChainSegments: () => Promise<GuardsChainSegmentsResult>;
      saveMetadataSettings: (settings: MetadataSettings) => Promise<AppShellState>;
      saveOrganizationSettings: (settings: OrganizationSettings) => Promise<AppShellState>;
      pickLibraryFolder: () => Promise<string | null>;
      openFile: (filePath: string) => Promise<void>;
      showInFolder: (filePath: string) => Promise<void>;
      pickScanFolder: (options: ScanAutomationOptions) => Promise<ScanSummary>;
      getLibraryViewMode: () => "all" | "normal" | "gentle";
      setLibraryViewMode: (mode: "normal" | "gentle") => void;
      listMovies: (query?: string, limit?: number, offset?: number) => Promise<MovieRecord[]>;
      countMovies: (query?: string) => Promise<number>;
      countMoviesByMode: (query?: string) => Promise<MovieModeCounts>;
      linkActressMovies: (name: string, ids: string[]) => Promise<{ name: string; updated: string[]; failed: Array<{ id: string; error: string }> }>;
      rescanActressMetadata?: () => Promise<ActressMetadataRescanSummary>;
      librarySummary: () => Promise<{ cataloged: number; available: number | null; missing: number | null; normal: number; gentle: number | null; scope: "all" | "normal" }>;
      scanWholeSystem: (options: ScanAutomationOptions) => Promise<ScanSummary>;
      selectMovieModeIds: (mode: LibraryMode) => Promise<string[]>;
      removeMovies: (ids: string[], action: "library" | "trash" | "delete-permanently") => Promise<{ removed: string[]; failed: Array<{ id: string; error: string }>; cancelled: boolean }>;
      removeNoPosterNonAvMovies: () => Promise<{ removed: string[]; failed: Array<{ id: string; error: string }>; cancelled: boolean }>;
      sweepMissingMovies: () => Promise<MovieRecord[]>;
      forgetMissingMovie: (movieId: string) => Promise<{ deleted: boolean }>;
      relinkMissingMovie: (movieId: string) => Promise<RelinkMissingResult>;
      getFtsHealth: () => Promise<FtsHealth>;
      rebuildFtsIndex: () => Promise<boolean>;
      listAllMovies: () => Promise<MovieRecord[]>;
      ensureMoviePosters: (movieIds: string[]) => Promise<PosterBackfillSummary>;
      refreshMoviePosters: (movieIds: string[]) => Promise<PosterBackfillSummary>;
      backfillMissingPosters: () => Promise<PosterBackfillSummary>;
      scanLibraries: (options?: ScanAutomationOptions) => Promise<ScanSummary>;
      cancelScan: () => Promise<void>;
      addLibraryRoot: (mode: LibraryMode) => Promise<AppShellState>;
      renameMovieFile: (id: string, action: "rename" | "move" | "javdatabase") => Promise<{ changed: boolean; fileName?: string }>;
      setMovieDisplayName: (id: string, displayName: string) => Promise<boolean>;
      moveMovie: (movieId: string, mode: LibraryMode) => Promise<LibraryMoveResult>;
      moveMovies: (movieIds: string[], mode: LibraryMode) => Promise<LibraryMoveResult>;
      unlockGentle: (pin: string) => Promise<{ ok: boolean; message: string }>;
      toggleGentle: () => Promise<AppShellState>;
      getActressPhotos: () => Promise<Record<string, string>>;
      getActressRegions: () => Promise<Record<string, string>>;
      getActressRegion: (name: string) => Promise<string | null>;
      refreshActressPhotos: () => Promise<Record<string, string>>;
      actressSetPhoto: (name: string) => Promise<Record<string, string>>;
      actressRemovePhoto: (name: string, photoUrl?: string) => Promise<Record<string, string>>;
      actressListPhotos: (name: string) => Promise<string[]>;
      actressSetPrimaryPhoto: (name: string, photoUrl: string) => Promise<Record<string, string>>;
      actressSetRegion: (name: string, region: string) => Promise<Record<string, string>>;
      playerFetchSubtitles: (dvdId: string) => Promise<OnlineSubtitleResult[]>;
      playerDownloadSubtitle: (url: string) => Promise<string | null>;
      playerInstallSubtitle: (movieId: string, language: string, content: string) => Promise<string>;
      openPlayerWindow: (id?: string | null) => Promise<{ok:boolean}>;
      getPlayerWindowMovie: () => Promise<MovieRecord | null>;
      setPlayerFrameless: (frameless: boolean) => Promise<{ ok: boolean }>;
      playerWindowAction: (action: "minimize" | "maximize" | "close") => Promise<{ ok: boolean; maximized: boolean }>;
      onPlayerWindowMovie: (callback: (movie: MovieRecord | null) => void) => () => void;
      playerGetSettings: () => Promise<PlayerSettings>;
      playerSaveSettings: (settings: PlayerSettings) => Promise<PlayerSettings>;
      playerGetPlaybackCheckpoint: (movieId: string) => Promise<PlaybackCheckpoint | null>;
      playerSavePlaybackCheckpoint: (movieId: string, positionSeconds: number) => Promise<PlaybackCheckpoint>;
      playerClearPlaybackCheckpoint: (movieId: string) => Promise<void>;
      playerGetFileUrl: (filePath: string, folderPath?: string | null) => Promise<string>;
      playerConvertToMp4: (filePath: string) => Promise<ConvertVideoResult>;
      onScanProgress: (handler: (progress: ScanProgress) => void) => () => void;
      onGentleUnlockResult: (handler: (result: { ok: boolean; message: string }) => void) => () => void;
      resolveDuplicate: (keepPath: string, deletePaths: string[]) => Promise<{ deleted: number; blocked: number; failed: Array<{ path: string; error: string }> }>;
      addSubtitleDir: () => Promise<AppShellState>;
      removeSubtitleDir: (dir: string) => Promise<AppShellState>;
      scanSubtitleDirs: () => Promise<SubtitleScanResult>;
      addVideoFiles: () => Promise<{ added: number; skipped: number }>;
      generateSubtitleForMovie: (movieId: string, options: SubtitleGenerationOptions) => Promise<SubtitleGenerationResult>;
      getSubtitleModelAvailability: (model: SubtitleGenerationOptions["model"]) => Promise<SubtitleModelAvailability>;
      downloadSubtitleModel: (model: SubtitleGenerationOptions["model"]) => Promise<SubtitleModelDownloadResult>;
      onSubtitleModelDownloadProgress: (handler: (progress: SubtitleModelDownloadProgress) => void) => () => void;
      previewSubtitleOutput: (movieId: string, options: SubtitleGenerationOptions) => Promise<SubtitleGenerationPreview>;
      processingGetState: () => Promise<MediaProcessingQueueState>;
      processingEnqueueMovie: (movieId: string) => Promise<MediaProcessingQueueState>;
      processingEnqueueSubtitle: (movieId: string, settings: SubtitleQueueOptions) => Promise<MediaJobEnqueueResult>;
      processingCancelJob: (jobId: string) => Promise<MediaProcessingQueueState>;
      processingRetryJob: (jobId: string) => Promise<MediaProcessingQueueState>;
      processingRemoveJob: (jobId: string) => Promise<MediaProcessingQueueState>;
      processingClearFinished: () => Promise<MediaProcessingQueueState>;
      onProcessingChanged: (handler: (state: MediaProcessingQueueState) => void) => () => void;
    };
  }
}

export {};
