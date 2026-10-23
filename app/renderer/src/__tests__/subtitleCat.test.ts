// @vitest-environment node
//
// Offline tests for the shared SubtitleCat scraper. Fixtures mirror the site's
// current markup (search rows link to detail pages; detail pages carry the
// per-language .srt links) plus the legacy direct-link layout. No network:
// `fetch` is stubbed, so these tests pin the parser contract that the scan-time
// auto-download and the player's manual subtitle search both depend on.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchSubtitleCatResults,
  languageLabelFromCode,
  parseSubtitleCatDetailLanguages,
  parseSubtitleCatSearchRows
} from "../../../services/subtitleCat";

const SEARCH_HTML = `<table class="table sub-table">
  <thead>
    <tr><th colspan="2"><h2>2 subtitles found</h2></th></tr>
  </thead>
  <tbody>
    <tr>
      <td><a href="subs/431/ipx-787.html">ipx-787</a> (translated from Chinese)</td>
      <td class="sub-table__metric"><span class="sub-table__metric-label">Downloads</span><span class="sub-table__metric-value">9<span class="sub-table__metric-unit"> downloads</span></span></td>
    </tr>
    <tr>
      <td><a href="subs/350/IPX-787.dl.en.html">IPX-787.dl.en</a> (translated from English)</td>
      <td class="sub-table__metric"><span class="sub-table__metric-label">Downloads</span><span class="sub-table__metric-value">18<span class="sub-table__metric-unit"> downloads</span></span></td>
    </tr>
  </tbody>
</table>`;

const DETAIL_HTML = `<div class="sub-single">
    <span>English</span>
    <span><a id="download_en"  onclick="log_download(1); show_voting('en');" href="/subs/431/ipx-787-en.srt" class="green-link">Download</a></span>
  </div>
  <div class="sub-single">
    <span>Chinese (Simplified)</span>
    <span><a id="download_zh-CN"  onclick="log_download(2); show_voting('zh-CN');" href="/subs/434/ipx-787-zh-CN.srt" class="green-link">Download</a></span>
  </div>
  <div class="sub-single">
    <span>Afrikaans</span>
    <span><button id="af" onclick="translate_from_server_folder('af', 'ipx-787-orig.srt', '/subs/431/')" class="yellow-link">Translate</button></span>
  </div>`;

// The pre-redesign layout: a direct .srt link inline in the search page.
const LEGACY_SEARCH_HTML = `<table>
  <tbody>
    <tr><td><a href="/sub/431/ipx-787.en.srt">ipx-787</a> (translated from English)</td><td>9 downloads</td></tr>
  </tbody>
</table>`;

function htmlResponse(html: string): Response {
  return {
    ok: true,
    status: 200,
    text: async () => html
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseSubtitleCatSearchRows", () => {
  it("extracts detail-page links, titles, and download counts from current markup", () => {
    expect(parseSubtitleCatSearchRows(SEARCH_HTML)).toEqual([
      {
        detailUrl: "https://www.subtitlecat.com/subs/431/ipx-787.html",
        title: "ipx-787",
        downloads: 9
      },
      {
        detailUrl: "https://www.subtitlecat.com/subs/350/IPX-787.dl.en.html",
        title: "IPX-787.dl.en",
        downloads: 18
      }
    ]);
  });

  it("returns nothing for legacy pages without detail links", () => {
    expect(parseSubtitleCatSearchRows(LEGACY_SEARCH_HTML)).toEqual([]);
  });
});

describe("parseSubtitleCatDetailLanguages", () => {
  it("collects per-language .srt links and skips translate-only languages", () => {
    expect(parseSubtitleCatDetailLanguages(DETAIL_HTML)).toEqual([
      {
        languageCode: "en",
        downloadUrl: "https://www.subtitlecat.com/subs/431/ipx-787-en.srt"
      },
      {
        languageCode: "zh-cn",
        downloadUrl: "https://www.subtitlecat.com/subs/434/ipx-787-zh-CN.srt"
      }
    ]);
  });
});

describe("fetchSubtitleCatResults", () => {
  it("walks search page → detail pages and returns downloadable results", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("index.php?search=")) return htmlResponse(SEARCH_HTML);
      if (url.endsWith(".html")) return htmlResponse(DETAIL_HTML);
      throw new Error(`unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await fetchSubtitleCatResults("IPX-787");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.subtitlecat.com/index.php?search=IPX-787",
      expect.anything()
    );
    expect(results).toHaveLength(2);
    expect(results.map((result) => result.downloadUrl)).toEqual([
      "https://www.subtitlecat.com/subs/431/ipx-787-en.srt",
      "https://www.subtitlecat.com/subs/434/ipx-787-zh-CN.srt"
    ]);
    expect(results[0]).toMatchObject({
      title: "IPX-787.dl.en",
      language: "English",
      languageCode: "en",
      downloads: 18
    });
    expect(results[1]).toMatchObject({
      language: "Chinese Simplified",
      languageCode: "zh-cn"
    });
  });

  it("still parses the legacy direct-link layout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => htmlResponse(LEGACY_SEARCH_HTML))
    );

    const results = await fetchSubtitleCatResults("IPX-787");
    expect(results).toEqual([
      {
        id: "en-0",
        title: "ipx-787",
        language: "English",
        languageCode: "en",
        downloadUrl: "https://www.subtitlecat.com/sub/431/ipx-787.en.srt",
        downloads: 9
      }
    ]);
  });

  it("retries the search uppercased when the first pass finds nothing", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("search=IPX-787")
        ? htmlResponse(LEGACY_SEARCH_HTML)
        : htmlResponse("<html><body>No results</body></html>")
    );
    vi.stubGlobal("fetch", fetchMock);

    const results = await fetchSubtitleCatResults("ipx-787");
    expect(results).toHaveLength(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://www.subtitlecat.com/index.php?search=ipx-787",
      expect.anything()
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://www.subtitlecat.com/index.php?search=IPX-787",
      expect.anything()
    );
  });

  it("degrades to an empty list when the site is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    await expect(fetchSubtitleCatResults("IPX-787")).resolves.toEqual([]);
  });
});

describe("languageLabelFromCode", () => {
  it("maps language codes to display labels", () => {
    expect(languageLabelFromCode("en")).toBe("English");
    expect(languageLabelFromCode("zh-cn")).toBe("Chinese Simplified");
    expect(languageLabelFromCode("zh-tw")).toBe("Chinese Traditional");
    expect(languageLabelFromCode("ja")).toBe("Japanese");
    expect(languageLabelFromCode("xx")).toBe("XX");
  });
});
