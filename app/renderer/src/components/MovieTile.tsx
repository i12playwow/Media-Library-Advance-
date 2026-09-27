import { memo } from "react";
import type { MovieRecord } from "../../../shared/contracts";
import { PosterVisual } from "./PosterVisual";

interface MovieTileProps {
  movie: MovieRecord;
  isActive: boolean;
  isSelected?: boolean;
  showCheckbox?: boolean;
  onContextMenu: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onToggleSelect?: () => void;
  separator?: "dash" | "dot";
}

function MovieTileComponent({
  movie,
  isActive,
  isSelected = false,
  showCheckbox = false,
  onContextMenu,
  onClick,
  onToggleSelect,
  separator = "dash",
}: MovieTileProps) {
  const sep = separator === "dot" ? " · " : " - ";
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
      <button className="tile-body" onClick={onClick} type="button">
        <PosterVisual movie={movie} />
        {movie.subtitles.length > 0 && (
          <span className="subtitle-watermark" title={`${movie.subtitles.length} subtitle file${movie.subtitles.length === 1 ? "" : "s"} detected`}>
            SRT
          </span>
        )}
        <div className="poster-content">
          <span className="mode-pill">{movie.libraryMode}</span>
          <strong>{movie.title}</strong>
          <small>
            {movie.year ?? "Unknown year"}{sep}{movie.resolution}
          </small>
          {separator === "dash" && (
            <small className="muted-path">{movie.sourcePath}</small>
          )}
        </div>
      </button>
    </article>
  );
}

export const MovieTile = memo(MovieTileComponent, (prev, next) => {
  return (
    prev.movie.id === next.movie.id &&
    prev.movie.title === next.movie.title &&
    prev.movie.posterUrl === next.movie.posterUrl &&
    prev.movie.year === next.movie.year &&
    prev.movie.resolution === next.movie.resolution &&
    prev.movie.libraryMode === next.movie.libraryMode &&
    prev.movie.sourcePath === next.movie.sourcePath &&
    prev.movie.subtitles.length === next.movie.subtitles.length &&
    prev.isActive === next.isActive &&
    prev.isSelected === next.isSelected &&
    prev.showCheckbox === next.showCheckbox &&
    prev.separator === next.separator
  );
});
