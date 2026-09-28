import fs from "node:fs/promises";
import path from "node:path";
import type { DatabaseClient } from "../database/database";
import { probeVideoFile, runFfmpeg } from "./ffmpegService";
import type {
  MetadataSettings,
  MetadataSourceKind,
  MetadataSourceProfile,
  MovieRecord,
  ScanProgress
} from "../shared/contracts";
import { expandVideoIdLookupCandidates, extractVideoId } from "../shared/videoId";

interface TmdbMovieResult {
  id: number;
  title: string;
  original_title: string;
  release_date: string;
  poster_path: string | null;
  popularity: number;
}

interface TmdbSearchResponse {
  results: TmdbMovieResult[];
}

interface TmdbConfigurationResponse {
  images: {
    secure_base_url: string;
    poster_sizes: string[];
  };
}

interface ImdbSuggestionResponse {
  d: Array<{
    l: string;
    id?: string;
    y?: number;
    qid?: string;
    i?: { imageUrl?: string };
  }>;
}

export interface OnlineMovieMetadata {
  actresses: string[];
  modelName: string | null;
  posterUrl: string | null;
  source: MetadataSourceKind;
  videoId: string | null;
}

let tmdbPosterBaseUrlCache = "";
let tmdbPosterBaseUrlCacheKey = "";
const onlineMovieMetadataCache = new Map<string, OnlineMovieMetadata | null>();

// Actress-photo misses are marked in-memory only: persisting a marker row
// would leak into the photo-gallery readers, and re-fetching a 404 on a
// later run is cheap.
const actressPhotoMisses = new Set<string>();

export function isKnownActressPhotoMiss(name: string): boolean {
  return actressPhotoMisses.has(name.trim().toLowerCase());
}

export async function enrichMoviePoster(
  database: DatabaseClient,
  movieId: string,
  settings: MetadataSettings,
  options?: {
    forceRefresh?: boolean;
    onProgress?: (progress: ScanProgress) => void;
    progress?: ScanProgress;
  }
): Promise<string | null> {
  const movie = database.getMovie(movieId);
  if (!movie) {
    return null;
  }

  const resolvedVideoId = resolveMovieVideoId(movie);
  if (resolvedVideoId && movie.videoId !== resolvedVideoId) {
    database.updateMovieVideoId(movieId, resolvedVideoId);
  }

  const movieWithResolvedId: MovieRecord = {
    ...movie,
    videoId: resolvedVideoId
  };

  if (
    !options?.forceRefresh &&
    movieWithResolvedId.posterUrl &&
    movieWithResolvedId.posterSource === "web"
  ) {
    return movieWithResolvedId.posterUrl;
  }

  let resolvedPosterUrl = movieWithResolvedId.posterUrl;

  if (!resolvedPosterUrl || movieWithResolvedId.posterSource === "none") {
    const localPosterUrl = await extractLocalPoster(movieWithResolvedId, options);
    if (localPosterUrl) {
      database.updateMoviePoster(movieId, localPosterUrl, "local");
      resolvedPosterUrl = localPosterUrl;
    }
  }

  const webMetadata = await fetchPosterUrlForMovie(movieWithResolvedId, settings, options);
  if (!webMetadata?.posterUrl) {
    return resolvedPosterUrl ?? null;
  }

  // Persist the SPECIFIC source so the UI can attribute the cover to the
  // site that served it ("web" remains the legacy fallback).
  database.updateMoviePoster(movieId, webMetadata.posterUrl, webMetadata.source ?? "web");
  return webMetadata.posterUrl;
}

