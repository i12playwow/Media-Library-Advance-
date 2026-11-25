import { memo } from "react";
import type { MovieLabelField, MovieRecord } from "../../../shared/contracts";
import { DEFAULT_MOVIE_LABEL_FIELDS, buildMovieLabel } from "../../../shared/movieLabels";
import { PosterVisual } from "./PosterVisual";

interface MovieTileProps {
  movie: MovieRecord;
  isActive: boolean;
  isSelected?: boolean;
  showCheckbox?: boolean;
  onContextMenu: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleSelect?: () => void;
  /** Quick-play overlay button. When provided, a play icon appears on the poster. */
  onPlay?: () => void;
  separator?: "dash" | "dot";
  /** Ordered metadata rows to print under the headline. Configured in Settings. */
  labelFields?: MovieLabelField[];
}

function MovieTileComponent({
  movie,
  isActive,
  isSelected = false,
  showCheckbox = false,
  onContextMenu,
  onClick,
  onToggleSelect,
  onPlay,
  separator = "dash",
  labelFields,
}: MovieTileProps) {
  // Always resolve through the same default list the settings screen starts
  // with, so a missing prop still renders the familiar ID/title/cast block.
  const { primary, details } = buildMovieLabel(labelFields ?? DEFAULT_MOVIE_LABEL_FIELDS, movie);
  const headline = primary ?? movie.title;
  return (
    <article
      className={[
        "movie-tile",
        isActive ? "active" : "",
        isSelected ? "selected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-movie-id={movie.id}
      key={movie.id}
      onContextMenu={onContextMenu}
    >
      {showCheckbox && onToggleSelect && (
        <label className="tile-check">
          <input
            checked={isSelected}
            onChange={onToggleSelect}
            type="checkbox"
          />
          <span />
        </label>
      )}
      {onPlay && (
        <button
          aria-label={`Play ${movie.title}`}
          className="tile-play"
          onClick={(event) => {
            event.stopPropagation();
            onPlay();
          }}
          // Right-click is not a play action: let it bubble so the tile's own
          // context menu opens even when the pointer is over this button.
          onMouseDown={(event) => event.stopPropagation()}
          title="Play"
          type="button"
        >
          <span aria-hidden="true">▶</span>
        </button>
      )}
      <button className="tile-body" onClick={onClick} type="button">
        <PosterVisual movie={movie} />
        {movie.subtitles.length > 0 && (
          <span className="subtitle-watermark" role="img" aria-label="Subtitles available" title={`${movie.subtitles.length} subtitle file${movie.subtitles.length === 1 ? "" : "s"} detected`}>
            CC
          </span>
        )}
        <div className="poster-content">
          <span className="mode-pill" data-library-mode={movie.libraryMode}><span className={`mode-icon mode-icon-${movie.libraryMode}`} aria-hidden="true" />{movie.libraryMode === "gentle" ? "Gentle" : "Normal"}</span>
          <strong>{headline}</strong>
          {details.map((row) => (
            <small className="tile-detail" key={row.field} title={row.value}>
              <span className="tile-detail-label">{row.label}</span>
              {row.value}
            </small>
          ))}
          {separator === "dash" && labelFields?.includes("folder-path") && (
            <small className="muted-path">{movie.sourcePath}</small>
          )}
        </div>
      </button>
    </article>
  );
}

export const MovieTile = memo(MovieTileComponent, (prev, next) => {
  const prevFields = prev.labelFields ?? DEFAULT_MOVIE_LABEL_FIELDS;
  const nextFields = next.labelFields ?? DEFAULT_MOVIE_LABEL_FIELDS;
  return (
    prev.movie.id === next.movie.id &&
    prev.movie.title === next.movie.title &&
    prev.movie.displayName === next.movie.displayName &&
    prev.movie.posterUrl === next.movie.posterUrl &&
    prev.movie.posterSource === next.movie.posterSource &&
    prev.movie.year === next.movie.year &&
    prev.movie.resolution === next.movie.resolution &&
    prev.movie.libraryMode === next.movie.libraryMode &&
    prev.movie.sourcePath === next.movie.sourcePath &&
    prev.movie.videoId === next.movie.videoId &&
    prev.movie.studio === next.movie.studio &&
    prev.movie.series === next.movie.series &&
    prev.movie.actresses.join("\u0000") === next.movie.actresses.join("\u0000") &&
    prev.movie.keywords.join("\u0000") === next.movie.keywords.join("\u0000") &&
    prev.movie.subtitles.length === next.movie.subtitles.length &&
    prev.isActive === next.isActive &&
    prev.isSelected === next.isSelected &&
    prev.showCheckbox === next.showCheckbox &&
    prev.separator === next.separator &&
    prevFields.join(",") === nextFields.join(",")
  );
});
