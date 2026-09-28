import type {
  AppShellState,
  ConvertVideoResult,
  GuardsChainSegmentsResult,
  GuardsChainState,
  MetadataSettings,
  LibraryMode,
  MovieRecord,
  OnlineSubtitleResult,
  OrganizationSettings,
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
  SubtitleScanResult
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
      getAppState: () => Promise<AppShellState>;
      getGuardsChainState: () => Promise<GuardsChainState>;
      listGuardsChainSegments: () => Promise<GuardsChainSegmentsResult>;
      saveMetadataSettings: (settings: MetadataSettings) => Promise<AppShellState>;
      saveOrganizationSettings: (settings: OrganizationSettings) => Promise<AppShellState>;
      pickLibraryFolder: () => Promise<string | null>;
      openFile: (filePath: string) => Promise<void>;
      showInFolder: (filePath: string) => Promise<void>;
      pickScanFolder: (options: ScanAutomationOptions) => Promise<ScanSummary>;
      listMovies: (query?: string, limit?: number, offset?: number) => Promise<MovieRecord[]>;
      countMovies: (query?: string) => Promise<number>;
      listAllMovies: () => Promise<MovieRecord[]>;
      ensureMoviePosters: (movieIds: string[]) => Promise<PosterBackfillSummary>;
      refreshMoviePosters: (movieIds: string[]) => Promise<PosterBackfillSummary>;
      backfillMissingPosters: () => Promise<PosterBackfillSummary>;
      scanLibraries: (options?: ScanAutomationOptions) => Promise<ScanSummary>;
      cancelScan: () => Promise<void>;
      addLibraryRoot: (mode: LibraryMode) => Promise<AppShellState>;
      moveMovie: (movieId: string, mode: LibraryMode) => Promise<MovieRecord>;
      moveMovies: (movieIds: string[], mode: LibraryMode) => Promise<MovieRecord[]>;
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
      playerGetSettings: () => Promise<PlayerSettings>;
      playerSaveSettings: (settings: PlayerSettings) => Promise<PlayerSettings>;
      playerGetPlaybackCheckpoint: (movieId: string) => Promise<PlaybackCheckpoint | null>;
      playerSavePlaybackCheckpoint: (movieId: string, positionSeconds: number) => Promise<PlaybackCheckpoint>;
      playerClearPlaybackCheckpoint: (movieId: string) => Promise<void>;
      playerGetFileUrl: (filePath: string, folderPath?: string | null) => Promise<string>;
      playerConvertToMp4: (filePath: string) => Promise<ConvertVideoResult>;
      onScanProgress: (handler: (progress: ScanProgress) => void) => () => void;
      onGentleUnlockResult: (handler: (result: { ok: boolean; message: string }) => void) => () => void;
      resolveDuplicate: (keepPath: string, deletePaths: string[], gentleUnlocked?: boolean) => Promise<{ deleted: number; blocked: number }>;
      addSubtitleDir: () => Promise<AppShellState>;
      removeSubtitleDir: (dir: string) => Promise<AppShellState>;
      scanSubtitleDirs: () => Promise<SubtitleScanResult>;
      addVideoFiles: () => Promise<{ added: number; skipped: number }>;
      generateSubtitleForMovie: (movieId: string, options: SubtitleGenerationOptions) => Promise<SubtitleGenerationResult>;
      getSubtitleModelAvailability: (model: SubtitleGenerationOptions["model"]) => Promise<SubtitleModelAvailability>;
      downloadSubtitleModel: (model: SubtitleGenerationOptions["model"]) => Promise<SubtitleModelDownloadResult>;
      onSubtitleModelDownloadProgress: (handler: (progress: SubtitleModelDownloadProgress) => void) => () => void;
      previewSubtitleOutput: (movieId: string, options: SubtitleGenerationOptions) => Promise<SubtitleGenerationPreview>;
    };
  }
}

export {};
