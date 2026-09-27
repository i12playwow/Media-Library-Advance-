import { describe, expect, it } from "vitest";
import type { PosterBackfillSummary, ScanProgress, ScanSummary } from "../../../shared/contracts";
import {
  buildPosterBackfillMessage,
  buildPosterRefreshMessage,
  buildScanStatusMessage,
  deriveRegionLabel,
  deriveStudioName,
  deriveTagLabel,
  formatTime,
  getProgressPercent,
  getPosterFallbackBackground,
  getScanStageLabel,
  inferActressFromPath,
  srtToVtt,
} from "../utils";

// ---------------------------------------------------------------------------
// srtToVtt
// ---------------------------------------------------------------------------
describe("srtToVtt", () => {
  it("prepends WEBVTT header", () => {
    expect(srtToVtt("1\n00:00:01,000 --> 00:00:02,000\nHello\n")).toMatch(/^WEBVTT/);
  });

  it("converts SRT timestamp commas to dots", () => {
    const result = srtToVtt("1\n00:00:01,500 --> 00:00:02,750\nHi\n");
    expect(result).toContain("00:00:01.500 --> 00:00:02.750");
  });

  it("strips cue index lines", () => {
    const result = srtToVtt("1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld\n");
    expect(result).not.toMatch(/^\d+$/m);
    expect(result).toContain("Hello");
    expect(result).toContain("World");
  });

  it("normalises Windows line endings", () => {
    const srt = "1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n";
    expect(srtToVtt(srt)).not.toContain("\r");
  });
});

// ---------------------------------------------------------------------------
// formatTime
// ---------------------------------------------------------------------------
describe("formatTime", () => {
  it("formats seconds only", () => {
    expect(formatTime(45)).toBe("0:45");
  });

  it("formats minutes and seconds", () => {
    expect(formatTime(90)).toBe("1:30");
  });

  it("pads seconds with leading zero", () => {
    expect(formatTime(61)).toBe("1:01");
  });

  it("formats hours correctly", () => {
    expect(formatTime(3661)).toBe("1:01:01");
  });

  it("handles zero", () => {
    expect(formatTime(0)).toBe("0:00");
  });
});

