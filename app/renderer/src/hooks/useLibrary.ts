import { distinctPosterMovies } from "../distinctPosterMovies";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { AppPage, LibraryMode, MovieModeCounts, MovieRecord } from "../../../shared/contracts";
import { deriveRegionLabel, deriveStudioName, deriveTagLabel } from "../utils";

const PAGE_SIZE = 200;

interface UseLibraryOptions {
  desktopApi: typeof window.desktopApi | undefined;
  /** Triggers a movie-list re-fetch when the gentle-unlock status changes. */
  gentleUnlocked: boolean | undefined;
  /** Whether a scan is currently active (controls poster warmup effect). */
  isScanning: boolean;
  setActivePage: Dispatch<SetStateAction<AppPage>>;
  actressRegions: Record<string, string>;
}

export function useLibrary({
  desktopApi,
  gentleUnlocked,
  isScanning,
  setActivePage,
  actressRegions,
}: UseLibraryOptions) {
  const [movies, setMovies] = useState<MovieRecord[]>([]);
  const [movieTotalCount, setMovieTotalCount] = useState(0);
  const [movieModeCounts, setMovieModeCounts] = useState<MovieModeCounts>({ total: 0, normal: 0, gentle: 0 });
  const [movieLoadOffset, setMovieLoadOffset] = useState(0);
  const [sortMode, setSortMode] = useState<
    "actress" | "import-date" | "dvd-id" | "studio" | "tag" | "actress-age" | "recent-add" | "oldest" | "newest"
  >("recent-add");
  const [selectedMovieId, setSelectedMovieId] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [allMoviesPool, setAllMoviesPool] = useState<MovieRecord[]>([]);
  const [actressPhotos, setActressPhotos] = useState<Record<string, string>>({});
  const [selectedActress, setSelectedActress] = useState<string | null>(null);
  const [actressModeFilter, setActressModeFilter] = useState<"all" | "normal" | "gentle">("all");
  const [actressSortMode, setActressSortMode] = useState<"count" | "studio" | "tag">("count");
  const [actressGridCols, setActressGridCols] = useState(() => {
    const saved = localStorage.getItem("mla-actress-cols");
    return saved ? Math.max(2, Math.min(9, Number(saved))) : 5;
  });
  const [gridColumns, setGridColumns] = useState(() => {
    const saved = localStorage.getItem("mla-grid-cols");
    return saved ? Math.max(3, Math.min(8, Number(saved))) : 4;
  });

  const deferredSearch = useDeferredValue(searchInput);

  const moviesRef = useRef(movies);
  moviesRef.current = movies;
  const selectedMovieIdRef = useRef(selectedMovieId);
  selectedMovieIdRef.current = selectedMovieId;
  const gridColumnsRef = useRef(gridColumns);
  gridColumnsRef.current = gridColumns;
  const isScanningRef = useRef(isScanning);
  isScanningRef.current = isScanning;
  const posterWarmupRef = useRef<Set<string>>(new Set());
  const deferredSearchRef = useRef(deferredSearch);
  deferredSearchRef.current = deferredSearch;

  const libraryRequest = useRef(0);
  const libraryLoading = useRef(false);
  const libraryAppending = useRef(false);
  const libraryOffset = useRef(0);
  useEffect(() => {
    const change = () => { libraryRequest.current++; setMovieTotalCount(0); setMovieLoadOffset(0); setMovies([]); setSelectedMovieId(null); void refreshMovies(deferredSearchRef.current); };
    window.addEventListener('mla-library-mode',change);
    return () => window.removeEventListener('mla-library-mode',change);
  },[desktopApi]);
  useEffect(() => { if (!gentleUnlocked && desktopApi?.getLibraryViewMode?.() === 'gentle') {desktopApi.setLibraryViewMode('normal');window.dispatchEvent(new CustomEvent('mla-library-mode',{detail:'normal'}));} },[desktopApi,gentleUnlocked]);

  const sortedMovies = useMemo(
    () =>
      [...movies].sort((a, b) => {
        switch (sortMode) {
          case "actress":
            return (a.actresses[0] ?? "").localeCompare(b.actresses[0] ?? "");
          case "actress-age":
            return (b.actresses[0] ?? "").localeCompare(a.actresses[0] ?? "");
          case "import-date":
            return a.updatedAt.localeCompare(b.updatedAt);
          case "recent-add":
            return b.updatedAt.localeCompare(a.updatedAt);
          case "dvd-id":
            return (a.videoId ?? "").localeCompare(b.videoId ?? "");
          case "studio":
            return deriveStudioName(a).localeCompare(deriveStudioName(b));
          case "tag":
            return deriveTagLabel(a).localeCompare(deriveTagLabel(b));
          case "oldest":
            return (a.year ?? 9999) - (b.year ?? 9999);
          case "newest":
            return (b.year ?? 0) - (a.year ?? 0);
          default:
            return 0;
        }
      }),
    [movies, sortMode]
  );

  const actressDirectory = useMemo(() => {
    const raw = allMoviesPool.length > 0 ? allMoviesPool : movies;
    // When gentle mode is locked, exclude gentle-library movies entirely
    const pool = gentleUnlocked ? raw : raw.filter((m) => m.libraryMode !== "gentle");
    const filtered =
      actressModeFilter === "all"
        ? pool
        : pool.filter((m) => m.libraryMode === actressModeFilter);
    type ActressAggregate = {
      name: string;
      count: number;
      posterUrl: string | null;
      movieIds: string[];
      modes: Set<LibraryMode>;
      studios: Map<string, number>;
      tags: Map<string, number>;
      regions: Map<string, number>;
    };
    const data = new Map<string, ActressAggregate>();
    function getDominantLabel(values: Map<string, number>): string {
      let winner = "Unknown";
      let winnerCount = -1;
      for (const [label, count] of values.entries()) {
        if (count > winnerCount || (count === winnerCount && label.localeCompare(winner) < 0)) {
          winner = label;
          winnerCount = count;
        }
      }
      return winner;
    }
    for (const movie of filtered) {
      const actresses = new Map<string, string>();
      for (const rawName of movie.actresses) {
        const name = rawName.trim().replace(/\s+/g, " ");
        const key = name.normalize("NFKC").toLowerCase();
        if (!key || /^(?:unknown(?: (?:actress|actor|cast))?|unknow|n\/a|none|uncredited|(?:test )?fixtures?|[-–—])$/.test(key)) continue;
        // Catalog codes and release names can appear in older cast metadata.
        if (/^[a-z]{2,12}[-_]\d{2,8}(?:[-_ .].*)?$/.test(key)) continue;
        if (!actresses.has(key)) actresses.set(key, name);
      }
      if (!actresses.size) actresses.set("unknown", "Unknown");
      for (const [key, actress] of actresses) {
        const entry: ActressAggregate = data.get(key) ?? {
          name: actress,
          count: 0,
          posterUrl: null,
          movieIds: [],
          modes: new Set<LibraryMode>(),
          studios: new Map<string, number>(),
          tags: new Map<string, number>(),
          regions: new Map<string, number>(),
        };
        entry.count += 1;
        entry.movieIds.push(movie.id);
        entry.modes.add(movie.libraryMode);
        const studio = deriveStudioName(movie);
        entry.studios.set(studio, (entry.studios.get(studio) ?? 0) + 1);
        const tag = deriveTagLabel(movie);
        entry.tags.set(tag, (entry.tags.get(tag) ?? 0) + 1);
        const region = deriveRegionLabel(movie);
        entry.regions.set(region, (entry.regions.get(region) ?? 0) + 1);
        if (key !== "unknown") {
          const dedicatedPhoto = actressPhotos[entry.name] ?? actressPhotos[actress];
          entry.posterUrl = dedicatedPhoto ?? entry.posterUrl ?? movie.posterUrl ?? null;
        }
        data.set(key, entry);
      }
    }
    return Array.from(data.values())
      .map(info => ({
        name: info.name,
        count: info.count,
        posterUrl: info.posterUrl,
        movieIds: info.movieIds,
        modes: Array.from(info.modes) as LibraryMode[],
        region: info.name === "Unknown" ? "Unknown" : actressRegions[info.name] ?? getDominantLabel(info.regions),
        studio: getDominantLabel(info.studios),
        tag: getDominantLabel(info.tags),
      }))
      .sort((a, b) => {
        switch (actressSortMode) {
          case "studio":
            return a.studio.localeCompare(b.studio) || a.name.localeCompare(b.name);
          case "tag":
            return a.tag.localeCompare(b.tag) || a.name.localeCompare(b.name);
          case "count":
          default:
            return b.count - a.count || a.name.localeCompare(b.name);
        }
      });
  }, [allMoviesPool, movies, actressModeFilter, actressPhotos, actressRegions, gentleUnlocked, actressSortMode]);

  // Reset pagination and refresh when search or gentle-lock status changes
  useEffect(() => {
    if (!desktopApi) return;
    setMovieLoadOffset(0);
    void refreshMovies(deferredSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktopApi, gentleUnlocked, deferredSearch]);

  // Poster warmup: back-fill posters for movies that are missing one
  useEffect(() => {
    if (!desktopApi || isScanning) return;
    const all = moviesRef.current;
    if (all.length === 0) return;

    const missingPosterIds = all
      .filter((movie) => !movie.posterUrl && !posterWarmupRef.current.has(movie.id))
      .map((movie) => movie.id);

    if (missingPosterIds.length === 0) return;

    for (const movieId of missingPosterIds) {
      posterWarmupRef.current.add(movieId);
    }

    void desktopApi
      .ensureMoviePosters(missingPosterIds)
      .then(async (summary) => {
        if (summary.updated > 0) {
          await refreshPostersOnly();
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktopApi, isScanning]);

  async function refreshMovies(query?: string, append = false): Promise<void> {
    if (!desktopApi) return;

    if (append && (libraryLoading.current || libraryAppending.current)) return;
    const request = append ? libraryRequest.current : ++libraryRequest.current;
    if (append) libraryAppending.current = true; else {libraryLoading.current = true; libraryOffset.current = 0;}
    const viewMode = desktopApi.getLibraryViewMode?.() ?? 'all';
    const offset = append ? libraryOffset.current : 0;
    try {
    const [nextMovies, modeCounts] = await Promise.all([
      desktopApi.listMovies(query, PAGE_SIZE, offset),
      append ? Promise.resolve(null) : desktopApi.countMoviesByMode(query),
    ]);

    startTransition(() => {
      setMovies((prev) => distinctPosterMovies(append ? [...prev, ...nextMovies] : nextMovies, false));
      if (!append) {
        if (modeCounts) {
          setMovieTotalCount(viewMode === "all" ? modeCounts.total : modeCounts[viewMode]);
          setMovieModeCounts(modeCounts);
        }
        setMovieLoadOffset(nextMovies.length);
      } else {
        setMovieLoadOffset((prev) => prev + nextMovies.length);
      }
      if (!selectedMovieIdRef.current && nextMovies.length > 0) {
        setSelectedMovieId(nextMovies[0].id);
      }
      if (!append && nextMovies.length === 0 && !isScanningRef.current && viewMode === "all") {
        const libraryPages = new Set(["library", "search"]);
        setActivePage((current) =>
          libraryPages.has(current) ? "home" : current
        );
      }
    });
    } finally {if(request===libraryRequest.current){libraryLoading.current=false;libraryAppending.current=false;}}
  }

  async function loadMoreMovies(): Promise<void> {
    if (!desktopApi) return;
    await refreshMovies(deferredSearchRef.current, true);
  }

  async function refreshPostersOnly(): Promise<void> {
    if (!desktopApi) return;
    const movieIds = moviesRef.current.map((m) => m.id);
    if (movieIds.length === 0) return;
    const nextMovies = await desktopApi.listMovies(
      deferredSearchRef.current,
      movieIds.length,
      0
    );
    startTransition(() => {
      setMovies((current) => {
        const posterMap = new Map(nextMovies.map((m) => [m.id, m.posterUrl]));
        return current.map((movie) =>
          posterMap.has(movie.id)
            ? { ...movie, posterUrl: posterMap.get(movie.id) ?? null }
            : movie
        );
      });
    });
  }

  function changeGridColumns(cols: number): void {
    const clamped = Math.max(3, Math.min(8, cols));
    setGridColumns(clamped);
    localStorage.setItem("mla-grid-cols", String(clamped));
  }

  function changeActressGridCols(cols: number): void {
    const clamped = Math.max(2, Math.min(9, cols));
    setActressGridCols(clamped);
    localStorage.setItem("mla-actress-cols", String(clamped));
  }

  return {
    movies,
    setMovies,
    movieTotalCount,
    setMovieTotalCount,
    movieModeCounts,
    movieLoadOffset,
    setMovieLoadOffset,
    sortMode,
    setSortMode,
    selectedMovieId,
    setSelectedMovieId,
    searchInput,
    setSearchInput,
    allMoviesPool,
    setAllMoviesPool,
    actressPhotos,
    setActressPhotos,
    selectedActress,
    setSelectedActress,
    actressModeFilter,
    setActressModeFilter,
    actressSortMode,
    setActressSortMode,
    actressGridCols,
    changeActressGridCols,
    gridColumns,
    changeGridColumns,
    sortedMovies,
    actressDirectory,
    deferredSearch,
    moviesRef,
    selectedMovieIdRef,
    gridColumnsRef,
    posterWarmupRef,
    refreshMovies,
    loadMoreMovies,
    refreshPostersOnly,
  };
}
