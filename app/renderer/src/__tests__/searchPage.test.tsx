import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchPage } from "../components/SearchPage";
import type { MovieRecord, SubtitleGenerationResult } from "../../../shared/contracts";

// happy-dom on Node 26 exposes no localStorage unless --localstorage-file is
// passed, and SearchPage reads it on mount.
const storage = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, String(value));
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    }
  }
});

async function clickModalDownloadButton(): Promise<void> {
  // The "Download required" panel button only opens the prompt modal; the
  // modal's own button is the one that runs handleDownloadModel.
  const card = await waitFor(() => {
    const found = document.querySelector(".modal-card");
    if (!found) {
      throw new Error("modal card not rendered yet");
    }
    return found as HTMLElement;
  });
  await act(async () => {
    fireEvent.click(within(card).getByRole("button", { name: "Download medium" }));
  });
}

function makeMovie(): MovieRecord {
  return {
    id: "test-id",
    title: "Test Movie",
    videoId: "TEST-001",
    year: 2023,
    resolution: "1080p",
    posterUrl: "https://example.com/poster.jpg",
    posterSource: "web",
    sourcePath: "C:/library/normal/test.mp4",
    folderPath: "C:/library/normal",
    libraryMode: "normal",
    actresses: [],
    keywords: [],
    subtitles: [],
    updatedAt: new Date().toISOString(),
  };
}

function renderSearchPage() {
  return render(
    <SearchPage
      movies={[makeMovie()]}
      setSelectedMovieId={() => {}}
      setActivePage={() => {}}
      onSubtitleGenerated={async () => {}}
    />
  );
}

afterEach(() => {
  delete (window as unknown as { desktopApi?: unknown }).desktopApi;
});

describe("SearchPage — download-again skips straight to generation", () => {
  it("re-checks availability on Download click and generates directly when the model is already on disk", async () => {
    const movie = makeMovie();
    let availabilityChecks = 0;
    const downloadSubtitleModel = vi.fn();
    const generateSubtitleForMovie = vi.fn(
      async (_movieId: string, _options: unknown): Promise<SubtitleGenerationResult> => ({
        ok: true,
        message: "Subtitle created.",
        subtitlePath: "C:/library/normal/test.srt",
        detectedLanguage: "ja",
        setupRequired: false
      })
    );

    (window as unknown as { desktopApi: unknown }).desktopApi = {
      // Mount check reports a stale "missing" snapshot; the re-check that runs
      // when Download is clicked finds the model already on disk.
      getSubtitleModelAvailability: async () => {
        availabilityChecks += 1;
        const available = availabilityChecks > 1;
        return {
          model: "medium",
          available,
          modelPath: available ? "C:/models/medium" : null,
          message: available ? null : "medium is not downloaded yet."
        };
      },
      onSubtitleModelDownloadProgress: () => () => {},
      previewSubtitleOutput: async () => ({ outputPath: null, message: null }),
      downloadSubtitleModel,
      generateSubtitleForMovie
    };

    renderSearchPage();
    await act(async () => {}); // flush the mount-time availability check inside act

    await clickModalDownloadButton();

    await waitFor(() => expect(generateSubtitleForMovie).toHaveBeenCalledTimes(1));
    expect(generateSubtitleForMovie.mock.calls[0][0]).toBe(movie.id);
    expect(downloadSubtitleModel).not.toHaveBeenCalled();
    expect(availabilityChecks).toBe(2);

    // The flow finishes like any other generate run.
    await screen.findByText("Subtitle created");
  });

  it("still runs a real download when the model is genuinely missing, without generating", async () => {
    let availabilityChecks = 0;
    const downloadSubtitleModel = vi.fn(async () => ({
      ok: true,
      model: "medium" as const,
      available: true,
      modelPath: "C:/models/medium",
      message: "medium is ready for subtitle generation.",
      setupRequired: false
    }));
    const generateSubtitleForMovie = vi.fn();

    (window as unknown as { desktopApi: unknown }).desktopApi = {
      getSubtitleModelAvailability: async () => {
        availabilityChecks += 1;
        return {
          model: "medium",
          available: false,
          modelPath: null,
          message: "medium is not downloaded yet."
        };
      },
      onSubtitleModelDownloadProgress: () => () => {},
      previewSubtitleOutput: async () => ({ outputPath: null, message: null }),
      downloadSubtitleModel,
      generateSubtitleForMovie
    };

    renderSearchPage();
    await act(async () => {}); // flush the mount-time availability check inside act

    await clickModalDownloadButton();

    await waitFor(() => expect(downloadSubtitleModel).toHaveBeenCalledTimes(1));
    expect(generateSubtitleForMovie).not.toHaveBeenCalled();

    // Model now reports ready: prompt and panel both close.
    await waitFor(() =>
      expect(screen.queryAllByRole("button", { name: "Download medium" })).toHaveLength(0)
    );
    expect(availabilityChecks).toBeGreaterThanOrEqual(1);
  });
});
