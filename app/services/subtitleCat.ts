// SubtitleCat scraping, shared by the player's manual subtitle search
// (main.ts `player:fetchSubtitles`) and the scanner's auto-download
// (`libraryScanner.ts`). One parser, two consumers: the scanner kept its own
// stale copy that still expected the site's old `/sub/*.srt` direct links and
// silently found nothing after SubtitleCat moved to detail pages.
//
// Current SubtitleCat markup (verified live):
//   search page:  <tr> ... <a href="subs/431/ipx-787.html">ipx-787</a> (translated from Chinese)
//                 ... <span class="sub-table__metric-value">9<span class="sub-table__metric-unit"> downloads</span>
//   detail page:  <a id="download_en" onclick="..." href="/subs/431/ipx-787-en.srt" class="green-link">Download</a>
// Languages that exist only as machine translations render a Translate button
// instead of a download link, so they are naturally skipped.
import type { OnlineSubtitleResult } from "../shared/contracts";

const SUBTITLECAT_BASE = "https://www.subtitlecat.com";
const MAX_DETAIL_PAGES = 5;
const MAX_RESULTS = 30;

const REQUEST_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5"
};

interface SubtitleCatSearchRow {
  detailUrl: string;
  title: string;
  downloads: number;
}

interface SubtitleCatLanguageLink {
  languageCode: string;
  downloadUrl: string;
}

/** Parse the search-result rows of a SubtitleCat search page. */
export function parseSubtitleCatSearchRows(html: string): SubtitleCatSearchRow[] {
  const rows = html.split(/<tr\b/i).slice(1);
  const parsed: SubtitleCatSearchRow[] = [];

  for (const row of rows) {
    const link = row.match(/<a[^>]+href="(subs\/\d+\/[^"]+\.html)"[^>]*>([^<]*)<\/a>/i);
    if (!link) continue;

    // The metric markup wraps the count and the word "downloads" in separate
    // spans; fall back to the flat "123 downloads" form for older pages.
    const downloadsMatch =
      row.match(/sub-table__metric-value">(\d[\d,]*)\s*<span class="sub-table__metric-unit">\s*downloads/i) ??
      row.match(/(\d[\d,]*)\s*(?:downloads?|dl)\b/i);

    parsed.push({
      detailUrl: `${SUBTITLECAT_BASE}/${link[1]}`,
      title: link[2].trim(),
      downloads: downloadsMatch ? Number(downloadsMatch[1].replace(/,/g, "")) : 0
    });
  }

  return parsed;
}

/** Parse the per-language download links out of a SubtitleCat detail page. */
export function parseSubtitleCatDetailLanguages(html: string): SubtitleCatLanguageLink[] {
  const links: SubtitleCatLanguageLink[] = [];
  const seen = new Set<string>();

  // id="download_en" ... href="/subs/341/ipx-787-en.srt" ... >Download</a>
  const anchorRegex =
    /<a[^>]+id="download_([a-zA-Z]{2}(?:-[a-zA-Z]{2})?)"[^>]+href="([^"]+\.srt[^"]*)"[^>]*>(?:Download)?<\/a>/gi;

  for (const match of html.matchAll(anchorRegex)) {
    const languageCode = match[1].toLowerCase();
    const downloadUrl = match[2].startsWith("http")
      ? match[2]
      : `${SUBTITLECAT_BASE}${match[2]}`;
    if (seen.has(downloadUrl)) continue;
    seen.add(downloadUrl);
    links.push({ languageCode, downloadUrl });
  }

  return links;
}

