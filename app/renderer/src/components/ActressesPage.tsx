import type React from "react";
import type { AppPage, LibraryMode, MovieRecord } from "../../../shared/contracts";
import { MovieTile } from "./MovieTile";

interface ActressEntry {
  name: string;
  count: number;
  posterUrl: string | null;
  movieIds: string[];
  inferred: boolean;
  modes: LibraryMode[];
  studio: string;
  tag: string;
  region: string;
}

interface ActressesPageProps {
  actressDirectory: ActressEntry[];
  selectedActress: string | null;
  setSelectedActress: (name: string | null) => void;
  actressGridCols: number;
  changeActressGridCols: (cols: number) => void;
  actressModeFilter: "all" | LibraryMode;
  setActressModeFilter: (mode: "all" | LibraryMode) => void;
  gentleUnlocked: boolean;
  actressSortMode: "count" | "studio" | "tag";
  setActressSortMode: (mode: "count" | "studio" | "tag") => void;
  isRefreshingActressPhotos: boolean;
  setIsRefreshingActressPhotos: (v: boolean) => void;
  actressPhotos: Record<string, string>;
  setActressPhotos: (photos: Record<string, string>) => void;
  allMoviesPool: MovieRecord[];
  movies: MovieRecord[];
  selectedMovieId: string | null;
  setSelectedMovieId: (id: string) => void;
  setActivePage: (page: AppPage) => void;
  setContextMenu: (menu: { movie: MovieRecord; x: number; y: number } | null) => void;
  setActressContextMenu: (menu: { name: string; x: number; y: number } | null) => void;
  selectedActressPhotos: string[];
  selectedActressRegion: string;
  setSelectedActressRegion: (value: string) => void;
  onAddActressPhoto: (name: string) => Promise<void>;
  onRemoveActressPhoto: (name: string, photoUrl?: string) => Promise<void>;
  onSetPrimaryActressPhoto: (name: string, photoUrl: string) => Promise<void>;
  onSaveActressRegion: (name: string, region: string) => Promise<void>;
  onRefreshActressPhotos: () => Promise<void>;
}

const REGION_OPTIONS = [
  "Japan",
  "Chinese",
  "America",
  "Spain",
  "Korea",
  "France",
  "Germany",
  "Italy",
  "Unknown",
];