async function extractLocalPoster(
  movie: Pick<MovieRecord, "title" | "year" | "sourcePath" | "folderPath">,
  options?: {
    onProgress?: (progress: ScanProgress) => void;
    progress?: ScanProgress;
  }
): Promise<string | null> {
  const posterPath = buildLocalPosterPath(movie);

  options?.onProgress?.({
    ...(options.progress ?? createFallbackProgress(movie.sourcePath)),
    message: `Generating local poster for ${movie.title}`
  });

  try {
    await fs.access(posterPath);
    return await readPosterAsDataUrl(posterPath);
  } catch {
    // Fall through and generate a new frame capture.
  }

  try {
    await fs.mkdir(path.dirname(posterPath), { recursive: true });
    const captureOffset = await resolveCaptureOffset(movie.sourcePath);

    await runFfmpeg([
      "-y",
      "-ss",
      captureOffset.toFixed(1),
      "-i",
      movie.sourcePath,
      "-frames:v",
      "1",
      "-vf",
      "scale=640:-2",
      "-q:v",
      "4",
      "-update",
      "1",
      posterPath
    ]);

    return await readPosterAsDataUrl(posterPath);
  } catch {
    return null;
  }
}

async function fetchPosterUrlForMovie(
  movie: Pick<MovieRecord, "title" | "year" | "sourcePath" | "videoId">,
  settings: MetadataSettings,
  options?: {
    onProgress?: (progress: ScanProgress) => void;
    progress?: ScanProgress;
  }
): Promise<OnlineMovieMetadata | null> {
  if (!settings.autoFetchWebPosters) {
    return null;
  }

  return resolveOnlineMovieMetadata(movie, settings, options);
}

async function searchTmdbMovie(
  movie: Pick<MovieRecord, "title" | "year" | "videoId">,
  settings: MetadataSettings
): Promise<TmdbMovieResult | null> {
  const params = new URLSearchParams({
    query: movie.title,
    include_adult: "false",
    language: settings.language,
    region: settings.region
  });

  if (movie.year) {
    params.set("year", String(movie.year));
  }

  const response = await fetch(`https://api.themoviedb.org/3/search/movie?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${settings.tmdbReadAccessToken}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`TMDB search failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as TmdbSearchResponse;
  const candidates = payload.results.filter((result) => result.poster_path);
  if (candidates.length === 0) {
    return null;
  }

  return candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(movie, candidate)
    }))
    .sort((left, right) => right.score - left.score)[0].candidate;
}

async function fetchTmdbMovieMetadata(
  movie: Pick<MovieRecord, "title" | "year" | "sourcePath" | "videoId">,
  settings: MetadataSettings,
  options?: {
    onProgress?: (progress: ScanProgress) => void;
    progress?: ScanProgress;
  }
): Promise<OnlineMovieMetadata | null> {
  if (!settings.tmdbReadAccessToken.trim() || !settings.tmdbNonCommercialUse) {
    return null;
  }

  options?.onProgress?.({
    ...(options.progress ?? createFallbackProgress(movie.sourcePath)),
    message: `Fetching title-based poster for ${movie.title}`
  });

  const bestMatch = await searchTmdbMovie(movie, settings);
  if (!bestMatch?.poster_path) {
    return null;
  }

  const baseUrl = await getTmdbPosterBaseUrl(settings);
  return {
    actresses: [],
    modelName: null,
    posterUrl: `${baseUrl}${bestMatch.poster_path}`,
    source: "tmdb",
    videoId: movie.videoId ?? null
  };
}

