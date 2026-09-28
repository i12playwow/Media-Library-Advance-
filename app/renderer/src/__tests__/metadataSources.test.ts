import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MetadataSettings } from "../../../shared/contracts";

// The metadata service talks to the network through globalThis.fetch, so the
// tests stub the global and never leave the machine. The service keeps its
// lookup caches in module-level Maps, so each test re-imports a fresh module
// via vi.resetModules() — no test can inherit another test's cache.
const fetchMock = vi.fn(
  async (input: string | URL | Request): TestResponse => {
    throw new Error(`unexpected fetch in this test: ${String(input)}`);
  }
);

interface TestResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

function httpResponse(status: number, body: string): TestResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error("not json");
    },
    text: async () => body
  };
}

function jsonResponse(payload: unknown): TestResponse {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

function makeSettings(overrides: Partial<MetadataSettings> = {}): MetadataSettings {
  return {
    tmdbReadAccessToken: "",
    language: "en-US",
    region: "US",
    autoFetchWebPosters: true,
    tmdbNonCommercialUse: false,
    sourceProfile: "auto",
    ...overrides
  };
}

let metadataService: typeof import("../../../services/metadataService");

beforeEach(async () => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  metadataService = await import("../../../services/metadataService");
});

describe("keyless poster sources", () => {
  it("falls back to javbus when javdatabase misses the video ID", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("javdatabase.com")) {
        return httpResponse(404, "");
      }
      if (url.includes("javbus.com")) {
        return httpResponse(
          200,
          '<html><meta property="og:image" content="https://pics.example/javbus/abc-123.jpg"></html>'
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const metadata = await metadataService.fetchOnlineMovieMetadataByVideoId("ABC-123");

    expect(metadata?.source).toBe("javbus");
    expect(metadata?.posterUrl).toBe("https://pics.example/javbus/abc-123.jpg");
  });

  it("prefers javdatabase and never calls javbus when javdatabase hits", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("javdatabase.com")) {
        return httpResponse(
          200,
          "<html><title>ABC-123 - Alice, Bob - JAV Database</title><meta property=\"og:image\" content=\"https://pics.example/jdb/abc-123.jpg\"></html>"
        );
      }
      return httpResponse(404, "");
    });

    const metadata = await metadataService.fetchOnlineMovieMetadataByVideoId("ABC-123");

    expect(metadata?.source).toBe("javdatabase");
    expect(metadata?.posterUrl).toBe("https://pics.example/jdb/abc-123.jpg");
    expect(metadata?.actresses).toEqual(["Alice", "Bob"]);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).includes("javbus.com"))).toHaveLength(0);
  });

  it("serves cached misses so a repeated lookup performs no fetches at all", async () => {
    fetchMock.mockImplementation(async () => httpResponse(404, ""));

    const first = await metadataService.fetchOnlineMovieMetadataByVideoId("ABC-123");
    const callsAfterFirst = fetchMock.mock.calls.length;
    const second = await metadataService.fetchOnlineMovieMetadataByVideoId("ABC-123");

    expect(first).toBeNull();
    expect(second).toBeNull();
    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it("auto profile falls through both ID sites to a keyless IMDb poster", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("javdatabase.com") || url.includes("javbus.com")) {
        return httpResponse(404, "");
      }
      if (url.includes("v2.sg.media-imdb.com/suggestion")) {
        return jsonResponse({
          d: [
            {
              l: "ABC-123 The Movie",
              y: 2020,
              qid: "movie",
              i: { imageUrl: "https://m.media-amazon.com/images/abc123full.jpg" }
            }
          ]
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const metadata = await metadataService.resolveOnlineMovieMetadata(
      { title: "ABC-123 The Movie", year: 2020, sourcePath: "C:/lib/ABC-123/movie.mp4", videoId: "ABC-123" },
      makeSettings()
    );

    expect(metadata?.source).toBe("imdb");
    expect(metadata?.posterUrl).toBe("https://m.media-amazon.com/images/abc123full.jpg");
  });

  it("serves a keyless IMDb poster with no video ID and never touches TMDB", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("v2.sg.media-imdb.com/suggestion")) {
        return jsonResponse({
          d: [
            {
              l: "Inception",
              y: 2010,
              qid: "movie",
              i: { imageUrl: "https://m.media-amazon.com/images/inception.jpg" }
            }
          ]
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const metadata = await metadataService.resolveOnlineMovieMetadata(
      { title: "Inception", year: 2010, sourcePath: "C:/lib/Inception/movie.mp4", videoId: null },
      makeSettings()
    );

    expect(metadata?.source).toBe("imdb");
    expect(metadata?.posterUrl).toBe("https://m.media-amazon.com/images/inception.jpg");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("themoviedb.org"))).toBe(false);
  });

  it("prefers the year-matching IMDb candidate when titles tie", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("v2.sg.media-imdb.com/suggestion")) {
        return jsonResponse({
          d: [
            { l: "Inception", y: 1999, qid: "movie", i: { imageUrl: "https://m.media-amazon.com/images/wrong.jpg" } },
            { l: "Inception", y: 2010, qid: "movie", i: { imageUrl: "https://m.media-amazon.com/images/right.jpg" } }
          ]
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const metadata = await metadataService.resolveOnlineMovieMetadata(
      { title: "Inception", year: 2010, sourcePath: "C:/lib/Inception/movie.mp4", videoId: null },
      makeSettings()
    );

    expect(metadata?.posterUrl).toBe("https://m.media-amazon.com/images/right.jpg");
  });

  it("prefers the title-type candidate so a TV series never poses as the film", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("v2.sg.media-imdb.com/suggestion")) {
        return jsonResponse({
          d: [
            { l: "Inception", y: 2010, qid: "tvSeries", i: { imageUrl: "https://m.media-amazon.com/images/tv.jpg" } },
            { l: "Inception", y: 2010, qid: "movie", i: { imageUrl: "https://m.media-amazon.com/images/film.jpg" } }
          ]
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const metadata = await metadataService.resolveOnlineMovieMetadata(
      { title: "Inception", year: 2010, sourcePath: "C:/lib/Inception/movie.mp4", videoId: null },
      makeSettings()
    );

    expect(metadata?.posterUrl).toBe("https://m.media-amazon.com/images/film.jpg");
  });

  it("refuses an unrelated IMDb result instead of showing a wrong cover", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("v2.sg.media-imdb.com/suggestion")) {
        return jsonResponse({
          d: [
            {
              l: "Completely Different Film",
              y: 1999,
              qid: "movie",
              i: { imageUrl: "https://m.media-amazon.com/images/wrong.jpg" }
            }
          ]
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const metadata = await metadataService.resolveOnlineMovieMetadata(
      { title: "Inception", year: 2010, sourcePath: "C:/lib/Inception/movie.mp4", videoId: null },
      makeSettings()
    );

    expect(metadata).toBeNull();
  });

  it("mainstream-first tries keyless IMDb before even a token-enabled TMDB", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("v2.sg.media-imdb.com/suggestion")) {
        return jsonResponse({
          d: [
            {
              l: "Inception",
              y: 2010,
              qid: "movie",
              i: { imageUrl: "https://m.media-amazon.com/images/inception.jpg" }
            }
          ]
        });
      }
      // A TMDB call under a mainstream-first hit means the order regressed.
      throw new Error(`unexpected fetch ${url}`);
    });

    const metadata = await metadataService.resolveOnlineMovieMetadata(
      { title: "Inception", year: 2010, sourcePath: "C:/lib/Inception/movie.mp4", videoId: "ABC-123" },
      makeSettings({ sourceProfile: "mainstream-first", tmdbNonCommercialUse: true, tmdbReadAccessToken: "token" })
    );

    expect(metadata?.source).toBe("imdb");
  });
});
