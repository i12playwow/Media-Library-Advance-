"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.enrichMoviePoster = enrichMoviePoster;
exports.fetchOnlineMovieMetadataByVideoId = fetchOnlineMovieMetadataByVideoId;
exports.fetchJavDatabaseMetadata = fetchJavDatabaseMetadata;
exports.resolveOnlineMovieMetadata = resolveOnlineMovieMetadata;
exports.enrichActressPhotos = enrichActressPhotos;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const ffmpegService_1 = require("./ffmpegService");
const videoId_1 = require("../shared/videoId");
let tmdbPosterBaseUrlCache = "";
let tmdbPosterBaseUrlCacheKey = "";
const onlineMovieMetadataCache = new Map();
async function enrichMoviePoster(database, movieId, settings, options) {
    const movie = database.getMovie(movieId);
    if (!movie) {
        return null;
    }
    const resolvedVideoId = resolveMovieVideoId(movie);
    if (resolvedVideoId && movie.videoId !== resolvedVideoId) {
        database.updateMovieVideoId(movieId, resolvedVideoId);
    }
    const movieWithResolvedId = {
        ...movie,
        videoId: resolvedVideoId
    };
    if (!options?.forceRefresh &&
        movieWithResolvedId.posterUrl &&
        movieWithResolvedId.posterSource === "web") {
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
    const webPosterUrl = await fetchPosterUrlForMovie(movieWithResolvedId, settings, options);
    if (!webPosterUrl) {
        return resolvedPosterUrl ?? null;
    }
    database.updateMoviePoster(movieId, webPosterUrl, "web");
    return webPosterUrl;
}
async function extractLocalPoster(movie, options) {
    const posterPath = buildLocalPosterPath(movie);
    options?.onProgress?.({
        ...(options.progress ?? createFallbackProgress(movie.sourcePath)),
        message: `Generating local poster for ${movie.title}`
    });
    try {
        await promises_1.default.access(posterPath);
        return await readPosterAsDataUrl(posterPath);
    }
    catch {
        // Fall through and generate a new frame capture.
    }
    try {
        await promises_1.default.mkdir(node_path_1.default.dirname(posterPath), { recursive: true });
        const captureOffset = await resolveCaptureOffset(movie.sourcePath);
        await (0, ffmpegService_1.runFfmpeg)([
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
    }
    catch {
        return null;
    }
}
async function fetchPosterUrlForMovie(movie, settings, options) {
    if (!settings.autoFetchWebPosters) {
        return null;
    }
    if (!settings.tmdbNonCommercialUse) {
        const videoId = resolveMovieVideoId(movie);
        if (!videoId) {
            return null;
        }
    }
    const metadata = await resolveOnlineMovieMetadata(movie, settings, options);
    return metadata?.posterUrl ?? null;
}
async function searchTmdbMovie(movie, settings) {
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
    const payload = (await response.json());
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
async function fetchTmdbMovieMetadata(movie, settings, options) {
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
async function getTmdbPosterBaseUrl(settings) {
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
    const payload = (await response.json());
    const chosenSize = payload.images.poster_sizes.find((size) => size === "w500") ??
        payload.images.poster_sizes[payload.images.poster_sizes.length - 1] ??
        "original";
    tmdbPosterBaseUrlCache = `${payload.images.secure_base_url}${chosenSize}`;
    tmdbPosterBaseUrlCacheKey = cacheKey;
    return tmdbPosterBaseUrlCache;
}
async function resolveCaptureOffset(sourcePath) {
    const probe = await (0, ffmpegService_1.probeVideoFile)(sourcePath);
    if (!probe.valid || !probe.durationSeconds) {
        return 15;
    }
    return Math.max(12, Math.min(probe.durationSeconds * 0.18, 180));
}
function buildLocalPosterPath(movie) {
    const directory = movie.folderPath || node_path_1.default.dirname(movie.sourcePath);
    const stem = node_path_1.default.basename(movie.sourcePath, node_path_1.default.extname(movie.sourcePath));
    return node_path_1.default.join(directory, `${stem}.poster.jpg`);
}
async function readPosterAsDataUrl(posterPath) {
    const buffer = await promises_1.default.readFile(posterPath);
    return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}
function scoreCandidate(movie, candidate) {
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
    if (movieVideoId &&
        (candidateTitle.includes(movieVideoId) || originalTitle.includes(movieVideoId))) {
        score += 1200;
    }
    return score;
}
function resolveMovieVideoId(movie) {
    return (movie.videoId ??
        (0, videoId_1.extractVideoId)(node_path_1.default.basename(movie.sourcePath, node_path_1.default.extname(movie.sourcePath))) ??
        (0, videoId_1.extractVideoId)(movie.title));
}
async function fetchPosterUrlByVideoId(videoId) {
    for (const candidate of (0, videoId_1.expandVideoIdLookupCandidates)(videoId)) {
        const metadata = await fetchOnlineMovieMetadataByVideoId(candidate);
        if (metadata?.posterUrl) {
            return metadata.posterUrl;
        }
    }
    return null;
}
async function fetchOnlineMovieMetadataByVideoId(videoId) {
    for (const candidate of (0, videoId_1.expandVideoIdLookupCandidates)(videoId)) {
        const cacheKey = candidate.toUpperCase();
        if (onlineMovieMetadataCache.has(cacheKey)) {
            return onlineMovieMetadataCache.get(cacheKey) ?? null;
        }
        const metadata = await fetchJavDatabaseMetadata(candidate);
        onlineMovieMetadataCache.set(cacheKey, metadata);
        if (metadata) {
            return metadata;
        }
    }
    return null;
}
async function resolveOnlineMovieMetadata(movie, settings, options) {
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
        if (strategy === "tmdb") {
            if (!settings.tmdbNonCommercialUse) {
                continue;
            }
            const tmdbMetadata = await fetchTmdbMovieMetadata({
                ...movie,
                videoId: resolvedVideoId
            }, settings, options);
            if (tmdbMetadata) {
                onlineMovieMetadataCache.set(cacheKey, tmdbMetadata);
                return tmdbMetadata;
            }
        }
    }
    onlineMovieMetadataCache.set(cacheKey, null);
    return null;
}
async function enrichActressPhotos(database, actresses) {
    for (const actress of actresses) {
        if (!actress.trim())
            continue;
        if (database.getActressPhoto(actress))
            continue; // already cached
        try {
            const photoUrl = await fetchActressPhotoFromJavDatabase(actress);
            if (photoUrl) {
                database.setActressPhoto(actress, photoUrl);
            }
        }
        catch {
            // silently skip — photo fetch is best-effort
        }
    }
}
function resolveMetadataStrategyOrder(profile, hasVideoId) {
    if (profile === "local-only") {
        return [];
    }
    if (profile === "mainstream-first") {
        return hasVideoId ? ["tmdb", "javdatabase"] : ["tmdb"];
    }
    if (hasVideoId) {
        return ["javdatabase", "tmdb"];
    }
    return ["tmdb"];
}
function buildMetadataCacheKey(movie, settings, profile, resolvedVideoId) {
    return [
        profile,
        settings.tmdbNonCommercialUse ? "tmdb-allowed" : "tmdb-blocked",
        settings.tmdbReadAccessToken.trim() || "notmdb",
        settings.language,
        settings.region,
        resolvedVideoId ?? "",
        normalize(movie.title),
        movie.year ?? "",
        node_path_1.default.resolve(movie.sourcePath).toLowerCase()
    ].join("|");
}
async function fetchActressPhotoFromJavDatabase(name) {
    const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const response = await fetch(`https://www.javdatabase.com/idols/${slug}/`, {
        headers: {
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        }
    });
    if (!response.ok)
        return null;
    const html = await response.text();
    // Try og:image first (usually a headshot for idol pages)
    const ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/i);
    if (ogMatch?.[1])
        return ogMatch[1];
    // Fallback: look for idol image pattern
    const imgMatch = html.match(/<img[^>]+class="[^"]*idol[^"]*"[^>]+src="([^"]+)"/i);
    return imgMatch?.[1] ?? null;
}
async function fetchJavDatabaseMetadata(videoId, signal) {
    const slug = encodeURIComponent(videoId.toLowerCase());
    const response = await fetch(`https://www.javdatabase.com/movies/${slug}/`, {
        signal,
    headers: {
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
        }
    });
    if (!response.ok) {
        return null;
    }
    const html = await response.text();
    const posterMatch = html.match(/property="og:image"\s+content="([^"]+)"/i);
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const actresses = parseActressesFromDocumentTitle(titleMatch?.[1] ?? "", videoId);
    return {
        actresses,
        modelName: videoId.split("-")[0] ?? null,
        posterUrl: posterMatch?.[1] ?? null,
        source: "javdatabase",
    pageTitle: titleMatch?.[1],
        videoId
    };
}
function parseActressesFromDocumentTitle(documentTitle, videoId) {
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
    const actressSegment = segments[0].toUpperCase() === videoId.toUpperCase()
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
function normalize(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function createFallbackProgress(currentFile) {
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