async function getTmdbPosterBaseUrl(settings: MetadataSettings): Promise<string> {
  const cacheKey = `${settings.tmdbReadAccessToken}:${settings.language}:${settings.region}`;
  if (tmdbPosterBaseUrlCache && tmdbPosterBaseUrlCacheKey === cacheKey) {
    return tmdbPosterBaseUrlCache;
  }

  const response = await fetch("https://api.themoviedb.org/3/configuration", {
    headers: {
      Authorization: `Bearer ${settings.tmdbReadAccessToken}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error(`TMDB configuration failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as TmdbConfigurationResponse;
  const chosenSize =
    payload.images.poster_sizes.find((size) => size === "w500") ??
    payload.images.poster_sizes[payload.images.poster_sizes.length - 1] ??
    "original";

  tmdbPosterBaseUrlCache = `${payload.images.secure_base_url}${chosenSize}`;
  tmdbPosterBaseUrlCacheKey = cacheKey;
  return tmdbPosterBaseUrlCache;
}

async function resolveCaptureOffset(sourcePath: string): Promise<number> {
  const probe = await probeVideoFile(sourcePath);
  if (!probe.valid || !probe.durationSeconds) {
    return 15;
  }

  return Math.max(12, Math.min(probe.durationSeconds * 0.18, 180));
}

function buildLocalPosterPath(
  movie: Pick<MovieRecord, "sourcePath" | "folderPath">
): string {
  const directory = movie.folderPath || path.dirname(movie.sourcePath);
  const stem = path.basename(movie.sourcePath, path.extname(movie.sourcePath));
  return path.join(directory, `${stem}.poster.jpg`);
}

async function readPosterAsDataUrl(posterPath: string): Promise<string> {
  const buffer = await fs.readFile(posterPath);
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

function scoreCandidate(
  movie: Pick<MovieRecord, "title" | "year" | "videoId">,
  candidate: TmdbMovieResult
): number {
  const movieTitle = normalize(movie.title);
  const candidateTitle = normalize(candidate.title);
  const originalTitle = normalize(candidate.original_title);
  const movieVideoId = movie.videoId ? normalize(movie.videoId) : "";
  const releaseYear = candidate.release_date ? Number(candidate.release_date.slice(0, 4)) : null;

  let score = candidate.popularity ?? 0;
  if (candidateTitle === movieTitle) {
    score += 1000;
  }
  if (originalTitle === movieTitle) {
    score += 800;
  }
  if (candidateTitle.includes(movieTitle) || movieTitle.includes(candidateTitle)) {
    score += 250;
  }
  if (movie.year && releaseYear === movie.year) {
    score += 400;
  }
  if (
    movieVideoId &&
    (candidateTitle.includes(movieVideoId) || originalTitle.includes(movieVideoId))
  ) {
    score += 1200;
  }

  return score;
}

function resolveMovieVideoId(
  movie: Pick<MovieRecord, "videoId" | "sourcePath" | "title">
): string | null {
  return (
    movie.videoId ??
    extractVideoId(path.basename(movie.sourcePath, path.extname(movie.sourcePath))) ??
    extractVideoId(movie.title)
  );
}

async function fetchPosterUrlByVideoId(videoId: string): Promise<string | null> {
  for (const candidate of expandVideoIdLookupCandidates(videoId)) {
    const metadata = await fetchOnlineMovieMetadataByVideoId(candidate);
    if (metadata?.posterUrl) {
      return metadata.posterUrl;
    }
  }

  return null;
}

export async function fetchOnlineMovieMetadataByVideoId(
  videoId: string
): Promise<OnlineMovieMetadata | null> {
  for (const candidate of expandVideoIdLookupCandidates(videoId)) {
    const cacheKey = candidate.toUpperCase();
    if (onlineMovieMetadataCache.has(cacheKey)) {
      return onlineMovieMetadataCache.get(cacheKey) ?? null;
    }

    const metadata = await fetchJavDatabaseMetadata(candidate);
    onlineMovieMetadataCache.set(cacheKey, metadata);
    if (metadata) {
      return metadata;
    }

    // Second keyless ID site: javdatabase misses are not final. Same
    // og:image contract, cached under the same candidate key.
    const javbusMetadata = await fetchJavBusMetadata(candidate);
    onlineMovieMetadataCache.set(cacheKey, javbusMetadata);
    if (javbusMetadata) {
      return javbusMetadata;
    }
  }

  return null;
}

export async function resolveOnlineMovieMetadata(
  movie: Pick<MovieRecord, "title" | "year" | "sourcePath" | "videoId">,
  settings: MetadataSettings,
  options?: {
    onProgress?: (progress: ScanProgress) => void;
    progress?: ScanProgress;
  }
): Promise<OnlineMovieMetadata | null> {
  const resolvedVideoId = resolveMovieVideoId(movie);
  const profile = settings.sourceProfile ?? "auto";
  const cacheKey = buildMetadataCacheKey(movie, settings, profile, resolvedVideoId);
  if (onlineMovieMetadataCache.has(cacheKey)) {
    return onlineMovieMetadataCache.get(cacheKey) ?? null;
  }

  const strategyOrder = resolveMetadataStrategyOrder(profile, Boolean(resolvedVideoId));
  for (const strategy of strategyOrder) {
    if (strategy === "javdatabase" && resolvedVideoId) {
      const javMetadata = await fetchOnlineMovieMetadataByVideoId(resolvedVideoId);
      if (javMetadata) {
        onlineMovieMetadataCache.set(cacheKey, javMetadata);
        return javMetadata;
      }
    }

    // Keyless title-based source: fills the no-video-ID gap that previously
    // fell straight through to TMDB (or to nothing, with TMDB gated off).
    if (strategy === "imdb") {
      const imdbMetadata = await fetchImdbMovieMetadata(movie, options);
      if (imdbMetadata) {
        onlineMovieMetadataCache.set(cacheKey, imdbMetadata);
        return imdbMetadata;
      }
    }

    if (strategy === "tmdb") {
      if (!settings.tmdbNonCommercialUse) {
        continue;
      }
      const tmdbMetadata = await fetchTmdbMovieMetadata(
        {
          ...movie,
          videoId: resolvedVideoId
        },
        settings,
        options
      );
      if (tmdbMetadata) {
        onlineMovieMetadataCache.set(cacheKey, tmdbMetadata);
        return tmdbMetadata;
      }
    }
  }

  onlineMovieMetadataCache.set(cacheKey, null);
  return null;
}

export async function enrichActressPhotos(
  database: DatabaseClient,
  actresses: string[]
): Promise<void> {
  for (const actress of actresses) {
    if (!actress.trim()) continue;
    if (database.getActressPhoto(actress)) continue; // already cached
    if (actressPhotoMisses.has(actress.trim().toLowerCase())) continue;
    try {
      const photoUrl = await fetchActressPhotoKeyless(actress);
      if (photoUrl) {
        database.setActressPhoto(actress, photoUrl);
      } else {
        actressPhotoMisses.add(actress.trim().toLowerCase());
      }
    } catch {
      // silently skip — photo fetch is best-effort
    }
  }
}

// Keyless actress-photo chain, mirroring the movie chain's shape:
// javdatabase idol pages, then javbus star pages, then IMDb person
// suggestions — every stop keyless, and a miss at one is not final.
async function fetchActressPhotoKeyless(name: string): Promise<string | null> {
  const javdatabasePhoto = await fetchActressPhotoFromJavDatabase(name);
  if (javdatabasePhoto) {
    return javdatabasePhoto;
  }

  const javbusPhoto = await fetchActressPhotoFromJavBus(name);
  if (javbusPhoto) {
    return javbusPhoto;
  }

  return fetchActressPhotoFromImdb(name);
}

function resolveMetadataStrategyOrder(
  profile: MetadataSourceProfile,
  hasVideoId: boolean
): MetadataSourceKind[] {
  if (profile === "local-only") {
    return [];
  }

  if (profile === "mainstream-first") {
    return hasVideoId ? ["imdb", "tmdb", "javdatabase"] : ["imdb", "tmdb"];
  }

  if (hasVideoId) {
    return ["javdatabase", "imdb", "tmdb"];
  }

  return ["imdb", "tmdb"];
}

function buildMetadataCacheKey(
  movie: Pick<MovieRecord, "title" | "year" | "sourcePath" | "videoId">,
  settings: MetadataSettings,
  profile: MetadataSourceProfile,
  resolvedVideoId: string | null
): string {
  return [
    profile,
    settings.tmdbNonCommercialUse ? "tmdb-allowed" : "tmdb-blocked",
    settings.tmdbReadAccessToken.trim() || "notmdb",
    settings.language,
    settings.region,
    resolvedVideoId ?? "",
    normalize(movie.title),
    movie.year ?? "",
    path.resolve(movie.sourcePath).toLowerCase()
  ].join("|");
}

// Second keyless actress site: javbus star pages (/star/<name>/). Errors
// degrade to a miss so a blocked site cannot abort the chain, and any page
// that smells like an age-verification interstitial is a miss too — its
// only images are logos, which must never be stored as a headshot.
async function fetchActressPhotoFromJavBus(name: string): Promise<string | null> {
  const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  try {
    const response = await fetch(`https://www.javbus.com/star/${slug}/`, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      }
    });
    if (!response.ok) {
      return null;
    }
    const html = await response.text();
    if (/Age Verification/i.test(html)) {
      return null;
    }
    const ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/i);
    if (ogMatch?.[1]) {
      return ogMatch[1];
    }
    const photoFrame = html.match(/<img[^>]+class="[^"]*photo-frame[^"]*"[^>]+src="([^"]+)"/i);
    return photoFrame?.[1] ?? null;
  } catch {
    return null;
  }
}