export function ActressesPage({
  actressDirectory,
  selectedActress,
  setSelectedActress,
  actressGridCols,
  changeActressGridCols,
  actressModeFilter,
  setActressModeFilter,
  gentleUnlocked,
  actressSortMode,
  setActressSortMode,
  isRefreshingActressPhotos,
  allMoviesPool,
  movies,
  selectedMovieId,
  setSelectedMovieId,
  setActivePage,
  setContextMenu,
  setActressContextMenu,
  selectedActressPhotos,
  selectedActressRegion,
  setSelectedActressRegion,
  onAddActressPhoto,
  onRemoveActressPhoto,
  onSetPrimaryActressPhoto,
  onSaveActressRegion,
  onRefreshActressPhotos,
}: ActressesPageProps) {
  const activeActressEntry = selectedActress
    ? actressDirectory.find((a) => a.name === selectedActress)
    : null;
  const actressMovies = activeActressEntry
    ? (allMoviesPool.length > 0 ? allMoviesPool : movies).filter((m) =>
        activeActressEntry.movieIds.includes(m.id)
      )
    : [];

  if (selectedActress && activeActressEntry) {
    return (
      <section className="page actresses-page">
        <div className="panel actresses-detail-panel">
          <div className="panel-header">
            <div className="actress-detail-hero">
              <button
                className="ghost-button"
                onClick={() => setSelectedActress(null)}
                type="button"
              >
                ← Back
              </button>
              <div
                className="actress-avatar"
              >
                {activeActressEntry.posterUrl ? (
                  <img
                    alt={activeActressEntry.name}
                    className="actress-avatar-img"
                    src={activeActressEntry.posterUrl}
                  />
                ) : (
                  <div className="actress-avatar-fallback actress-avatar-fallback-detail">
                    {activeActressEntry.name
                      .split(" ")
                      .map((w) => w[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </div>
                )}
              </div>
              <div className="actress-detail-copy">
                <p className="eyebrow">Actress</p>
                <h3 style={{ margin: 0 }}>{activeActressEntry.name}</h3>
                <span className="actress-count actress-count-strong">
                  {activeActressEntry.count} title{activeActressEntry.count !== 1 ? "s" : ""} in library
                </span>
                <div className="actress-detail-chips">
                  <span>{activeActressEntry.region}</span>
                  <span>{activeActressEntry.studio}</span>
                  <span>{activeActressEntry.tag}</span>
                  <span>{activeActressEntry.modes.join(" · ")}</span>
                </div>
                <label className="form-field actress-region-field">
                  <span>Region</span>
                  <input
                    className="search-input"
                    list="actress-region-options"
                    onChange={(event) => setSelectedActressRegion(event.target.value)}
                    placeholder="Japan, Chinese, America..."
                    type="text"
                    value={selectedActressRegion}
                  />
                  <datalist id="actress-region-options">
                    {REGION_OPTIONS.map((region) => (
                      <option key={region} value={region} />
                    ))}
                  </datalist>
                </label>
                <div className="inline-actions">
                  <button
                    className="primary-button"
                    onClick={() => void onSaveActressRegion(activeActressEntry.name, selectedActressRegion)}
                    type="button"
                  >
                    Save region
                  </button>
                </div>
              </div>
            </div>
            <div className="inline-actions">
              <button
                className="secondary-button"
                onClick={() => void onAddActressPhoto(activeActressEntry.name)}
                type="button"
              >
                Add photo
              </button>
              <button
                className="ghost-button"
                onClick={() => void onRemoveActressPhoto(activeActressEntry.name)}
                type="button"
              >
                Remove all photos
              </button>
            </div>
          </div>
          {selectedActressPhotos.length > 0 && (
            <div className="actress-gallery">
              {selectedActressPhotos.map((photoUrl, index) => (
                <button
                  className={`actress-gallery-item${index === 0 ? " primary" : ""}`}
                  key={`${photoUrl}:${index}`}
                  onClick={() => void onSetPrimaryActressPhoto(activeActressEntry.name, photoUrl)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    void onRemoveActressPhoto(activeActressEntry.name, photoUrl);
                  }}
                  title={index === 0 ? "Primary photo" : "Click to set as primary. Right-click to remove."}
                  type="button"
                >
                  <img alt={`${activeActressEntry.name} ${index + 1}`} src={photoUrl} />
                </button>
              ))}
            </div>
          )}
          <div
            className="movie-grid actress-title-grid"
            style={{ "--cols": 4, marginTop: "1rem" } as React.CSSProperties}
          >
            {actressMovies.map((movie) => (
              <MovieTile
                key={movie.id}
                movie={movie}
                isActive={movie.id === selectedMovieId}
                separator="dot"
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ movie, x: e.clientX, y: e.clientY });
                }}
                onClick={() => {
                  setSelectedMovieId(movie.id);
                  setActivePage("library");
                }}
              />
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="page actresses-page">
      <div className="panel actresses-overview-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Actress profiles</p>
            <h3>
              {actressDirectory.length} actress{actressDirectory.length !== 1 ? "es" : ""} in your
              library
            </h3>
          </div>
          <div className="actress-zoom-bar">
            <div className="columns-control">
              <span>Sort</span>
              <select
                className="filter-select"
                value={actressSortMode}
                onChange={(e) => setActressSortMode(e.target.value as "count" | "studio" | "tag")}
              >
                <option value="count">1. Most titles</option>
                <option value="studio">2. Studio</option>
                <option value="tag">3. Tag</option>
              </select>
            </div>
            <button
              className="actress-zoom-btn"
              disabled={actressGridCols >= 9}
              onClick={() => changeActressGridCols(actressGridCols + 1)}
              title="Zoom out"
              type="button"
            >
              −
            </button>
            <span className="actress-zoom-label">{actressGridCols}</span>
            <button
              className="actress-zoom-btn"
              disabled={actressGridCols <= 2}
              onClick={() => changeActressGridCols(actressGridCols - 1)}
              title="Zoom in"
              type="button"
            >
              +
            </button>
          </div>
          <button
            className="ghost-button"
            disabled={isRefreshingActressPhotos}
            onClick={() => void onRefreshActressPhotos()}
            type="button"
          >
            {isRefreshingActressPhotos ? "Fetching photos…" : "🔄 Refresh photos"}
          </button>
        </div>
        <div className="actress-summary-strip">
          <div>
            <strong>{allMoviesPool.length || movies.length}</strong>
            <span>All titles</span>
          </div>
          <div>
            <strong>{(allMoviesPool.length > 0 ? allMoviesPool : movies).filter((m) => m.libraryMode === "normal").length}</strong>
            <span>Normal mode</span>
          </div>
          <div>
            <strong>{(allMoviesPool.length > 0 ? allMoviesPool : movies).filter((m) => m.libraryMode === "gentle").length}</strong>
            <span>Gentle mode</span>
          </div>
        </div>
        {/* Mode filter tabs */}
        <div className="actress-mode-tabs">
          {(["all", "normal", ...(gentleUnlocked ? ["gentle" as const] : [])] as const).map((mode) => {
            const pool = allMoviesPool.length > 0 ? allMoviesPool : movies;
            const visiblePool = gentleUnlocked ? pool : pool.filter((m) => m.libraryMode !== "gentle");
            const count =
              mode === "all"
                ? visiblePool.length
                : visiblePool.filter((m) => m.libraryMode === mode).length;
            return (
              <button
                key={mode}
                className={`actress-mode-tab${actressModeFilter === mode ? " active" : ""}`}
                onClick={() => {
                  setActressModeFilter(mode);
                  setSelectedActress(null);
                }}
                type="button"
              >
                {mode === "all" ? "All" : mode === "normal" ? "📂 Normal" : "🔒 Gentle"}
                <span className="actress-mode-count">
                  {count} titles
                </span>
              </button>
            );
          })}
        </div>
        {actressDirectory.length > 0 ? (
          <div
            className="actress-grid"
            style={{ "--actress-cols": actressGridCols } as React.CSSProperties}
          >
            {actressDirectory.map((actress) => (
              <button
                className="actress-card"
                key={actress.name}
                onClick={() => setSelectedActress(actress.name)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setActressContextMenu({ name: actress.name, x: e.clientX, y: e.clientY });
                }}
                title={`View ${actress.name}'s titles`}
                type="button"
              >
                <div className="actress-photo">
                  <div className="actress-avatar">
                    {actress.posterUrl ? (
                      <img
                        alt={actress.name}
                        className="actress-avatar-img"
                        src={actress.posterUrl}
                      />
                    ) : (
                      <div className="actress-avatar-fallback">
                        {actress.name
                          .split(" ")
                          .map((w) => w[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="actress-overlay">
                    <strong className="actress-name">{actress.name}</strong>
                    <span className="actress-count">
                      {actress.count} title{actress.count !== 1 ? "s" : ""}
                      {actress.inferred ? " · 📁" : ""}
                    </span>
                    <span className="actress-count actress-meta-line">{actress.region}</span>
                    <span className="actress-count actress-meta-line">{actress.studio}</span>
                    <span className="actress-count actress-meta-line">{actress.tag}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="subtle">
            {allMoviesPool.length === 0 && movies.length === 0
              ? "Scan your library first to see actresses here."
              : `No actresses found in ${actressModeFilter === "all" ? "your library" : `${actressModeFilter} mode`}.`}
          </p>
        )}
      </div>
    </section>
  );
}