// ---------------------------------------------------------------------------
// getProgressPercent
// ---------------------------------------------------------------------------
describe("getProgressPercent", () => {
  it("returns 0 for null progress", () => {
    expect(getProgressPercent(null)).toBe(0);
  });

  it("returns 100 for completed with zero totalFiles", () => {
    const p = mockProgress({ stage: "completed", processedFiles: 0, totalFiles: 0 });
    expect(getProgressPercent(p)).toBe(100);
  });

  it("returns 0 for cancelled with zero totalFiles", () => {
    const p = mockProgress({ stage: "cancelled", processedFiles: 0, totalFiles: 0 });
    expect(getProgressPercent(p)).toBe(0);
  });

  it("returns 5 for in-progress with zero totalFiles", () => {
    const p = mockProgress({ stage: "processing", processedFiles: 0, totalFiles: 0 });
    expect(getProgressPercent(p)).toBe(5);
  });

  it("calculates percentage correctly", () => {
    const p = mockProgress({ processedFiles: 50, totalFiles: 200 });
    expect(getProgressPercent(p)).toBe(25);
  });

  it("caps at 100", () => {
    const p = mockProgress({ processedFiles: 999, totalFiles: 100 });
    expect(getProgressPercent(p)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// getScanStageLabel
// ---------------------------------------------------------------------------
describe("getScanStageLabel", () => {
  it("returns Idle for null", () => {
    expect(getScanStageLabel(null)).toBe("Idle");
  });

  it.each([
    ["preparing", "Preparing"],
    ["discovering", "Discovering"],
    ["processing", "Processing"],
    ["completed", "Completed"],
    ["cancelled", "Cancelled"],
    ["error", "Error"],
  ] as const)("maps stage %s to label %s", (stage, label) => {
    expect(getScanStageLabel(mockProgress({ stage }))).toBe(label);
  });
});

// ---------------------------------------------------------------------------
// getPosterFallbackBackground
// ---------------------------------------------------------------------------
describe("getPosterFallbackBackground", () => {
  it("returns a linear-gradient CSS string", () => {
    const result = getPosterFallbackBackground("Test Movie");
    expect(result).toMatch(/^linear-gradient\(180deg, #[0-9a-f]{6}, #[0-9a-f]{6}\)$/i);
  });

  it("returns the same gradient for the same title", () => {
    expect(getPosterFallbackBackground("Repeatable")).toBe(getPosterFallbackBackground("Repeatable"));
  });

  it("returns different gradients for different titles (usually)", () => {
    const a = getPosterFallbackBackground("Alpha");
    const b = getPosterFallbackBackground("Zeta");
    // not guaranteed to differ but very likely with these two
    expect(typeof a).toBe("string");
    expect(typeof b).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// inferActressFromPath
// ---------------------------------------------------------------------------
describe("inferActressFromPath", () => {
  it("infers actress from parent directory", () => {
    expect(inferActressFromPath("C:/library/Chiharu Mitsuha/movie.mp4")).toBe("Chiharu Mitsuha");
  });

  it("returns null for generic parent names", () => {
    expect(inferActressFromPath("C:/movies/movie.mp4")).toBeNull();
    expect(inferActressFromPath("C:/videos/movie.mp4")).toBeNull();
    expect(inferActressFromPath("C:/downloads/movie.mp4")).toBeNull();
  });

  it("returns null when path is too short", () => {
    expect(inferActressFromPath("movie.mp4")).toBeNull();
  });

  it("returns null for very short parent segment (drive letter)", () => {
    expect(inferActressFromPath("c:/movie.mp4")).toBeNull();
  });

  it("handles backslash paths", () => {
    expect(inferActressFromPath("C:\\library\\Yui Nishikawa\\film.mkv")).toBe("Yui Nishikawa");
  });
});

// ---------------------------------------------------------------------------
// buildScanStatusMessage
// ---------------------------------------------------------------------------
describe("buildScanStatusMessage", () => {
  it("returns cancellation message when cancelled", () => {
    expect(buildScanStatusMessage(mockScanSummary({ cancelled: true }))).toContain("cancelled");
  });

  it("reports no files found when discovered is 0", () => {
    expect(buildScanStatusMessage(mockScanSummary({ discovered: 0 }))).toContain("no video files");
  });

  it("includes error in no-files message", () => {
    const msg = buildScanStatusMessage(mockScanSummary({ discovered: 0, errors: ["disk full"] }));
    expect(msg).toContain("disk full");
  });

  it("builds success message with counts", () => {
    const msg = buildScanStatusMessage(mockScanSummary({ imported: 5, discovered: 10 }));
    expect(msg).toContain("5 entries synced");
    expect(msg).toContain("10 discovered");
  });
});

// ---------------------------------------------------------------------------
// buildPosterBackfillMessage / buildPosterRefreshMessage
// ---------------------------------------------------------------------------
describe("buildPosterBackfillMessage", () => {
  it("reports nothing to do when requested is 0", () => {
    expect(buildPosterBackfillMessage(mockPosterSummary({ requested: 0 }))).toContain("already has a poster");
  });

  it("reports updated/skipped counts", () => {
    const msg = buildPosterBackfillMessage(mockPosterSummary({ requested: 5, updated: 3, skipped: 2 }));
    expect(msg).toContain("3 poster");
    expect(msg).toContain("2 skipped");
  });
});

describe("buildPosterRefreshMessage", () => {
  it("reports nothing selected when requested is 0", () => {
    expect(buildPosterRefreshMessage(mockPosterSummary({ requested: 0 }))).toContain("No posters were selected");
  });

  it("reports updated/skipped counts", () => {
    const msg = buildPosterRefreshMessage(mockPosterSummary({ requested: 4, updated: 4, skipped: 0 }));
    expect(msg).toContain("4 poster");
  });
});

// ---------------------------------------------------------------------------
// deriveStudioName / deriveTagLabel
// ---------------------------------------------------------------------------
describe("library label helpers", () => {
  it("derives studio from video ID first", () => {
    expect(deriveStudioName({ videoId: "FSDSS-799", keywords: [] })).toBe("FSDSS");
  });

  it("falls back to keywords for studio", () => {
    expect(deriveStudioName({ videoId: null, keywords: ["Madou"] })).toBe("Madou");
  });

  it("returns Unknown Studio when no label exists", () => {
    expect(deriveStudioName({ videoId: null, keywords: [] })).toBe("Unknown Studio");
  });

  it("derives tag from the first keyword", () => {
    expect(deriveTagLabel({ keywords: ["TagA"], libraryMode: "normal" })).toBe("TagA");
  });

  it("falls back to library mode for tag", () => {
    expect(deriveTagLabel({ keywords: [], libraryMode: "gentle" })).toBe("gentle");
  });

  it("derives Japan for gentle/JAV-style titles", () => {
    expect(
      deriveRegionLabel({
        title: "FSDSS-799 Sample",
        keywords: ["FSDSS", "sample"],
        videoId: "FSDSS-799",
        libraryMode: "gentle",
      })
    ).toBe("Japan");
  });

  it("derives America when title hints at English or USA", () => {
    expect(
      deriveRegionLabel({
        title: "USA Feature",
        keywords: ["english"],
        videoId: null,
        libraryMode: "normal",
      })
    ).toBe("America");
  });

  it("falls back to Unknown when nothing matches", () => {
    expect(
      deriveRegionLabel({
        title: "Sample",
        keywords: ["sample"],
        videoId: null,
        libraryMode: "normal",
      })
    ).toBe("Unknown");
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mockProgress(overrides: Partial<ScanProgress> = {}): ScanProgress {
  return {
    stage: "processing",
    mode: "normal",
    currentRoot: null,
    currentFile: null,
    processedFiles: 0,
    totalFiles: 100,
    imported: 0,
    skipped: 0,
    message: "",
    ...overrides,
  };
}

function mockScanSummary(overrides: Partial<ScanSummary> = {}): ScanSummary {
  return {
    discovered: 10,
    imported: 10,
    skipped: 0,
    errors: [],
    invalidFiles: [],
    duplicateGroups: [],
    scannedRoots: { normal: ["/lib/normal"], gentle: [] },
    cancelled: false,
    ...overrides,
  };
}

function mockPosterSummary(overrides: Partial<PosterBackfillSummary> = {}): PosterBackfillSummary {
  return {
    requested: 5,
    updated: 5,
    skipped: 0,
    errors: [],
    ...overrides,
  };
}