// Third keyless actress site: IMDb person suggestions (nm-prefixed IDs).
// The endpoint fuzzy-matches, so a candidate is accepted only when the name
// agrees — an exact normalized match, or a containment match in the same
// family-name direction. A filmography headshot of the WRONG person is
// worse than no photo.
async function fetchActressPhotoFromImdb(name: string): Promise<string | null> {
  const term = name.trim().toLowerCase();
  if (!term) {
    return null;
  }
  try {
    const response = await fetch(
      `https://v2.sg.media-imdb.com/suggestion/x/${encodeURIComponent(term)}.json`,
      { headers: { Accept: "application/json" } }
    );
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as ImdbSuggestionResponse;
    const normalizedName = normalize(name);
    const candidates = payload.d.filter(
      (entry) =>
        typeof entry.id === "string" &&
        entry.id.startsWith("nm") &&
        entry.i?.imageUrl
    );
    for (const candidate of candidates) {
      const candidateName = normalize(candidate.l);
      if (candidateName === normalizedName) {
        return candidate.i!.imageUrl!;
      }
      const [givenName, ...familyRest] = name.trim().toLowerCase().split(/\s+/);
      const familyName = familyRest[familyRest.length - 1];
      if (
        givenName &&
        familyName &&
        candidate.l.toLowerCase().includes(givenName) &&
        candidate.l.toLowerCase().includes(familyName)
      ) {
        return candidate.i!.imageUrl!;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchActressPhotoFromJavDatabase(name: string): Promise<string | null> {
  const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  const response = await fetch(`https://www.javdatabase.com/idols/${slug}/`, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }
  });

  if (!response.ok) return null;

  const html = await response.text();
  // Try og:image first (usually a headshot for idol pages)
  const ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/i);
  if (ogMatch?.[1]) return ogMatch[1];

  // Fallback: look for idol image pattern
  const imgMatch = html.match(/<img[^>]+class="[^"]*idol[^"]*"[^>]+src="([^"]+)"/i);
  return imgMatch?.[1] ?? null;
}

