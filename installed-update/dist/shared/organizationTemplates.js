"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ORGANIZATION_TEMPLATE_TOKENS = exports.DEFAULT_ORGANIZATION_SETTINGS = void 0;
exports.resolveOrganizationTemplateValues = resolveOrganizationTemplateValues;
exports.renderOrganizationPathTemplate = renderOrganizationPathTemplate;
exports.renderOrganizationFileTemplate = renderOrganizationFileTemplate;
exports.sanitizeTemplateSegment = sanitizeTemplateSegment;
exports.DEFAULT_ORGANIZATION_SETTINGS = {
    normalPathTemplate: "{actress}/{dvdId}",
    gentlePathTemplate: "{actress}/{dvdId}",
    fileNameTemplate: "{dvdId}",
    normalLibraryPath: "",
    gentleLibraryPath: ""
};
exports.ORGANIZATION_TEMPLATE_TOKENS = [
    { token: "{dvdId}", label: "DVD-ID" },
    { token: "{actress}", label: "Actress" },
    { token: "{title}", label: "Title" },
    { token: "{year}", label: "Year" },
    { token: "{studio}", label: "Studio" }
];
function resolveOrganizationTemplateValues(sample) {
    const dvdId = sample.videoId?.trim() || "DVD-ID";
    const title = sample.title.trim() || dvdId || "Untitled";
    const actress = sample.actresses[0]?.trim() || "Unknown Actress";
    const year = sample.year ? String(sample.year) : "";
    const studio = sample.studio?.trim() ||
        sample.videoId?.split("-")[0]?.trim() ||
        "Unknown Studio";
    return {
        dvdId,
        actress,
        title,
        year,
        studio
    };
}
function renderOrganizationPathTemplate(template, values, fallbackSegments, maxLength = 80) {
    const renderedSegments = template
        .split(/[\\/]+/)
        .map((segment) => renderOrganizationTemplateSegment(segment, values, maxLength))
        .filter(Boolean);
    if (renderedSegments.length > 0) {
        return renderedSegments;
    }
    return fallbackSegments
        .map((segment) => sanitizeTemplateSegment(segment, maxLength))
        .filter(Boolean);
}
function renderOrganizationFileTemplate(template, values, fallback, maxLength = 120) {
    return (renderOrganizationTemplateSegment(template, values, maxLength) ||
        sanitizeTemplateSegment(fallback, maxLength) ||
        "Untitled");
}
function sanitizeTemplateSegment(value, maxLength = 120) {
    const cleaned = cleanupRenderedValue(value)
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
        .trim();
    const normalized = cleaned || "Untitled";
    return normalized.slice(0, maxLength).trim() || "Untitled";
}
function renderOrganizationTemplateSegment(template, values, maxLength) {
    const rendered = template
        .replace(/\{dvdId\}/gi, values.dvdId)
        .replace(/\{actress\}/gi, values.actress)
        .replace(/\{title\}/gi, values.title)
        .replace(/\{year\}/gi, values.year)
        .replace(/\{studio\}/gi, values.studio);
    return sanitizeTemplateSegment(rendered, maxLength);
}
function cleanupRenderedValue(value) {
    return value
        .replace(/\(\s*\)/g, "")
        .replace(/\[\s*\]/g, "")
        .replace(/\{\s*\}/g, "")
        .replace(/\s+-\s+-/g, "-")
        .replace(/\s+/g, " ")
        .replace(/\s+([)\]])/g, "$1")
        .replace(/([([])\s+/g, "$1")
        .trim();
}
