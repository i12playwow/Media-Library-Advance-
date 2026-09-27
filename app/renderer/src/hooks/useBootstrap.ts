import { useEffect, useRef } from "react";
import { startTransition } from "react";
import type {
  AppPage,
  AppShellState,
  MovieRecord,
  PlayerSettings,
} from "../../../shared/contracts";

type DesktopApi = NonNullable<typeof window.desktopApi>;

const PAGE_SIZE = 200;

interface UseBootstrapOptions {
  desktopApi: DesktopApi | undefined;
  initFromAppState: (state: AppShellState) => void;
  setAppState: (state: AppShellState) => void;
  setMovies: (movies: MovieRecord[]) => void;
  setMovieTotalCount: (count: number) => void;
  setMovieLoadOffset: (offset: number) => void;
  setSelectedMovieId: (id: string) => void;
  setAllMoviesPool: (movies: MovieRecord[]) => void;
  setActressPhotos: (photos: Record<string, string>) => void;
  setPlayerSettings: (settings: PlayerSettings) => void;
  setPlayerVolume: (volume: number) => void;
  setStatusMessage: (message: string) => void;
}

export function useBootstrap({
  desktopApi,
  initFromAppState,
  setAppState,
  setMovies,
  setMovieTotalCount,
  setMovieLoadOffset,
  setSelectedMovieId,
  setAllMoviesPool,
  setActressPhotos,
  setPlayerSettings,
  setPlayerVolume,
  setStatusMessage,
}: UseBootstrapOptions) {
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (!desktopApi || bootstrappedRef.current) return;
    bootstrappedRef.current = true;

    void (async () => {
      const shellState = await desktopApi.getAppState();
      setAppState(shellState);
      initFromAppState(shellState);

      // Load first page of movies immediately
      try {
        const [firstPage, total] = await Promise.all([
          desktopApi.listMovies(undefined, PAGE_SIZE, 0),
          desktopApi.countMovies(),
        ]);
        startTransition(() => {
          setMovies(firstPage);
          setMovieTotalCount(total);
          setMovieLoadOffset(firstPage.length);
          if (firstPage.length > 0) setSelectedMovieId(firstPage[0].id);
        });
        setStatusMessage(
          total > 0
            ? `Library ready — ${total} movie${total === 1 ? "" : "s"} total, showing first ${firstPage.length}.`
            : "Desktop shell ready. Choose a media folder and scan it."
        );
      } catch {
        setStatusMessage("Desktop shell ready. Choose a media folder and scan it.");
      }

      // Load all movies pool for actress directory in background
      try {
        const allMovies = await desktopApi.listAllMovies();
        setAllMoviesPool(allMovies);
      } catch {
        /* not critical */
      }

      // Load cached actress photos
      try {
        const photos = await desktopApi.getActressPhotos();
        setActressPhotos(photos);
      } catch {
        /* not critical */
      }

      // Load player settings
      try {
        const ps = await desktopApi.playerGetSettings();
        setPlayerSettings(ps);
        setPlayerVolume(ps.defaultVolume);
      } catch {
        /* not critical */
      }
    })();
  }, [desktopApi]);
}
