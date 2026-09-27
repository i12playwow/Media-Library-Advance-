import type { OrganizationSettings } from "./contracts";

export interface OrganizationTemplateValues {
  dvdId: string;
  actress: string;
  title: string;
  year: string;
  studio: string;
}

export interface OrganizationTemplateSample {
  title: string;
  year: number | null;
  videoId: string | null;
  actresses: string[];
  studio?: string | null;
}

export const DEFAULT_ORGANIZATION_SETTINGS: OrganizationSettings = {
  normalPathTemplate: "{actress}/{dvdId}",
  gentlePathTemplate: "{actress}/{dvdId}",
  fileNameTemplate: "{dvdId}",
  normalLibraryPath: "",
  gentleLibraryPath: ""
};

export const ORGANIZATION_TEMPLATE_TOKENS = [
  { token: "{dvdId}", label: "DVD-ID" },
  { token: "{actress}", label: "Actress" },
  { token: "{title}", label: "Title" },
  { token: "{year}", label: "Year" },
  { token: "{studio}", label: "Studio" }
] as const;

export function resolveOrganizationTemplateValues(
  sample: OrganizationTemplateSample
): OrganizationTemplateValues {
  const dvdId = sample.videoId?.trim() || "DVD-ID";
  const title = sample.title.trim() || dvdId || "Untitled";
  const actress = sample.actresses[0]?.trim() || "Unknown Actress";
  const year = sample.year ? String(sample.year) : "";
  const studio =
    sample.studio?.trim() ||
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

export function renderOrganizationPathTemplate(
  template: string,
  values: OrganizationTemplateValues,
  fallbackSegments: string[],
  maxLength = 80
): string[] {
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

export function renderOrganizationFileTemplate(
  template: string,
  values: OrganizationTemplateValues,
  fallback: string,
  maxLength = 120
): string {
  return (
    renderOrganizationTemplateSegment(template, values, maxLength) ||
    sanitizeTemplateSegment(fallback, maxLength) ||
    "Untitled"
  );
}

export function sanitizeTemplateSegment(
  value: string,
  maxLength = 120
): string {
  const cleaned = cleanupRenderedValue(value)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .trim();
  const normalized = cleaned || "Untitled";
  return normalized.slice(0, maxLength).trim() || "Untitled";
}

function renderOrganizationTemplateSegment(
  template: string,
  values: OrganizationTemplateValues,
  maxLength: number
): string {
  const rendered = template
    .replace(/\{dvdId\}/gi, values.dvdId)
    .replace(/\{actress\}/gi, values.actress)
    .replace(/\{title\}/gi, values.title)
    .replace(/\{year\}/gi, values.year)
    .replace(/\{studio\}/gi, values.studio);

  return sanitizeTemplateSegment(rendered, maxLength);
}

function cleanupRenderedValue(value: string): string {
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