export function languageLabelFromCode(code: string): string {
  const normalized = code.toLowerCase();
  if (normalized === "zh-hans" || normalized === "zh-cn") return "Chinese Simplified";
  if (normalized === "zh-hant" || normalized === "zh-tw" || normalized === "zh-hk") {
    return "Chinese Traditional";
  }
  if (normalized === "zh") return "Chinese";
  if (normalized === "en") return "English";
  if (normalized === "ja") return "Japanese";
  if (normalized === "ko") return "Korean";
  if (normalized === "es") return "Spanish";
  if (normalized === "fr") return "French";
  if (normalized === "de") return "German";
  if (normalized === "pt") return "Portuguese";
  if (normalized === "th") return "Thai";
  if (normalized === "vi") return "Vietnamese";
  if (normalized === "id") return "Indonesian";
  if (normalized === "ar") return "Arabic";
  if (normalized === "ru") return "Russian";
  if (normalized === "it") return "Italian";
  return code.length > 0 ? code.toUpperCase() : "Unknown";
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { headers: REQUEST_HEADERS });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Search SubtitleCat and return per-language download results.
 *
 * Strategy: the search page only links to per-subtitle detail pages, so we
 * parse the top rows, fetch those detail pages, and collect the direct `.srt`
 * links. The legacy direct-link rows (`/sub/*.srt`) are still parsed as a
 * fallback in case the site serves the old layout again. Failures at any
 * stage degrade to an empty list — callers treat that as "no subtitles
 * found", never as an error.
 */
export async function fetchSubtitleCatResults(
  query: string
): Promise<OnlineSubtitleResult[]> {
  try {
    let results = await searchOnce(query);
    if (results.length === 0 && query !== query.toUpperCase()) {
      results = await searchOnce(query.toUpperCase());
    }
    return results;
  } catch {
    return [];
  }
}

async function searchOnce(q: string): Promise<OnlineSubtitleResult[]> {
  const html = await fetchHtml(
    `${SUBTITLECAT_BASE}/index.php?search=${encodeURIComponent(q)}`
  );
  if (!html) return [];

  const results: OnlineSubtitleResult[] = [];
  const seenUrls = new Set<string>();
  const normalizedQuery = q.toUpperCase();

  const matchesQuery = (title: string): boolean => {
    const upper = title.toUpperCase();
    return upper.includes(normalizedQuery) || normalizedQuery.includes(upper);
  };

  const push = (result: OnlineSubtitleResult): void => {
    if (seenUrls.has(result.downloadUrl)) return;
    seenUrls.add(result.downloadUrl);
    results.push(result);
  };

  // 1. Current layout: rows link to detail pages that carry the .srt links.
  const rows = parseSubtitleCatSearchRows(html)
    .filter((row) => !row.title || matchesQuery(row.title))
    .sort((left, right) => right.downloads - left.downloads)
    .slice(0, MAX_DETAIL_PAGES);

  for (const row of rows) {
    const detailHtml = await fetchHtml(row.detailUrl);
    if (!detailHtml) continue;
    for (const link of parseSubtitleCatDetailLanguages(detailHtml)) {
      push({
        id: `${link.languageCode}-${results.length}`,
        title: row.title || q,
        language: languageLabelFromCode(link.languageCode),
        languageCode: link.languageCode,
        downloadUrl: link.downloadUrl,
        downloads: row.downloads
      });
    }
  }

  // 2. Legacy layout: direct /sub/*.srt links inline in the search page.
  for (const line of html.split(/\r?\n/)) {
    const linkMatch = line.match(/href="(\/sub\/[^"]+\.srt)"/i);
    if (!linkMatch) continue;

    const titleMatch = line.match(/>([^<]{3,})<\/a>/i);
    const title = titleMatch?.[1]?.trim() ?? q;
    if (!matchesQuery(title)) continue;

    const langMatch =
      line.match(/translated from ([A-Za-z]+)/i) ??
      line.match(/alt="([A-Za-z ]{2,30})"/i);
    const language = langMatch?.[1]?.trim() ?? "Unknown";
    const langCode = language.toLowerCase().slice(0, 2);

    const downloadsMatch =
      line.match(/(\d[\d,]*)\s*(?:downloads?|dl)\b/i) ??
      line.match(/⬇\s*(\d[\d,]*)/i);

    push({
      id: `${langCode}-${results.length}`,
      title,
      language,
      languageCode: langCode,
      downloadUrl: `${SUBTITLECAT_BASE}${linkMatch[1]}`,
      downloads: downloadsMatch ? Number(downloadsMatch[1].replace(/,/g, "")) : 0
    });
  }

  return results
    .sort(
      (left, right) =>
        right.downloads - left.downloads || left.title.localeCompare(right.title)
    )
    .slice(0, MAX_RESULTS);
}
