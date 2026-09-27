import type { Dispatch, SetStateAction } from "react";
import type {
  AppShellState,
  MovieRecord,
  PlayerSettings,
  SubtitleScanResult,
} from "../../../shared/contracts";
import { buildPosterBackfillMessage, buildPosterRefreshMessage } from "../utils";

interface UseMediaActionsProps {
  desktopApi: typeof window.desktopApi;
  selectedIds: string[];
  deferredSearch: string;
  playerSettings: PlayerSettings;
  refreshMovies: (query?: string) => Promise<void>;
  refreshPostersOnly: () => Promise<void>;
  setActressPhotos: Dispatch<SetStateAction<Record<string, string>>>;
  setAllMoviesPool: Dispatch<SetStateAction<MovieRecord[]>>;
  setStatusMessage: (msg: string) => void;
  setSubtitleScanRunning: Dispatch<SetStateAction<boolean>>;
  setSubtitleScanResult: Dispatch<SetStateAction<SubtitleScanResult | null>>;
  setAppState: Dispatch<SetStateAction<AppShellState | null>>;
  setIsRefreshingActressPhotos: Dispatch<SetStateAction<boolean>>;
}

export function useMediaActions({
  desktopApi,
  selectedIds,
  deferredSearch,
  playerSettings,
  refreshMovies,
  refreshPostersOnly,
  setActressPhotos,
  setAllMoviesPool,
  setStatusMessage,
  setSubtitleScanRunning,
  setSubtitleScanResult,
  setAppState,
  setIsRefreshingActressPhotos,
}: UseMediaActionsProps) {
  async function handleBackfillPosters(): Promise<void> {
    if (!desktopApi) {
      setStatusMessage("Desktop bridge unavailable. Restart MLA+ and try again.");
      return;
    }
    setStatusMessage("Generating posters for movies that do not have one yet...");
    try {
      const summary = await desktopApi.backfillMissingPosters();
      if (summary.updated > 0) await refreshMovies(deferredSearch);
      setStatusMessage(buildPosterBackfillMessage(summary));
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Poster backfill failed unexpectedly."
      );
    }
  }

  async function handleRefreshActressPhotos(): Promise<void> {
    if (!desktopApi) return;
    setIsRefreshingActressPhotos(true);
    try {
      const photos = await desktopApi.refreshActressPhotos();
      setActressPhotos(photos);
    } finally {
      setIsRefreshingActressPhotos(false);
    }
  }

  async function handleRefreshSelectedPosters(movieIds?: string[]): Promise<void> {
    if (!desktopApi) {
      setStatusMessage("Desktop bridge unavailable. Restart MLA+ and try again.");
      return;
    }
    const targetIds = Array.from(new Set(movieIds ?? selectedIds)).filter(Boolean);
    if (targetIds.length === 0) {
      setStatusMessage("Select at least one movie before regenerating posters.");
      return;
    }
    setStatusMessage(
      `Regenerating posters for ${targetIds.length} selected title${targetIds.length === 1 ? "" : "s"}...`
    );
    try {
      const summary = await desktopApi.refreshMoviePosters(targetIds);
      if (summary.updated > 0) await refreshPostersOnly();
      setStatusMessage(buildPosterRefreshMessage(summary));
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Poster regeneration failed unexpectedly."
      );
    }
  }

  async function handleAddSubtitleDir(): Promise<void> {
    if (!desktopApi) return;
    const next = await desktopApi.addSubtitleDir();
    setAppState(next);
  }

  async function handleRemoveSubtitleDir(dir: string): Promise<void> {
    if (!desktopApi) return;
    const next = await desktopApi.removeSubtitleDir(dir);
    setAppState(next);
  }

  async function handleRunSubtitleScan(): Promise<void> {
    if (!desktopApi) return;
    setSubtitleScanRunning(true);
    setSubtitleScanResult(null);
    try {
      const result = await desktopApi.scanSubtitleDirs();
      setSubtitleScanResult(result);
      if (result.matched > 0) {
        await refreshMovies(deferredSearch);
        try {
          const allMovies = await desktopApi.listAllMovies();
          setAllMoviesPool(allMovies);
        } catch { /* not critical */ }
      }
    } catch { /* ignore */ }
    setSubtitleScanRunning(false);
  }

  async function handleSavePlayerSettings(): Promise<void> {
    if (!desktopApi) return;
    await desktopApi.playerSaveSettings(playerSettings);
  }

  return {
    handleBackfillPosters,
    handleRefreshActressPhotos,
    handleRefreshSelectedPosters,
    handleAddSubtitleDir,
    handleRemoveSubtitleDir,
    handleRunSubtitleScan,
    handleSavePlayerSettings,
  };
}
