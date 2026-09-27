import { memo } from "react";
import type { MovieRecord } from "../../../shared/contracts";
import { getPosterFallbackBackground } from "../utils";

export const PosterVisual = memo(function PosterVisual(props: {
  movie: MovieRecord;
  compact?: boolean;
  detail?: boolean;
}) {
  const { movie, compact = false, detail = false } = props;
  const className = detail
    ? "poster-visual detail"
    : compact
      ? "poster-visual compact"
      : "poster-visual";

  return (
    <div className={className}>
      {movie.posterUrl ? (
        <img alt={movie.title} className="poster-image" loading="lazy" src={movie.posterUrl} />
      ) : (
        <div
          className="poster-fallback"
          style={{ background: getPosterFallbackBackground(movie.title) }}
        >
          <div className="poster-fallback-content">
            <span>{movie.libraryMode}</span>
            <strong>{movie.title}</strong>
            <small>
              {movie.year ?? "Unknown year"} · {movie.resolution}
            </small>
          </div>
        </div>
      )}
      <div className="poster-shade" />
    </div>
  );
});
