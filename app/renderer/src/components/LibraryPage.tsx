import { LibraryCounts } from "./LibraryCounts";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { LibraryMode, MovieRecord } from "../../../shared/contracts";
import { distinctPosterMovies } from "../distinctPosterMovies";
import { MovieTile } from "./MovieTile";

type SortMode =
  | "actress"
  | "import-date"
  | "dvd-id"
  | "studio"
  | "tag"
  | "actress-age"
  | "recent-add"
  | "oldest"
  | "newest";

interface LibraryPageProps {
  movies: MovieRecord[];
  sortedMovies: MovieRecord[];
  movieTotalCount: number;
  sortMode: SortMode;
  setSortMode: (mode: SortMode) => void;
  gridColumns: number;
  changeGridColumns: (cols: number) => void;
  selectedMovieId: string | null;
  selectedIdSet: Set<string>;
  isScanning: boolean;
  gridRef: React.RefObject<HTMLDivElement | null>;
  handleGridMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleTileClick: (movie: MovieRecord, event: React.MouseEvent) => void;
  toggleSelected: (movieId: string) => void;
  setContextMenu: (menu: { movie: MovieRecord; x: number; y: number } | null) => void;
  openScanOptions: (mode: LibraryMode) => void;
  selectAllMode: (mode: LibraryMode) => Promise<void>;
  gentleUnlocked: boolean;
  selectMissingPosterTitles: () => void;
  handleRefreshSelectedPosters: (movieIds?: string[]) => Promise<void>;
  handleBatchMove: (mode: LibraryMode) => Promise<void>;
  onRemoveMovies?: (ids: string[], action: "library" | "trash") => Promise<void>;
  loadMoreMovies: () => Promise<void>;
  PAGE_SIZE: number;
  onPlayMovie: (movie: MovieRecord) => void;
}

