import { contextBridge, ipcRenderer } from "electron";
import type {
  AppShellState,
  ConvertVideoResult,
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
} from "../shared/contracts";

const api = {
  getGentleShortcut: (): Promise<string> =>
    ipcRenderer.invoke("settings:getGentleShortcut"),
  setGentleShortcut: (shortcut: string): Promise<boolean> =>
    ipcRenderer.invoke("settings:setGentleShortcut", shortcut),
  toggleGentleMode: (): Promise<AppShellState> =>
    ipcRenderer.invoke("gentle:toggle"),
  verifyGentlePin: (pin: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke("settings:verifyGentlePin", pin),
  getThemeMode: (): Promise<"dark" | "light"> =>
    ipcRenderer.invoke("settings:getThemeMode"),
  setThemeMode: (themeMode: "dark" | "light"): Promise<AppShellState> =>
    ipcRenderer.invoke("settings:setThemeMode", themeMode),
  getAppState: (): Promise<AppShellState> =>
    ipcRenderer.invoke("app:getState"),
  getGuardsChainState: (): Promise<GuardsChainState> =>
    ipcRenderer.invoke("guards:getChainState"),
  saveMetadataSettings: (settings: MetadataSettings): Promise<AppShellState> =>
    ipcRenderer.invoke("settings:saveMetadata", settings),
  saveOrganizationSettings: (settings: OrganizationSettings): Promise<AppShellState> =>
    ipcRenderer.invoke("settings:saveOrganization", settings),
  pickLibraryFolder: (): Promise<string | null> =>
    ipcRenderer.invoke("settings:pickLibraryFolder"),
  openFile: (filePath: string): Promise<void> =>
    ipcRenderer.invoke("shell:openFile", filePath),
  showInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke("shell:showInFolder", filePath),
  pickScanFolder: (options: ScanAutomationOptions): Promise<ScanSummary> =>
    ipcRenderer.invoke("movies:pickScan", options),
  listMovies: (query?: string, limit?: number, offset?: number): Promise<MovieRecord[]> =>
    ipcRenderer.invoke("movies:list", { query, limit, offset }),
  countMovies: (query?: string): Promise<number> =>
    ipcRenderer.invoke("movies:count", { query }),
  ensureMoviePosters: (movieIds: string[]): Promise<PosterBackfillSummary> =>
    ipcRenderer.invoke("movies:ensurePosters", movieIds),
  refreshMoviePosters: (movieIds: string[]): Promise<PosterBackfillSummary> =>
    ipcRenderer.invoke("movies:refreshPosters", movieIds),
  backfillMissingPosters: (): Promise<PosterBackfillSummary> =>
    ipcRenderer.invoke("movies:backfillPosters"),
  scanLibraries: (options?: ScanAutomationOptions): Promise<ScanSummary> =>
    ipcRenderer.invoke("movies:scan", options),
  cancelScan: (): Promise<void> =>
    ipcRenderer.invoke("scan:cancel"),
  addLibraryRoot: (mode: LibraryMode): Promise<AppShellState> =>
    ipcRenderer.invoke("library:addRoot", mode),
  moveMovie: (movieId: string, mode: LibraryMode): Promise<MovieRecord> =>
    ipcRenderer.invoke("movies:moveMode", movieId, mode),
  moveMovies: (movieIds: string[], mode: LibraryMode): Promise<MovieRecord[]> =>
    ipcRenderer.invoke("movies:batchMoveMode", movieIds, mode),
  unlockGentle: (pin: string): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke("auth:unlockGentle", pin),
  toggleGentle: (): Promise<AppShellState> =>
    ipcRenderer.invoke("auth:toggleGentle"),
  getActressPhotos: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke("actress:getPhotos"),
  getActressRegions: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke("actress:getRegions"),
  getActressRegion: (name: string): Promise<string | null> =>
    ipcRenderer.invoke("actress:getRegion", name),
  refreshActressPhotos: (): Promise<Record<string, string>> =>
    ipcRenderer.invoke("actress:refreshPhotos"),
  actressRemovePhoto: (name: string, photoUrl?: string): Promise<Record<string, string>> =>
    ipcRenderer.invoke("actress:removePhoto", name, photoUrl),
  actressListPhotos: (name: string): Promise<string[]> =>
    ipcRenderer.invoke("actress:listPhotos", name),
  actressSetPrimaryPhoto: (name: string, photoUrl: string): Promise<Record<string, string>> =>
    ipcRenderer.invoke("actress:setPrimaryPhoto", name, photoUrl),
  actressSetRegion: (name: string, region: string): Promise<Record<string, string>> =>
    ipcRenderer.invoke("actress:setRegion", name, region),
  listAllMovies: (): Promise<MovieRecord[]> =>
    ipcRenderer.invoke("movies:listAll"),
  playerFetchSubtitles: (dvdId: string): Promise<OnlineSubtitleResult[]> =>
    ipcRenderer.invoke("player:fetchSubtitles", dvdId),
  playerDownloadSubtitle: (url: string): Promise<string | null> =>
    ipcRenderer.invoke("player:downloadSubtitle", url),
  playerInstallSubtitle: (movieId: string, language: string, content: string): Promise<string> =>
    ipcRenderer.invoke("player:installSubtitle", movieId, language, content),
  playerGetSettings: (): Promise<PlayerSettings> =>
    ipcRenderer.invoke("player:getSettings"),
  playerSaveSettings: (settings: PlayerSettings): Promise<PlayerSettings> =>
    ipcRenderer.invoke("player:saveSettings", settings),
  playerGetPlaybackCheckpoint: (movieId: string): Promise<PlaybackCheckpoint | null> =>
    ipcRenderer.invoke("player:getPlaybackCheckpoint", movieId),
  playerSavePlaybackCheckpoint: (movieId: string, positionSeconds: number): Promise<PlaybackCheckpoint> =>
    ipcRenderer.invoke("player:savePlaybackCheckpoint", movieId, positionSeconds),
  playerClearPlaybackCheckpoint: (movieId: string): Promise<void> =>
    ipcRenderer.invoke("player:clearPlaybackCheckpoint", movieId),
  playerGetFileUrl: (filePath: string, folderPath?: string | null): Promise<string> =>
    ipcRenderer.invoke("player:getFileUrl", filePath, folderPath ?? null),
  playerConvertToMp4: (filePath: string): Promise<ConvertVideoResult> =>
    ipcRenderer.invoke("player:convertToMp4", filePath),
  onScanProgress: (handler: (progress: ScanProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ScanProgress) => {
      handler(progress);
    };
    ipcRenderer.on("scan:progress", listener);
    return () => {
      ipcRenderer.removeListener("scan:progress", listener);
    };
  },
  onGentleUnlockResult: (handler: (result: { ok: boolean; message: string }) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, result: { ok: boolean; message: string }) => {
      handler(result);
    };
    ipcRenderer.on("gentle:unlockResult", listener);
    return () => {
      ipcRenderer.removeListener("gentle:unlockResult", listener);
    };
  },
  resolveDuplicate: (keepPath: string, deletePaths: string[], gentleUnlocked?: boolean): Promise<{ deleted: number; blocked: number }> =>
    ipcRenderer.invoke("duplicates:resolve", keepPath, deletePaths, gentleUnlocked),
  actressSetPhoto: (name: string): Promise<Record<string, string>> =>
    ipcRenderer.invoke("actress:setPhoto", name),
  addSubtitleDir: (): Promise<AppShellState> =>
    ipcRenderer.invoke("subtitle:addDir"),
  removeSubtitleDir: (dir: string): Promise<AppShellState> =>
    ipcRenderer.invoke("subtitle:removeDir", dir),
  scanSubtitleDirs: (): Promise<SubtitleScanResult> =>
    ipcRenderer.invoke("subtitle:scan"),
  addVideoFiles: (): Promise<{ added: number; skipped: number }> =>
    ipcRenderer.invoke("movies:addFiles"),
  generateSubtitleForMovie: (movieId: string, options: SubtitleGenerationOptions): Promise<SubtitleGenerationResult> =>
    ipcRenderer.invoke("subtitle:generateForMovie", movieId, options),
  getSubtitleModelAvailability: (model: SubtitleGenerationOptions["model"]): Promise<SubtitleModelAvailability> =>
    ipcRenderer.invoke("subtitle:getModelAvailability", model),
  downloadSubtitleModel: (model: SubtitleGenerationOptions["model"]): Promise<SubtitleModelDownloadResult> =>
    ipcRenderer.invoke("subtitle:downloadModel", model),
  onSubtitleModelDownloadProgress: (handler: (progress: SubtitleModelDownloadProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: SubtitleModelDownloadProgress) => {
      handler(progress);
    };
    ipcRenderer.on("subtitle:modelDownloadProgress", listener);
    return () => {
      ipcRenderer.removeListener("subtitle:modelDownloadProgress", listener);
    };
  },
  previewSubtitleOutput: (movieId: string, options: SubtitleGenerationOptions): Promise<SubtitleGenerationPreview> =>
    ipcRenderer.invoke("subtitle:previewOutput", movieId, options)
};

contextBridge.exposeInMainWorld("desktopApi", api);

export type DesktopApi = typeof api;
