import { describe, expect, it } from "vitest";
import {
  DEFAULT_MOVIE_LABEL_FIELDS,
  MOVIE_LABEL_FIELDS,
  buildMovieLabel,
  normalizeMovieLabelFields,
  type MovieLabelField,
  type MovieLabelSource,
} from "../../../shared/movieLabels";

function makeSource(overrides: Partial<MovieLabelSource> = {}): MovieLabelSource {
  return {
    title: "Test Movie",
    displayName: null,
    videoId: "TEST-001",
    year: 2023,
    resolution: "1080p",
    sourcePath: "C:\\library\\normal\\TEST-001 Test Movie.mp4",
    libraryMode: "normal",
    actresses: ["Actress One", "Actress Two"],
    keywords: ["alpha", "beta", "gamma", "delta", "epsilon"],
    subtitles: [],
    studio: null,
    series: null,
    ...overrides,
  };
}

describe("normalizeMovieLabelFields", () => {
  it("keeps a valid ordered list as given", () => {
    const fields: MovieLabelField[] = ["title", "dvd-id", "actresses"];
    expect(normalizeMovieLabelFields(fields)).toEqual(fields);
  });

  it("drops unknown ids and duplicates", () => {
    expect(
      normalizeMovieLabelFields(["title", "not-a-field", "dvd-id", "dvd-id", 42, null])
    ).toEqual(["title", "dvd-id"]);
  });

  it("forces the title back in when it is missing", () => {
    expect(normalizeMovieLabelFields(["dvd-id"])).toEqual(["title", "dvd-id"]);
  });

  it("returns just the title for non-array input", () => {
    expect(normalizeMovieLabelFields(undefined)).toEqual(["title"]);
    expect(normalizeMovieLabelFields("title")).toEqual(["title"]);
    expect(normalizeMovieLabelFields({})).toEqual(["title"]);
  });
});

describe("buildMovieLabel", () => {
  it("turns the first headline field into primary and the rest into rows", () => {
    const parts = buildMovieLabel(DEFAULT_MOVIE_LABEL_FIELDS, makeSource());
    expect(parts.primary).toBe("Test Movie");
    expect(parts.details.map((row) => row.field)).toEqual([
      "dvd-id",
      "actresses",
      "year",
      "resolution",
    ]);
    expect(parts.details[0]).toEqual({ field: "dvd-id", label: "ID", value: "TEST-001" });
  });

  it("prefers the display name when it is listed before the title", () => {
    const parts = buildMovieLabel(
      ["display-name", "title"],
      makeSource({ displayName: "My Label" })
    );
    expect(parts.primary).toBe("My Label");
    expect(parts.details).toEqual([{ field: "title", label: "Title", value: "Test Movie" }]);
  });

  it("skips fields with no value instead of printing empty rows", () => {
    const parts = buildMovieLabel(
      ["title", "studio", "series", "resolution"],
      makeSource({ resolution: "Unknown" })
    );
    expect(parts.details).toEqual([]);
  });

  it("derives the DVD ID from the title or the file name", () => {
    const fromTitle = buildMovieLabel(
      ["title", "dvd-id"],
      makeSource({ videoId: null, title: "SSIS-123 Some Title", sourcePath: "C:\\a\\b.mp4" })
    );
    expect(fromTitle.details[0].value).toBe("SSIS-123");

    const fromFile = buildMovieLabel(
      ["title", "dvd-id"],
      makeSource({ videoId: null, title: "Some Title", sourcePath: "C:\\a\\ABP-999.mp4" })
    );
    expect(fromFile.details[0].value).toBe("ABP-999");
  });

  it("caps the tag row so a long keyword list cannot flood the card", () => {
    const parts = buildMovieLabel(["title", "tags"], makeSource());
    expect(parts.details[0].value).toBe("alpha, beta, gamma, delta");
  });

  it("formats the subtitle count, library mode and folder path", () => {
    const parts = buildMovieLabel(
      ["title", "subtitle-count", "library-mode", "folder-path"],
      makeSource({ subtitles: [{}, {}], libraryMode: "gentle" })
    );
    expect(parts.details.map((row) => row.value)).toEqual([
      "2 sub",
      "Gentle",
      "C:\\library\\normal",
    ]);
  });

  it("returns a null primary only when no headline field has a value", () => {
    const parts = buildMovieLabel(
      ["display-name"],
      makeSource({ displayName: null })
    );
    // Title is re-inserted by the normaliser, so a real card is never blank.
    expect(normalizeMovieLabelFields(["display-name"])).toEqual(["title", "display-name"]);
    expect(parts.primary).toBe("Test Movie");
  });

  it("exposes a hint for every catalogue entry", () => {
    for (const entry of MOVIE_LABEL_FIELDS) {
      expect(entry.hint, entry.field).toBeTruthy();
    }
  });
});
