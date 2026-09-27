import type React from "react";
import type { LibraryMode, MovieRecord } from "../../../shared/contracts";
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
  selectMissingPosterTitles: () => void;
  handleRefreshSelectedPosters: (movieIds?: string[]) => Promise<void>;
  handleBatchMove: (mode: LibraryMode) => Promise<void>;
  loadMoreMovies: () => Promise<void>;
  PAGE_SIZE: number;
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
  selectMissingPosterTitles,
  handleRefreshSelectedPosters,
  handleBatchMove,
  loadMoreMovies,
  PAGE_SIZE,
}: LibraryPageProps) {
  return (
    <section className="page library-page">
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Library management</p>
            <h3>
              Batch-safe local file control
              {movieTotalCount > 0 && (
                <span className="movie-count-badge"> — {movieTotalCount.toLocaleString()} movies</span>
              )}
            </h3>
          </div>
          <div className="inline-actions">
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
              Scan normal media folder
            </button>
            <button
              className="secondary-button"
              disabled={isScanning}
              onClick={() => openScanOptions("gentle")}
              type="button"
            >
              Scan gentle media folder
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

        <div
          className="movie-grid"
          onMouseDown={handleGridMouseDown}
          ref={gridRef}
          style={{ "--cols": gridColumns, marginTop: "1rem" } as React.CSSProperties}
        >
          {sortedMovies.map((movie) => (
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
            />
          ))}
        </div>
        {movies.length < movieTotalCount && (
          <div className="load-more-bar">
            <span className="load-more-count">{movies.length} of {movieTotalCount} movies</span>
            <button
              className="ghost-button"
              onClick={() => void loadMoreMovies()}
              type="button"
            >
              Load {Math.min(PAGE_SIZE, movieTotalCount - movies.length)} more
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