// Second keyless video-ID site (javdatabase misses are not final). Same
// og:image contract; errors are swallowed as a miss so a blocked or
// rate-limited site degrades to "no result" instead of aborting the chain.
async function fetchJavBusMetadata(videoId: string): Promise<OnlineMovieMetadata | null> {
  const slug = videoId.toLowerCase();
  try {
    const response = await fetch(`https://www.javbus.com/${slug}/`, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
      }
    });
    if (!response.ok) {
      return null;
    }
    const html = await response.text();
    const posterMatch = html.match(/property="og:image"\s+content="([^"]+)"/i);
    return {
      actresses: [],
      modelName: videoId.split("-")[0] ?? null,
      posterUrl: posterMatch?.[1] ?? null,
      source: "javbus",
      videoId
    };
  } catch {
    return null;
  }
}

// Keyless title-based source (IMDb's public suggestion endpoint): fills
// the no-video-ID gap with real poster art from Amazon's CDN. A result is
// accepted only when its title or release year agrees with the movie, and
// a title-type match is preferred so a TV series never poses as the film.
async function fetchImdbMovieMetadata(
  movie: Pick<MovieRecord, "title" | "year" | "sourcePath" | "videoId">,
  options?: {
    onProgress?: (progress: ScanProgress) => void;
    progress?: ScanProgress;
  }
): Promise<OnlineMovieMetadata | null> {
  const term = movie.title.trim();
  if (!term) {
    return null;
  }

  options?.onProgress?.({
    ...(options.progress ?? createFallbackProgress(movie.sourcePath)),
    message: `Fetching keyless title poster for ${movie.title}`
  });

  let payload: ImdbSuggestionResponse;
  try {
    const response = await fetch(
      `https://v2.sg.media-imdb.com/suggestion/x/${encodeURIComponent(term.toLowerCase())}.json`,
      { headers: { Accept: "application/json" } }
    );
    if (!response.ok) {
      return null;
    }
    payload = (await response.json()) as ImdbSuggestionResponse;
  } catch {
    return null;
  }

  const candidates = payload.d.filter((result) => result.i?.imageUrl);
  if (candidates.length === 0) {
    return null;
  }

  const movieTitle = normalize(movie.title);
  let best: { result: (typeof candidates)[number]; score: number } | null = null;
  for (const result of candidates) {
    const candidateTitle = normalize(result.l);
    // Relevance gate: the candidate must agree on the title OR the release
    // year before anything else counts — without this, the title-type
    // tiebreaker below could alone promote a completely unrelated film.
    const titleAgrees =
      candidateTitle === movieTitle ||
      (movieTitle.length > 0 &&
        (candidateTitle.includes(movieTitle) || movieTitle.includes(candidateTitle)));
    const yearAgrees = Boolean(movie.year && result.y === movie.year);
    if (!titleAgrees && !yearAgrees) {
      continue;
    }

    let score = 0;
    if (candidateTitle === movieTitle) {
      score += 1000;
    } else {
      score += 250;
    }
    // Tiebreaker among agreeing candidates only: prefer the film over a
    // same-titled TV series.
    if (result.qid === "movie") {
      score += 300;
    }
    if (yearAgrees) {
      score += 400;
    }
    if (!best || score > best.score) {
      best = { result, score };
    }
  }

  if (!best) {
    return null;
  }

  return {
    actresses: [],
    modelName: null,
    posterUrl: best.result.i!.imageUrl!,
    source: "imdb",
    videoId: movie.videoId ?? null
  };
}

