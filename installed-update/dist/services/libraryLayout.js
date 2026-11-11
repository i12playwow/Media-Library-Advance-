"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMovieBaseName = buildMovieBaseName;
exports.buildLibraryTargetDirectory = buildLibraryTargetDirectory;
exports.buildTargetVideoPath = buildTargetVideoPath;
exports.buildTargetNfoPath = buildTargetNfoPath;
exports.buildTargetSubtitlePath = buildTargetSubtitlePath;
exports.ensureLibraryTargetDirectory = ensureLibraryTargetDirectory;
exports.writeMovieNfo = writeMovieNfo;
exports.savePosterToFolder = savePosterToFolder;
exports.parseNfoXml = parseNfoXml;
exports.readNfoMetadata = readNfoMetadata;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const organizationTemplates_1 = require("../shared/organizationTemplates");
function buildMovieBaseName(params) {
    const settings = params.organizationSettings ?? organizationTemplates_1.DEFAULT_ORGANIZATION_SETTINGS;
    const values = (0, organizationTemplates_1.resolveOrganizationTemplateValues)({
        title: params.title,
        year: params.year,
        videoId: params.videoId,
        actresses: params.actresses,
        studio: params.modelName
    });
    const fallback = params.videoId || params.title || "Untitled";
    return (0, organizationTemplates_1.renderOrganizationFileTemplate)(settings.fileNameTemplate, values, fallback, params.resolveLongPath ? 48 : 120);
}
function buildLibraryTargetDirectory(root, params) {
    const settings = params.organizationSettings ?? organizationTemplates_1.DEFAULT_ORGANIZATION_SETTINGS;
    const values = (0, organizationTemplates_1.resolveOrganizationTemplateValues)({
        title: params.title,
        year: params.year,
        videoId: params.videoId,
        actresses: params.actresses,
        studio: params.modelName
    });
    const defaultMovieName = params.videoId || values.title || values.studio || "Untitled";
    const template = params.libraryMode === "gentle"
        ? settings.gentlePathTemplate
        : settings.normalPathTemplate;
    const segments = (0, organizationTemplates_1.renderOrganizationPathTemplate)(template, values, [defaultMovieName], params.resolveLongPath ? 40 : 80);
    // If we have actress data, prefer `Actress/Title` organization by
    // prefixing the rendered path with the first actress name. This keeps
    // organization intuitive: libraryRoot/Actress/MovieFolder
    const firstActress = params.actresses && params.actresses.length > 0 ? params.actresses[0] : null;
    if (firstActress) {
        const sanitized = firstActress.replace(/[\\/:*?"<>|]/g, "-").trim();
        const actressSegment = sanitized || "Unknown Actress";
        return node_path_1.default.join(root, actressSegment, ...segments);
    }
    return node_path_1.default.join(root, ...segments);
}
function buildTargetVideoPath(directory, params, extension) {
    const stem = buildMovieBaseName(params);
    let candidate = node_path_1.default.join(directory, `${stem}${extension.toLowerCase()}`);
    if (params.resolveLongPath && candidate.length > 220) {
        const budget = Math.max(20, 220 - directory.length - extension.length - 2);
        const shortenedStem = stem.slice(0, budget).trim() || "Untitled";
        candidate = node_path_1.default.join(directory, `${shortenedStem}${extension.toLowerCase()}`);
    }
    return candidate;
}
function buildTargetNfoPath(directory, params) {
    const stem = buildMovieBaseName(params);
    return node_path_1.default.join(directory, `${stem}.nfo`);
}
function buildTargetSubtitlePath(params) {
    const stem = buildMovieBaseName({
        libraryMode: "normal",
        title: params.title,
        year: params.year,
        videoId: params.videoId,
        actresses: params.actresses,
        modelName: params.modelName,
        resolveLongPath: params.resolveLongPath,
        organizationSettings: params.organizationSettings
    });
    const needsLanguageSuffix = params.subtitleCount > 1 && params.language !== "UND";
    const languageSuffix = needsLanguageSuffix
        ? `.${params.language.toLowerCase()}`
        : "";
    return node_path_1.default.join(params.directory, `${stem}${languageSuffix}${params.extension.toLowerCase()}`);
}
async function ensureLibraryTargetDirectory(root, params) {
    const directory = buildLibraryTargetDirectory(root, params);
    await promises_1.default.mkdir(directory, { recursive: true });
    return directory;
}
async function writeMovieNfo(params) {
    const nfoPath = buildTargetNfoPath(params.directory, {
        libraryMode: params.libraryMode,
        title: params.title,
        year: params.year,
        videoId: params.videoId,
        actresses: params.actresses,
        modelName: params.modelName,
        resolveLongPath: true,
        organizationSettings: params.organizationSettings
    });
    const xml = buildMovieNfoXml(params);
    await promises_1.default.writeFile(nfoPath, xml, "utf8");
    return nfoPath;
}
function buildMovieNfoXml(params) {
    const baseName = buildMovieBaseName({
        libraryMode: params.libraryMode,
        title: params.title,
        year: params.year,
        videoId: params.videoId,
        actresses: params.actresses,
        modelName: params.modelName,
        resolveLongPath: true,
        organizationSettings: params.organizationSettings
    });
    const actorsXml = params.actresses
        .map((actress) => `  <actor>\n    <name>${escapeXml(actress)}</name>\n  </actor>`)
        .join("\n");
    const modelName = params.modelName || params.videoId?.split("-")[0] || "Unknown Studio";
    return [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        "<movie>",
        `  <title>${escapeXml(baseName)}</title>`,
        `  <originaltitle>${escapeXml(baseName)}</originaltitle>`,
        `  <sorttitle>${escapeXml(baseName)}</sorttitle>`,
        params.videoId ? `  <id>${escapeXml(params.videoId)}</id>` : "",
        `  <studio>${escapeXml(modelName)}</studio>`,
        `  <tag>${escapeXml(params.libraryMode)}</tag>`,
        `  <source>${escapeXml(params.sourcePath)}</source>`,
        actorsXml,
        "</movie>",
        ""
    ]
        .filter(Boolean)
        .join("\n");
}
function escapeXml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
/**
 * Download a poster image from web and save it into the movie folder.
 * Returns the saved path, or null if download failed.
 */
async function savePosterToFolder(directory, posterUrl) {
    if (!posterUrl.startsWith("http"))
        return null;
    try {
        const response = await globalThis.fetch(posterUrl);
        if (!response.ok)
            return null;
        const buffer = Buffer.from(await response.arrayBuffer());
        const extMatch = posterUrl.match(/\.(jpe?g|png|webp)/i);
        const ext = extMatch ? extMatch[0].toLowerCase() : ".jpg";
        const posterPath = node_path_1.default.join(directory, `poster${ext}`);
        await promises_1.default.writeFile(posterPath, buffer);
        return posterPath;
    }
    catch {
        return null;
    }
}
/**
 * Parse an existing .nfo XML file and extract movie metadata.
 */
function parseNfoXml(xml) {
    const result = {};
    const titleMatch = xml.match(/<title>([\s\S]*?)<\/title>/);
    if (titleMatch)
        result.title = titleMatch[1].trim();
    const idMatch = xml.match(/<id>([\s\S]*?)<\/id>/);
    if (idMatch)
        result.videoId = idMatch[1].trim();
    const yearMatch = xml.match(/<year>([\s\S]*?)<\/year>/);
    if (yearMatch) {
        const y = parseInt(yearMatch[1].trim(), 10);
        if (!isNaN(y))
            result.year = y;
    }
    const studioMatch = xml.match(/<studio>([\s\S]*?)<\/studio>/);
    if (studioMatch)
        result.studio = studioMatch[1].trim();
    const actresses = [...xml.matchAll(/<actor\b[^>]*>([\s\S]*?)<\/actor\s*>/gi)]
        .map(([, actor]) => actor.match(/<name\b[^>]*>([\s\S]*?)<\/name\s*>/i)?.[1].trim() ?? "")
        .map(name => name.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, "$1")
        .replace(/&(amp|quot|apos|lt|gt);/g, (_, entity) => ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" })[entity] ?? ""))
        .filter(Boolean);
    if (actresses.length)
        result.actresses = actresses;
    return result;
}
/**
 * Read and parse an .nfo sidecar file for a video.
 * Matches the video filename, or a shared movie.nfo for a single-video folder.
 */
async function readNfoMetadata(videoPath) {
    try {
        const content = await require("./nfoSidecar.cjs").readMatchingNfo(videoPath);
        if (content)
            return parseNfoXml(content);
    }
    catch {
        // Gracefully ignore read errors
    }
    return {};
}
