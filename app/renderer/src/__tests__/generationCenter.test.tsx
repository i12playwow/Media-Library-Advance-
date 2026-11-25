import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GenerationCenter } from "../components/GenerationCenter";
import type { MediaProcessingQueueState, MovieRecord } from "../../../shared/contracts";

// happy-dom exposes no localStorage here; the centre persists its form.
const storage = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, String(value)); },
    removeItem: (key: string) => { storage.delete(key); }
  }
});

const emptyQueue: MediaProcessingQueueState = { jobs: [], running: false };

function makeMovie(id: string, overrides: Partial<MovieRecord> = {}): MovieRecord {
  return {
    id,
    title: `Movie ${id}`,
    displayName: null,
    year: 2024,
    videoId: `VID-${id}`,
    sourcePath: `C:/library/normal/${id}.mp4`,
    folderPath: "C:/library/normal",
    libraryMode: "normal",
    resolution: "1080p",
    posterUrl: null,
    posterSource: "none",
    actresses: [],
    keywords: [],
    subtitles: [],
    updatedAt: new Date().toISOString(),
    ...overrides
  };
}

function installApi(overrides: Record<string, unknown> = {}) {
  const api = {
    getSubtitleModelAvailability: async (model: string) => ({ model, available: true, modelPath: `C:/models/${model}`, message: null }),
    downloadSubtitleModel: vi.fn(),
    onSubtitleModelDownloadProgress: () => () => {},
    previewSubtitleOutput: async () => ({ outputPath: "C:/library/normal/movie.srt", message: null }),
    pickLibraryFolder: async () => "C:/subs",
    processingEnqueueSubtitle: vi.fn(async () => ({ queue: emptyQueue, jobId: "job-1" })),
    processingCancelJob: vi.fn(async () => emptyQueue),
    processingRetryJob: vi.fn(async () => emptyQueue),
    processingRemoveJob: vi.fn(async () => emptyQueue),
    processingClearFinished: vi.fn(async () => emptyQueue),
    ...overrides
  };
  (window as unknown as { desktopApi: unknown }).desktopApi = api;
  return api;
}

function renderCenter(movies: MovieRecord[], queue: MediaProcessingQueueState = emptyQueue) {
  return render(
    <GenerationCenter
      movies={movies}
      processingQueue={queue}
      setSelectedMovieId={() => {}}
      setActivePage={() => {}}
      onSubtitleGenerated={async () => {}}
    />
  );
}

afterEach(() => {
  delete (window as unknown as { desktopApi?: unknown }).desktopApi;
  storage.clear();
});

describe("GenerationCenter", () => {
  it("queues every title in the filter when nothing is selected", async () => {
    const api = installApi();
    renderCenter([makeMovie("a"), makeMovie("b")]);
    await screen.findByText("2 in this filter");

    fireEvent.click(screen.getByRole("button", { name: /Queue all 2 in this filter/ }));

    await waitFor(() => expect(api.processingEnqueueSubtitle).toHaveBeenCalledTimes(2));
    expect(api.processingEnqueueSubtitle.mock.calls[0][1]).toEqual({
      language: "ja",
      model: "medium",
      outputMode: "library-default",
      outputDirectory: null,
      outputFileName: null
    });
    await screen.findByText(/2 subtitle jobs queued/);
  });

  it("only queues the titles the operator ticked", async () => {
    const api = installApi();
    renderCenter([makeMovie("a"), makeMovie("b")]);

    fireEvent.click(await screen.findByText("Movie b"));
    fireEvent.click(screen.getByRole("button", { name: "Queue 1 selected" }));

    await waitFor(() => expect(api.processingEnqueueSubtitle).toHaveBeenCalledTimes(1));
    expect(api.processingEnqueueSubtitle.mock.calls[0][0]).toBe("b");
  });

  it("blocks queuing until the selected Whisper model is downloaded", async () => {
    const api = installApi({
      getSubtitleModelAvailability: async (model: string) => ({ model, available: false, modelPath: null, message: `${model} is not downloaded yet.` }),
      downloadSubtitleModel: vi.fn(async () => ({ ok: true, model: "medium", available: true, modelPath: "C:/models/medium", message: "Ready", setupRequired: false }))
    });
    renderCenter([makeMovie("a")]);

    const queueButton = await screen.findByRole("button", { name: /Queue all 1 in this filter/ });
    expect((queueButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText("medium is not downloaded yet.").length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Download medium" }));
    });
    await waitFor(() => expect((screen.getByRole("button", { name: /Queue all 1 in this filter/ }) as HTMLButtonElement).disabled).toBe(false));
    expect(api.processingEnqueueSubtitle).not.toHaveBeenCalled();
  });

  it("shows queued, running and finished jobs with retry and remove actions", async () => {
    const api = installApi();
    const now = new Date().toISOString();
    const queue: MediaProcessingQueueState = {
      running: true,
      jobs: [
        { id: "run", movieId: "a", movieTitle: "Running title", kind: "generate-subtitle", status: "running", progress: 42, message: "Transcribing", error: null, createdAt: now, updatedAt: now },
        { id: "bad", movieId: "b", movieTitle: "Broken title", kind: "generate-subtitle", status: "failed", progress: 100, message: "Processing failed", error: "Whisper crashed", createdAt: now, updatedAt: now },
        { id: "done", movieId: "c", movieTitle: "Finished title", kind: "generate-subtitle", status: "completed", progress: 100, message: "Subtitle created · medium · Japanese", error: null, createdAt: now, updatedAt: now }
      ]
    };
    renderCenter([makeMovie("a"), makeMovie("b"), makeMovie("c")], queue);

    expect((await screen.findAllByText("Running title")).length).toBeGreaterThan(0);
    expect(screen.getByText("1 waiting")).toBeTruthy();
    expect(screen.getAllByText("Whisper crashed").length).toBeGreaterThan(0);

    // Two cancel buttons: the running card and the queue row for the same job.
    fireEvent.click(screen.getAllByRole("button", { name: "Cancel" })[0]);
    await waitFor(() => expect(api.processingCancelJob).toHaveBeenCalledWith("run"));

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(api.processingRetryJob).toHaveBeenCalledWith("bad"));

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    await waitFor(() => expect(api.processingClearFinished).toHaveBeenCalledTimes(1));
  });
});
