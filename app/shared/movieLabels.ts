// Field catalogue for the library tile label. The operator ticks which
// metadata lines a card shows (DVD ID, title, actresses, tags, studio…), so
// the same movie renders differently on every install without any per-user
// database writes — the choice is a settings value, the rendering is here.
import { extractVideoId } from "./videoId";

export type MovieLabelField =
  | "dvd-id"
  | "title"
  | "display-name"
  | "actresses"
  | "tags"
  | "studio"
  | "series"
  | "year"
  | "resolution"
  | "filename"
  | "library-mode"
  | "subtitle-count"
  | "folder-path";

export interface MovieLabelFieldMeta {
  field: MovieLabelField;
  label: string;
  hint: string;
  /** Tiles would be unreadable with no title at all, so this cannot be off. */
  required?: boolean;
  /** Shown as the card's headline instead of a metadata row. */
  primary?: boolean;
}

export const MOVIE_LABEL_FIELDS: readonly MovieLabelFieldMeta[] = [
  { field: "title", label: "Title", hint: "Metadata title resolved from the file name or source site.", primary: true, required: true },
  { field: "display-name", label: "Display name", hint: "Your own label when you renamed the title in the library." },
  { field: "dvd-id", label: "DVD ID", hint: "Product code such as SSIS-123, read from the title or file name." },
  { field: "actresses", label: "Actress", hint: "Cast list from the local metadata." },
  { field: "tags", label: "Tag", hint: "First few keywords attached to the title." },
  { field: "studio", label: "Studio", hint: "Maker or label; read from embedded NFO metadata when present." },
  { field: "series", label: "Series", hint: "Series name; read from embedded NFO metadata when present." },
  { field: "year", label: "Year", hint: "Release year from the file name or NFO sidecar." },
  { field: "resolution", label: "Resolution", hint: "Detected from the video stream." },
  { field: "filename", label: "File name", hint: "Source video file name without its extension." },
  { field: "library-mode", label: "Library mode", hint: "Normal or Gentle badge." },
  { field: "subtitle-count", label: "Subtitle count", hint: "How many subtitle files the title has." },
  { field: "folder-path", label: "Folder path", hint: "Where the video lives on disk." }
] as const;

export const DEFAULT_MOVIE_LABEL_FIELDS: MovieLabelField[] = [
  "dvd-id",
  "title",
  "actresses",
  "year",
  "resolution"
];

const FIELD_IDS = new Set<string>(MOVIE_LABEL_FIELDS.map((entry) => entry.field));

/** Tolerates anything the settings file may hold: unknown ids are dropped,
 *  duplicates collapse, and the title always stays so a card is never blank. */
export function normalizeMovieLabelFields(value: unknown): MovieLabelField[] {
  const raw = Array.isArray(value) ? value : [];
  const seen = new Set<MovieLabelField>();
  const result: MovieLabelField[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || !FIELD_IDS.has(entry)) {
      continue;
    }
    const field = entry as MovieLabelField;
    if (seen.has(field)) {
      continue;
    }
    seen.add(field);
    result.push(field);
  }
  if (!seen.has("title")) {
    result.unshift("title");
  }
  return result;
}

/** The subset of a movie card rendering needs — kept structural so the
 *  renderer does not import the Electron-side contract module. */
export interface MovieLabelSource {
  title: string;
  displayName: string | null;
  videoId: string | null;
  year: number | null;
  resolution: string;
  sourcePath: string;
  libraryMode: string;
  actresses: string[];
  keywords: string[];
  subtitles: Array<unknown>;
  studio?: string | null;
  series?: string | null;
}

export interface MovieLabelParts {
  /** Headline line, or null when no configured field has a value. */
  primary: string | null;
  /** Metadata rows under the headline, one per configured field. */
  details: Array<{ field: MovieLabelField; label: string; value: string }>;
}

function fileNameOf(sourcePath: string): string {
  const base = sourcePath.split(/[\\/]/).pop() ?? sourcePath;
  return base.replace(/\.[^.]+$/, "") || base;
}

/** Short labels keep the card compact; the full list lives in Settings. */
const SHORT_LABEL: Partial<Record<MovieLabelField, string>> = {
  "dvd-id": "ID",
  actresses: "Actress",
  tags: "Tag",
  studio: "Studio",
  series: "Series",
  "subtitle-count": "Subs"
};

function valueFor(field: MovieLabelField, movie: MovieLabelSource): string {
  switch (field) {
    case "title":
      return movie.title?.trim() ?? "";
    case "display-name":
      return movie.displayName?.trim() ?? "";
    case "dvd-id":
      return movie.videoId?.trim() || extractVideoId(movie.title ?? "") || extractVideoId(fileNameOf(movie.sourcePath)) || "";
    case "actresses":
      return movie.actresses.filter(Boolean).join(", ");
    case "tags":
      return movie.keywords.filter(Boolean).slice(0, 4).join(", ");
    case "studio":
      return movie.studio?.trim() ?? "";
    case "series":
      return movie.series?.trim() ?? "";
    case "year":
      return movie.year ? String(movie.year) : "";
    case "resolution":
      return movie.resolution && movie.resolution !== "Unknown" ? movie.resolution : "";
    case "filename":
      return fileNameOf(movie.sourcePath);
    case "library-mode":
      return movie.libraryMode === "gentle" ? "Gentle" : "Normal";
    case "subtitle-count":
      return movie.subtitles.length > 0 ? `${movie.subtitles.length} sub` : "";
    case "folder-path":
      return movie.sourcePath.split(/[\\/]/).slice(0, -1).join("\\");
    default:
      return "";
  }
}

/** Resolves the configured field list into renderable text for one movie. */
export function buildMovieLabel(fields: readonly MovieLabelField[], movie: MovieLabelSource): MovieLabelParts {
  let primary: string | null = null;
  const details: MovieLabelParts["details"] = [];
  for (const field of normalizeMovieLabelFields(fields)) {
    const value = valueFor(field, movie).trim();
    if (!value) {
      continue;
    }
    if (field === "title" || field === "display-name") {
      // Display name wins over title; whichever comes first in the list sets
      // the headline and the other becomes a row.
      if (primary === null) {
        primary = value;
        continue;
      }
    }
    const meta = MOVIE_LABEL_FIELDS.find((entry) => entry.field === field);
    details.push({ field, label: SHORT_LABEL[field] ?? meta?.label ?? field, value });
  }
  return { primary, details };
}
