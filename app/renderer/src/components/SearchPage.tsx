import { useEffect, useMemo, useState } from "react";
import type {
  AppPage,
  MovieRecord,
  SubtitleGenerationLanguage,
  SubtitleGenerationModel,
  SubtitleGenerationOutputMode,
  SubtitleGenerationPreview,
  SubtitleGenerationResult,
  SubtitleModelAvailability,
  SubtitleModelDownloadProgress,
  SubtitleModelDownloadResult
} from "../../../shared/contracts";

const SUBGEN_OUTPUT_DIRECTORY_KEY = "mla-subgen-output-directory";
const SUBGEN_OUTPUT_FILENAME_KEY = "mla-subgen-output-filename";

interface SearchPageProps {
  movies: MovieRecord[];
  setSelectedMovieId: (id: string) => void;
  setActivePage: (page: AppPage) => void;
  onSubtitleGenerated: () => Promise<void>;
}

function formatBytes(value: number | null | undefined): string {
  if (!value || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function SearchPage({ movies, setSelectedMovieId, setActivePage, onSubtitleGenerated }: SearchPageProps) {
  const desktopApi = window.desktopApi;
  const [selectedMovieId, setSelectedMovieIdLocal] = useState<string>(movies[0]?.id ?? "");
  const [movieQuery, setMovieQuery] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<"all" | "normal" | "gentle">("all");
  const [subtitleFilter, setSubtitleFilter] = useState<"missing" | "all" | "ready">("missing");
  const [language, setLanguage] = useState<SubtitleGenerationLanguage>("ja");
  const [model, setModel] = useState<SubtitleGenerationModel>("medium");
  const [outputMode, setOutputMode] = useState<SubtitleGenerationOutputMode>("library-default");
  const [outputDirectory, setOutputDirectory] = useState<string>("");
  const [outputFileName, setOutputFileName] = useState<string>("");
  const [outputPreview, setOutputPreview] = useState<SubtitleGenerationPreview>({ outputPath: null, message: null });
  const [status, setStatus] = useState<SubtitleGenerationResult | null>(null);
  const [batchMessage, setBatchMessage] = useState<string>("");
  const [modelAvailability, setModelAvailability] = useState<SubtitleModelAvailability | null>(null);
  const [modelDownloadProgress, setModelDownloadProgress] = useState<SubtitleModelDownloadProgress | null>(null);
  const [modelDownloadResult, setModelDownloadResult] = useState<SubtitleModelDownloadResult | null>(null);
  const [showDownloadPrompt, setShowDownloadPrompt] = useState(false);
  const [dismissedDownloadPromptFor, setDismissedDownloadPromptFor] = useState<SubtitleGenerationModel | null>(null);
  const [isCheckingModel, setIsCheckingModel] = useState(false);
  const [isDownloadingModel, setIsDownloadingModel] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const filteredMovies = useMemo(() => {
    const normalizedQuery = movieQuery.trim().toLowerCase();
    return movies.filter((movie) => {
      if (libraryFilter !== "all" && movie.libraryMode !== libraryFilter) {
        return false;
      }

      const hasSubtitle = movie.subtitles.length > 0;
      if (subtitleFilter === "missing" && hasSubtitle) {
        return false;
      }
      if (subtitleFilter === "ready" && !hasSubtitle) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      const searchHaystack = [
        movie.title,
        movie.videoId ?? "",
        movie.sourcePath,
        movie.libraryMode
      ].join(" ").toLowerCase();

      return searchHaystack.includes(normalizedQuery);
    });
  }, [movies, movieQuery, libraryFilter, subtitleFilter]);
  const selectedMovie = useMemo(
    () => filteredMovies.find((movie) => movie.id === selectedMovieId) ?? filteredMovies[0] ?? null,
    [filteredMovies, selectedMovieId]
  );
  const totalMissingSubtitles = useMemo(
    () => movies.filter((movie) => movie.subtitles.length === 0).length,
    [movies]
  );

  useEffect(() => {
    if (!selectedMovieId && movies[0]?.id) {
      setSelectedMovieIdLocal(movies[0].id);
    }
  }, [movies, selectedMovieId]);

  useEffect(() => {
    if (!selectedMovie) {
      if (selectedMovieId) {
        setSelectedMovieIdLocal("");
      }
      return;
    }

    if (selectedMovie.id !== selectedMovieId) {
      setSelectedMovieIdLocal(selectedMovie.id);
    }
  }, [selectedMovie, selectedMovieId]);

  useEffect(() => {
    const saved = localStorage.getItem(SUBGEN_OUTPUT_DIRECTORY_KEY);
    if (saved) {
      setOutputDirectory(saved);
    }
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(SUBGEN_OUTPUT_FILENAME_KEY);
    if (saved) {
      setOutputFileName(saved);
    }
  }, []);

  useEffect(() => {
    if (outputDirectory.trim()) {
      localStorage.setItem(SUBGEN_OUTPUT_DIRECTORY_KEY, outputDirectory.trim());
      return;
    }

    localStorage.removeItem(SUBGEN_OUTPUT_DIRECTORY_KEY);
  }, [outputDirectory]);

  useEffect(() => {
    if (outputFileName.trim()) {
      localStorage.setItem(SUBGEN_OUTPUT_FILENAME_KEY, outputFileName.trim());
      return;
    }

    localStorage.removeItem(SUBGEN_OUTPUT_FILENAME_KEY);
  }, [outputFileName]);

  useEffect(() => {
    if (!desktopApi) {
      return undefined;
    }

    return desktopApi.onSubtitleModelDownloadProgress((progress) => {
      setModelDownloadProgress(progress);
    });
  }, [desktopApi]);

  useEffect(() => {
    if (!desktopApi) {
      setModelAvailability(null);
      return;
    }

    let cancelled = false;
    setIsCheckingModel(true);
    setModelDownloadResult(null);
    setModelDownloadProgress(null);

    void desktopApi.getSubtitleModelAvailability(model)
      .then((availability) => {
        if (cancelled) {
          return;
        }

        setModelAvailability(availability);
        if (availability.available) {
          setShowDownloadPrompt(false);
          setDismissedDownloadPromptFor(null);
        } else if (dismissedDownloadPromptFor !== model) {
          setShowDownloadPrompt(true);
        }
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        setModelAvailability({
          model,
          available: false,
          modelPath: null,
          message: "Unable to check the selected Whisper model."
        });
        if (dismissedDownloadPromptFor !== model) {
          setShowDownloadPrompt(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsCheckingModel(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [desktopApi, model, dismissedDownloadPromptFor]);

  useEffect(() => {
    if (!desktopApi || !selectedMovie) {
      setOutputPreview({ outputPath: null, message: null });
      return;
    }

    let cancelled = false;
    void desktopApi.previewSubtitleOutput(selectedMovie.id, {
      language,
      model,
      outputMode,
      outputDirectory: outputMode === "custom-directory" ? outputDirectory : null,
      outputFileName: outputMode === "output-srt" ? null : outputFileName
    }).then((preview) => {
      if (!cancelled) {
        setOutputPreview(preview);
      }
    }).catch(() => {
      if (!cancelled) {
        setOutputPreview({
          outputPath: null,
          message: "Unable to preview subtitle output path."
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [desktopApi, selectedMovie, language, model, outputMode, outputDirectory, outputFileName]);

  async function handleDownloadModel(): Promise<void> {
    if (!desktopApi || isDownloadingModel) {
      return;
    }

    setIsDownloadingModel(true);
    setShowDownloadPrompt(true);
    setDismissedDownloadPromptFor(null);
    setModelDownloadProgress({
      model,
      stage: "starting",
      fileName: null,
      filesCompleted: 0,
      totalFiles: 0,
      downloadedBytes: 0,
      totalBytes: null,
      percent: 0,
      message: `Preparing to download ${model}.`
    });
    setModelDownloadResult(null);

    try {
      const result = await desktopApi.downloadSubtitleModel(model);
      setModelDownloadResult(result);
      if (result.ok) {
        setModelAvailability({
          model: result.model,
          available: true,
          modelPath: result.modelPath,
          message: result.message
        });
        setShowDownloadPrompt(false);
      } else {
        setModelAvailability({
          model: result.model,
          available: false,
          modelPath: null,
          message: result.message
        });
        setShowDownloadPrompt(true);
      }
    } finally {
      setIsDownloadingModel(false);
    }
  }

  async function handleGenerate(): Promise<void> {
    if (!desktopApi || !selectedMovie) {
      return;
    }

    if (!modelAvailability?.available) {
      setDismissedDownloadPromptFor(null);
      setShowDownloadPrompt(true);
      return;
    }

    setIsGenerating(true);
    setStatus(null);
    try {
      const result = await desktopApi.generateSubtitleForMovie(selectedMovie.id, {
        language,
        model,
        outputMode,
        outputDirectory: outputMode === "custom-directory" ? outputDirectory : null,
        outputFileName: outputMode === "output-srt" ? null : outputFileName
      });
      setStatus(result);
      if (result.ok) {
        await onSubtitleGenerated();
      }
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleGenerateBatch(): Promise<void> {
    if (!desktopApi || filteredMovies.length === 0) {
      return;
    }

    if (!modelAvailability?.available) {
      setDismissedDownloadPromptFor(null);
      setShowDownloadPrompt(true);
      return;
    }

    setIsGenerating(true);
    setStatus(null);
    setBatchMessage("");
    let successCount = 0;
    let failureCount = 0;

    try {
      for (const movie of filteredMovies) {
        const result = await desktopApi.generateSubtitleForMovie(movie.id, {
          language,
          model,
          outputMode,
          outputDirectory: outputMode === "custom-directory" ? outputDirectory : null,
          outputFileName: outputMode === "output-srt" ? null : outputFileName
        });
        if (result.ok) {
          successCount += 1;
        } else {
          failureCount += 1;
          setStatus(result);
        }
      }
      await onSubtitleGenerated();
      setBatchMessage(`Batch complete. ${successCount} succeeded, ${failureCount} failed.`);
    } finally {
      setIsGenerating(false);
    }
  }

  async function handlePickOutputDirectory(): Promise<void> {
    if (!desktopApi) {
      return;
    }

    const picked = await desktopApi.pickLibraryFolder();
    if (picked) {
      setOutputDirectory(picked);
    }
  }

  const needsCustomDirectory = outputMode === "custom-directory";
  const isModelReady = modelAvailability?.available === true;
  const generationBlocked = (
    (needsCustomDirectory && outputDirectory.trim().length === 0) ||
    isCheckingModel ||
    isDownloadingModel ||
    !isModelReady
  );
  const generationBlockMessage =
    needsCustomDirectory && outputDirectory.trim().length === 0
      ? "Choose an output folder to enable subtitle generation."
      : isCheckingModel
        ? "Checking the selected Whisper model."
        : isDownloadingModel
          ? "Wait for the Whisper model download to finish."
          : !isModelReady
            ? modelAvailability?.message ?? `${model} must be downloaded before subtitle generation starts.`
            : null;

  return (
    <section className="page">
      <div className="panel">
        <p className="eyebrow">Sub-Gen</p>
        <h3>Generate local subtitles with Faster-Whisper</h3>
        <p className="subtle">
          Local subtitle generation for library files. This flow is built for Japanese and Chinese speech transcription. Whisper translation is not being used here for JP to CN conversion.
        </p>
        <div className="home-workflow" style={{ marginBottom: "1rem" }}>
          <span>{movies.length} in library</span>
          <span>{totalMissingSubtitles} need subtitles</span>
          <span>{filteredMovies.length} in current queue</span>
        </div>
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <p className="eyebrow">Library picker</p>
          <h3>Choose which videos to work on</h3>
          <p className="subtle">
            Filter the library first, then generate subtitles for the selected title or batch-run only the visible queue.
          </p>
          <div className="home-status-list">
            <div>
              <strong>Search</strong>
              <span>
                <input
                  type="text"
                  value={movieQuery}
                  onChange={(event) => setMovieQuery(event.target.value)}
                  placeholder="Title, video ID, path"
                />
              </span>
            </div>
            <div>
              <strong>Library</strong>
              <span>
                <select value={libraryFilter} onChange={(event) => setLibraryFilter(event.target.value as "all" | "normal" | "gentle")}>
                  <option value="all">All libraries</option>
                  <option value="normal">Normal only</option>
                  <option value="gentle">Gentle only</option>
                </select>
              </span>
            </div>
            <div>
              <strong>Subtitle status</strong>
              <span>
                <select value={subtitleFilter} onChange={(event) => setSubtitleFilter(event.target.value as "missing" | "all" | "ready")}>
                  <option value="missing">Missing subtitles</option>
                  <option value="all">All videos</option>
                  <option value="ready">Already has subtitles</option>
                </select>
              </span>
            </div>
            <div>
              <strong>Queue</strong>
              <span>
                {filteredMovies.length === 0
                  ? "No matching videos."
                  : filteredMovies.length === 1
                    ? "1 video ready."
                    : `${filteredMovies.length} videos ready.`}
              </span>
            </div>
          </div>
        </div>
        <div className="home-status-list" style={{ marginBottom: "1rem" }}>
          <div>
            <strong>Model</strong>
            <span>
              <select disabled={isDownloadingModel} value={model} onChange={(event) => setModel(event.target.value as SubtitleGenerationModel)}>
                <option value="small">Fast preview (small)</option>
                <option value="medium">Balanced (medium)</option>
                <option value="large-v3">Best accuracy (large-v3)</option>
              </select>
            </span>
          </div>
          <div>
            <strong>Language</strong>
            <span>
              <select value={language} onChange={(event) => setLanguage(event.target.value as SubtitleGenerationLanguage)}>
                <option value="auto">Auto detect</option>
                <option value="ja">Japanese</option>
                <option value="zh">Chinese</option>
              </select>
            </span>
          </div>
          <div>
            <strong>Output</strong>
            <span>
              <select value={outputMode} onChange={(event) => setOutputMode(event.target.value as SubtitleGenerationOutputMode)}>
                <option value="library-default">Library naming</option>
                <option value="output-srt">output.srt</option>
                <option value="custom-directory">Choose folder</option>
              </select>
            </span>
          </div>
          <div>
            <strong>Profile</strong>
            <span>
              {model === "small"
                ? "Fastest local preview, lower accuracy."
                : model === "medium"
                  ? "Balanced speed and accuracy."
                  : "Slowest local run, highest accuracy."}
            </span>
          </div>
          <div>
            <strong>Model status</strong>
            <span>
              {isCheckingModel
                ? "Checking availability..."
                : isDownloadingModel
                  ? `Downloading ${modelDownloadProgress?.percent ?? 0}%`
                  : isModelReady
                    ? "Downloaded and ready."
                    : modelAvailability?.message ?? "Download required."}
            </span>
          </div>
        </div>
        {!isModelReady && !isCheckingModel && (
          <div className="panel" style={{ marginBottom: "1rem" }}>
            <p className="eyebrow">Whisper model</p>
            <h3>Download required</h3>
            <p className="subtle">
              {modelAvailability?.message ?? `${model} is not downloaded yet.`} The app only downloads each model once, the first time you choose it.
            </p>
            <div className="inline-actions">
              <button
                className="primary-button"
                onClick={() => {
                  setDismissedDownloadPromptFor(null);
                  setShowDownloadPrompt(true);
                }}
                type="button"
              >
                Download {model}
              </button>
            </div>
          </div>
        )}
        {needsCustomDirectory && (
          <div className="panel" style={{ marginBottom: "1rem" }}>
            <p className="eyebrow">Output folder</p>
            <h3>Choose where generated `.srt` files go</h3>
            <p className="subtle">
              Generated subtitles will use the normal library naming format, but be written into the folder you choose.
            </p>
            <div className="inline-actions" style={{ marginBottom: "0.75rem" }}>
              <button className="ghost-button" onClick={() => void handlePickOutputDirectory()} type="button">
                {outputDirectory ? "Change folder" : "Choose folder"}
              </button>
              {outputDirectory && (
                <button className="ghost-button" onClick={() => setOutputDirectory("")} type="button">
                  Clear
                </button>
              )}
            </div>
            <p className="subtle">
              {outputDirectory || "No folder selected yet."}
            </p>
          </div>
        )}
        {outputMode !== "output-srt" && (
          <div className="panel" style={{ marginBottom: "1rem" }}>
            <p className="eyebrow">Filename override</p>
            <h3>Optional custom subtitle file name</h3>
            <p className="subtle">
              Leave blank to use the app&apos;s normal subtitle naming. If you set a name, the app will force a safe `.srt` file name.
            </p>
            <div className="home-status-list">
              <div>
                <strong>File name</strong>
                <span>
                  <input
                    type="text"
                    value={outputFileName}
                    onChange={(event) => setOutputFileName(event.target.value)}
                    placeholder="example-subtitle.srt"
                  />
                </span>
              </div>
            </div>
          </div>
        )}
        <div className="panel" style={{ marginBottom: "1rem" }}>
          <p className="eyebrow">Output preview</p>
          <h3>Final subtitle path</h3>
          <p className="subtle">
            {outputPreview.outputPath ?? outputPreview.message ?? "Choose a movie to preview the final subtitle path."}
          </p>
        </div>
        {modelDownloadProgress && isDownloadingModel && (
          <div className="panel" style={{ marginBottom: "1rem" }}>
            <p className="eyebrow">Model download</p>
            <h3>{modelDownloadProgress.message}</h3>
            <div className="progress-track" style={{ marginBottom: "0.75rem" }}>
              <div className="progress-fill" style={{ width: `${modelDownloadProgress.percent}%` }} />
            </div>
            <div className="home-status-list" style={{ marginTop: 0 }}>
              <div>
                <strong>Progress</strong>
                <span>{modelDownloadProgress.percent}%</span>
              </div>
              <div>
                <strong>Current file</strong>
                <span>{modelDownloadProgress.fileName ?? "Preparing download..."}</span>
              </div>
              <div>
                <strong>Transferred</strong>
                <span>
                  {formatBytes(modelDownloadProgress.downloadedBytes)}
                  {modelDownloadProgress.totalBytes ? ` / ${formatBytes(modelDownloadProgress.totalBytes)}` : ""}
                </span>
              </div>
            </div>
          </div>
        )}
        <div className="inline-actions" style={{ marginBottom: "1rem" }}>
          <button className="primary-button" disabled={!selectedMovie || isGenerating || generationBlocked} onClick={() => void handleGenerate()} type="button">
            {isGenerating ? "Generating subtitles..." : "Generate subtitle"}
          </button>
          <button className="ghost-button" disabled={filteredMovies.length === 0 || isGenerating || generationBlocked} onClick={() => void handleGenerateBatch()} type="button">
            {isGenerating ? "Running batch..." : `Batch generate queue (${filteredMovies.length})`}
          </button>
          {selectedMovie && (
            <button
              className="ghost-button"
              onClick={() => {
                setSelectedMovieId(selectedMovie.id);
                setActivePage("library");
              }}
              type="button"
            >
              Open in library
            </button>
          )}
        </div>
        {generationBlockMessage && (
          <p className="subtle" style={{ marginBottom: "1rem" }}>
            {generationBlockMessage}
          </p>
        )}
        {status && (
          <div className="panel" style={{ marginBottom: "1rem" }}>
            <p className="eyebrow">Generator status</p>
            <h3>{status.ok ? "Subtitle created" : "Generation blocked"}</h3>
            <p className="subtle">{status.message}</p>
            {status.detectedLanguage && (
              <p className="subtle">Detected language: {status.detectedLanguage}</p>
            )}
            {status.subtitlePath && (
              <div className="inline-actions">
                <button className="ghost-button" onClick={() => void desktopApi?.showInFolder(status.subtitlePath!)} type="button">
                  Show subtitle file
                </button>
              </div>
            )}
          </div>
        )}
        {modelDownloadResult && !modelDownloadResult.ok && !isDownloadingModel && (
          <div className="panel" style={{ marginBottom: "1rem" }}>
            <p className="eyebrow">Download status</p>
            <h3>Model download failed</h3>
            <p className="subtle">{modelDownloadResult.message}</p>
          </div>
        )}
        {batchMessage && (
          <div className="panel" style={{ marginBottom: "1rem" }}>
            <p className="eyebrow">Batch status</p>
            <h3>Batch subtitle generation</h3>
            <p className="subtle">{batchMessage}</p>
          </div>
        )}
        <div className="search-results">
          {filteredMovies.length === 0 && (
            <div className="panel">
              <p className="eyebrow">Library queue</p>
              <h3>No matching videos</h3>
              <p className="subtle">
                Change the library or subtitle filters to see more titles.
              </p>
            </div>
          )}
          {filteredMovies.map((movie) => {
            const hasSubtitle = movie.subtitles.length > 0;
            return (
              <button
                className={`search-result${movie.id === selectedMovieId ? " active" : ""}`}
                key={movie.id}
                onClick={() => {
                  setSelectedMovieIdLocal(movie.id);
                }}
                type="button"
              >
                <strong>{movie.title}</strong>
                <span>
                  {movie.videoId ? `${movie.videoId} - ` : ""}
                  {movie.libraryMode} - {movie.sourcePath}
                </span>
                <div className="inline-actions">
                  <span className={`subtitle-badge${hasSubtitle ? "" : " warning-text"}`}>
                    {hasSubtitle
                      ? `${movie.subtitles.length} subtitle${movie.subtitles.length !== 1 ? "s" : ""}`
                      : "No subtitles yet"}
                  </span>
                  <span className={`mode-pill ${movie.libraryMode === "normal" ? "mode-pill-normal" : "mode-pill-gentle"}`}>
                    {movie.libraryMode}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
      {showDownloadPrompt && !isModelReady && (
        <div className="modal-backdrop">
          <div className="modal-card">
            <p className="eyebrow">Whisper download</p>
            <h3>{isDownloadingModel ? `Downloading ${model}` : `${model} is not installed yet`}</h3>
            <p className="subtle">
              {isDownloadingModel
                ? modelDownloadProgress?.message ?? `Downloading ${model}.`
                : `Download ${model} now? The app only downloads each Whisper model the first time you choose it.`}
            </p>
            {modelDownloadProgress && (
              <>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${modelDownloadProgress.percent}%` }} />
                </div>
                <div className="home-status-list" style={{ marginTop: 0 }}>
                  <div>
                    <strong>Progress</strong>
                    <span>{modelDownloadProgress.percent}%</span>
                  </div>
                  <div>
                    <strong>Current file</strong>
                    <span>{modelDownloadProgress.fileName ?? "Preparing download..."}</span>
                  </div>
                  <div>
                    <strong>Transferred</strong>
                    <span>
                      {formatBytes(modelDownloadProgress.downloadedBytes)}
                      {modelDownloadProgress.totalBytes ? ` / ${formatBytes(modelDownloadProgress.totalBytes)}` : ""}
                    </span>
                  </div>
                </div>
              </>
            )}
            {modelDownloadResult && !modelDownloadResult.ok && (
              <p className="subtle">{modelDownloadResult.message}</p>
            )}
            <div className="inline-actions" style={{ justifyContent: "flex-end" }}>
              <button className="primary-button" disabled={isDownloadingModel} onClick={() => void handleDownloadModel()} type="button">
                {isDownloadingModel ? "Downloading..." : `Download ${model}`}
              </button>
              <button
                className="ghost-button"
                disabled={isDownloadingModel}
                onClick={() => {
                  setDismissedDownloadPromptFor(model);
                  setShowDownloadPrompt(false);
                }}
                type="button"
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