export function LibraryPage({
  movies,
  sortedMovies,
  movieTotalCount,
  sortMode,
  setSortMode,
  gridColumns,
  changeGridColumns,
  selectedMovieId,
  selectedIdSet,
  isScanning,
  gridRef,
  handleGridMouseDown,
  handleTileClick,
  toggleSelected,
  setContextMenu,
  openScanOptions,
  selectAllMode,
  gentleUnlocked,
  selectMissingPosterTitles,
  handleRefreshSelectedPosters,
  handleBatchMove,
  onRemoveMovies,
  loadMoreMovies,
  PAGE_SIZE,
  onPlayMovie,
}: LibraryPageProps) {
  const [groupCopies, setGroupCopies] = useState(true);
  const posterMovies = distinctPosterMovies(sortedMovies, groupCopies);
  const hasMoreMovies = movies.length < movieTotalCount;
  const loadMoreRef = useRef(loadMoreMovies);
  loadMoreRef.current = loadMoreMovies;
  const loadingMoreRef = useRef(false);
  const loadMoreBarRef = useRef<HTMLDivElement | null>(null);

  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);
  async function loadNextPage() {
    if (loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setLoadError(false);
    try { await loadMoreRef.current(); }
    catch { setLoadError(true); }
    finally { loadingMoreRef.current = false; setLoadingMore(false); }
  }

  // Infinite scroll: when the load-more bar approaches the viewport, fetch the
  // next page automatically. The manual button stays as a fallback. The guard
  // is required because loadMoreMovies has no reentrancy protection — two
  // overlapping calls would append the same page twice.
  useEffect(() => {
    const bar = loadMoreBarRef.current;
    if (!hasMoreMovies || loadError || !bar || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || loadingMoreRef.current) return;
        loadingMoreRef.current = true;
        void loadMoreRef.current().finally(() => {
          loadingMoreRef.current = false;
        });
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(bar);
    return () => observer.disconnect();
  }, [hasMoreMovies, movies.length, groupCopies, loadError]);

  return (
    <section className="page library-page">
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Library management</p>
            <h3>
              Your library
              {movieTotalCount > 0 && (
                <span className="movie-count-badge"> — {movieTotalCount.toLocaleString()} movies</span>
              )}
            </h3>
          </div>
          <div className="inline-actions">
            <button className="ghost-button" type="button" aria-pressed={groupCopies} onClick={() => setGroupCopies(value => !value)}>{groupCopies ? "Show duplicate copies" : "Hide duplicate copies"}</button>
            {onRemoveMovies && <><button className="ghost-button" type="button" disabled={isScanning || selectedIdSet.size === 0} onClick={() => void onRemoveMovies([...selectedIdSet], "library")}>Remove selected from library…</button><button className="ghost-button" type="button" disabled={isScanning || selectedIdSet.size === 0} onClick={() => void onRemoveMovies([...selectedIdSet], "trash")}>Move selected video files to Recycle Bin…</button></>}
            <div className="columns-control">
              <span>Sort</span>
              <select
                className="filter-select"
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
              >
                <option value="actress">1. Actress A–Z</option>
                <option value="studio">2. Studio</option>
                <option value="tag">3. Tag</option>
                <option value="import-date">4. Import Date</option>
                <option value="dvd-id">5. DVD ID</option>
                <option value="actress-age">6. Actress Age</option>
                <option value="recent-add">7. Recent Add</option>
                <option value="oldest">8. Oldest</option>
                <option value="newest">9. Newest</option>
              </select>
            </div>
            <div className="zoom-control">
              <button
                className="zoom-btn"
                disabled={gridColumns <= 3}
                onClick={() => changeGridColumns(gridColumns - 1)}
                title="Zoom in"
                type="button"
              >
                +
              </button>
              <span className="zoom-pct">{Math.round(300 / gridColumns)}%</span>
              <button
                className="zoom-btn"
                disabled={gridColumns >= 8}
                onClick={() => changeGridColumns(gridColumns + 1)}
                title="Zoom out"
                type="button"
              >
                −
              </button>
            </div>
            <button
              className="secondary-button"
              disabled={isScanning}
              onClick={() => openScanOptions("normal")}
              type="button"
            >
              <span className="mode-icon mode-icon-normal" aria-hidden="true" /> Scan normal media folder
            </button>
            <button
              className="secondary-button"
              disabled={isScanning}
              onClick={() => openScanOptions("gentle")}
              type="button"
            >
              <span className="mode-icon mode-icon-gentle" aria-hidden="true" /> Scan gentle media folder
            </button>
            <button className="ghost-button" disabled={isScanning} type="button" onClick={() => void selectAllMode("normal")}>
              <span className="mode-icon mode-icon-normal" aria-hidden="true" /> Select all Normal
            </button>
            <button className="ghost-button" disabled={isScanning || !gentleUnlocked} title={gentleUnlocked ? "Select every Gentle video, including unloaded pages" : "Unlock Gentle mode to select its videos"} type="button" onClick={() => void selectAllMode("gentle")}>
              <span className="mode-icon mode-icon-gentle" aria-hidden="true" /> Select all Gentle
            </button>
            <button
              className="ghost-button"
              disabled={isScanning}
              onClick={selectMissingPosterTitles}
              type="button"
            >
              Select missing posters
            </button>
            <button
              className="ghost-button"
              disabled={isScanning || selectedIdSet.size === 0}
              onClick={() => void handleRefreshSelectedPosters()}
              type="button"
            >
              Regenerate selected posters
            </button>
            <button
              className="ghost-button"
              onClick={() => void handleBatchMove("normal")}
              type="button"
            >
              Move selected to normal
            </button>
            <button
              className="ghost-button"
              onClick={() => void handleBatchMove("gentle")}
              type="button"
            >
              Move selected to gentle
            </button>
          </div>
        </div>

        <LibraryCounts gentleUnlocked={gentleUnlocked} loaded={movies.length} shown={posterMovies.length} matched={movieTotalCount} grouped={groupCopies} />
        <div
          className="movie-grid"
          onMouseDown={handleGridMouseDown}
          ref={gridRef}
          style={{ "--cols": gridColumns, marginTop: "1rem" } as React.CSSProperties}
        >
          {posterMovies.map((movie) => (
            <MovieTile
              key={movie.id}
              movie={movie}
              isActive={movie.id === selectedMovieId}
              isSelected={selectedIdSet.has(movie.id)}
              showCheckbox
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ movie, x: e.clientX, y: e.clientY });
              }}
              onClick={(event) => handleTileClick(movie, event)}
              onToggleSelect={() => toggleSelected(movie.id)}
              onPlay={() => onPlayMovie(movie)}
            />
          ))}
        </div>
        {hasMoreMovies && (
          <div className="load-more-bar" ref={loadMoreBarRef}>
            <span className="load-more-count">{movies.length} of {movieTotalCount} movies</span>
            <button
              className="ghost-button"
              disabled={loadingMore}
              onClick={() => void loadNextPage()}
              type="button"
            >
              {loadingMore ? "Loading more…" : loadError ? "Retry loading" : `Load ${Math.min(PAGE_SIZE, movieTotalCount - movies.length)} more`}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