async function fetchJavDatabaseMetadata(
  videoId: string
): Promise<OnlineMovieMetadata | null> {
  const slug = videoId.toLowerCase();
  const response = await fetch(`https://www.javdatabase.com/movies/${slug}/`, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }
  });

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const posterMatch = html.match(/property="og:image"\s+content="([^"]+)"/i);
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  const actresses = parseActressesFromDocumentTitle(
    titleMatch?.[1] ?? "",
    videoId
  );

  return {
    actresses,
    modelName: videoId.split("-")[0] ?? null,
    posterUrl: posterMatch?.[1] ?? null,
    source: "javdatabase",
    videoId
  };
}

function parseActressesFromDocumentTitle(
  documentTitle: string,
  videoId: string
): string[] {
  if (!documentTitle) {
    return [];
  }

  const cleanedTitle = documentTitle
    .replace(/\s*-\s*JAV Database\s*$/i, "")
    .trim();
  const segments = cleanedTitle.split(/\s+-\s+/);
  if (segments.length < 2) {
    return [];
  }

  const actressSegment =
    segments[0].toUpperCase() === videoId.toUpperCase()
      ? segments[1]
      : segments[0].toUpperCase().includes(videoId.toUpperCase())
        ? segments[segments.length - 1]
        : segments[1];

  return actressSegment
    .split(",")
    .map((actress) => actress.trim())
    .filter(Boolean)
    .filter((actress) => !/jav database/i.test(actress));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function createFallbackProgress(currentFile: string): ScanProgress {
  return {
    stage: "processing",
    mode: "all",
    currentRoot: null,
    currentFile,
    processedFiles: 0,
    totalFiles: 0,
    imported: 0,
    skipped: 0,
    message: "Preparing poster"
  };
}
