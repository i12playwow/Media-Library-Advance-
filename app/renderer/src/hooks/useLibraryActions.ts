import { useRef, type Dispatch, type SetStateAction } from "react";
import type { AppShellState, LibraryMode, MovieRecord } from "../../../shared/contracts";

interface UseLibraryActionsProps {
  desktopApi: typeof window.desktopApi;
  movies: MovieRecord[];
  selectedIds: string[];
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  deferredSearch: string;
  refreshMovies: (query?: string) => Promise<void>;
  initFromAppState: (state: AppShellState) => void;
  setAppState: Dispatch<SetStateAction<AppShellState | null>>;
  setStatusMessage: (msg: string) => void;
}

export function useLibraryActions({
  desktopApi,
  movies,
  selectedIds,
  setSelectedIds,
  deferredSearch,
  refreshMovies,
  initFromAppState,
  setAppState,
  setStatusMessage,
}: UseLibraryActionsProps) {
  const selectionRequest = useRef(0);
  async function selectAllMode(mode: LibraryMode): Promise<void> {
    if (!desktopApi) return;
    const request = ++selectionRequest.current;
    try {
      const ids = await desktopApi.selectMovieModeIds(mode);
      if (request !== selectionRequest.current) return;
      setSelectedIds(ids);
      setStatusMessage(`${ids.length} ${mode === "gentle" ? "Gentle" : "Normal"} videos selected across the library.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not select this library mode.");
    }
  }
  async function moveSelection(ids: string[], mode: LibraryMode, bulk: boolean): Promise<void> {
    if (!desktopApi || ids.length === 0) return;
    try {
      const result = bulk ? await desktopApi.moveMovies(ids, mode) : await desktopApi.moveMovie(ids[0], mode);
      if (result.cancelled) return;
      if (bulk) {
        const moved = new Set(result.moved);
        setSelectedIds(current => current.filter(id => !moved.has(id)));
      }
      await refreshMovies(deferredSearch);
      setStatusMessage(`${result.moved.length} moved to ${mode === "gentle" ? "Gentle" : "Normal"} · ${result.skipped} already there · ${result.failed.length} failed.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not move the selected movies.");
    }
  }

  function handleMoveOne(movieId: string, mode: LibraryMode): Promise<void> {
    return moveSelection([movieId], mode, false);
  }

  function handleBatchMove(mode: LibraryMode): Promise<void> {
    return moveSelection(selectedIds, mode, true);
  }

  function selectMissingPosterTitles(): void {
    const missingIds = movies.filter((movie) => !movie.posterUrl).map((movie) => movie.id);
    setSelectedIds(missingIds);
    setStatusMessage(
      missingIds.length > 0
        ? `${missingIds.length} title${missingIds.length === 1 ? "" : "s"} without posters selected.`
        : "Every visible title already has a poster."
    );
  }

  async function handlePickLibraryFolder(): Promise<string | undefined> {
    if (!desktopApi) return undefined;
    const result = await desktopApi.pickLibraryFolder();
    return result ?? undefined;
  }

  return {
    selectAllMode,
    handleMoveOne,
    handleBatchMove,
    selectMissingPosterTitles,
    handlePickLibraryFolder,
  };
}
