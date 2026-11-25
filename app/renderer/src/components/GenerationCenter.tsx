import { useEffect, useMemo, useRef, useState } from "react";
import type {
  MediaProcessingJob,
  MediaProcessingQueueState,
  MovieRecord,
  SubtitleGenerationLanguage,
  SubtitleGenerationModel,
  SubtitleGenerationOutputMode,
  SubtitleGenerationPreview,
  SubtitleModelAvailability,
  SubtitleModelDownloadProgress,
  SubtitleModelDownloadResult,
  SubtitleQueueOptions
} from "../../../shared/contracts";

const OUTPUT_DIRECTORY_KEY = "mla-subgen-output-directory";
const OUTPUT_FILENAME_KEY = "mla-subgen-output-filename";
const LANGUAGE_KEY = "mla-subgen-language";
const MODEL_KEY = "mla-subgen-model";
const OUTPUT_MODE_KEY = "mla-subgen-output-mode";

type Tone = "ok" | "warn" | "error" | "info";

interface GenerationCenterProps {
  gentleUnlocked?: boolean;
  movies: MovieRecord[];
  /** Live queue pushed from the main process (processing:changed). */
  processingQueue: MediaProcessingQueueState;
  setSelectedMovieId: (id: string) => void;
  setActivePage: (page: "library") => void;
  onSubtitleGenerated: () => Promise<void> | void;
}

const LANGUAGES: Array<{ value: SubtitleGenerationLanguage; label: string }> = [
  { value: "ja", label: "Japanese" },
  { value: "auto", label: "Auto detect" },
  { value: "zh", label: "Chinese" }
];

const MODELS: Array<{ value: SubtitleGenerationModel; label: string; note: string }> = [
  { value: "small", label: "Small", note: "Fast preview" },
  { value: "medium", label: "Medium", note: "Balanced" },
  { value: "large-v3", label: "Large v3", note: "Best accuracy" }
];

const OUTPUT_MODES: Array<{ value: SubtitleGenerationOutputMode; label: string }> = [
  { value: "library-default", label: "Next to the video" },
  { value: "output-srt", label: "output.srt" },
  { value: "custom-directory", label: "Custom folder" }
];

function readStored<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const value = localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string): void {
  try {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // storage is optional — the form still works without it
  }
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

function languageLabel(language: string): string {
  return LANGUAGES.find((entry) => entry.value === language)?.label ?? language;
}

function timeAgo(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) {
    return "";
  }
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

function statusLabel(job: MediaProcessingJob): string {
  switch (job.status) {
    case "queued": return "Queued";
    case "running": return `Generating · ${Math.round(job.progress)}%`;
    case "completed": return "Subtitle ready";
    case "failed": return "Failed";
    case "cancelled": return "Cancelled";
    default: return job.status;
  }
}

export function GenerationCenter({
  gentleUnlocked = false,
  movies,
  processingQueue,
  setSelectedMovieId,
  setActivePage,
  onSubtitleGenerated
}: GenerationCenterProps) {
  const desktopApi = window.desktopApi;

  // ── Form state (persisted between sessions) ───────────────────────────────
  const [mode, setMode] = useState<"normal" | "gentle">("normal");
  const [query, setQuery] = useState("");
  const [subtitleFilter, setSubtitleFilter] = useState<"missing" | "all" | "ready">("missing");
  const [language, setLanguage] = useState<SubtitleGenerationLanguage>(() => readStored(LANGUAGE_KEY, "ja", ["ja", "auto", "zh"] as const));
  const [model, setModel] = useState<SubtitleGenerationModel>(() => readStored(MODEL_KEY, "medium", ["small", "medium", "large-v3"] as const));
  const [outputMode, setOutputMode] = useState<SubtitleGenerationOutputMode>(() => readStored(OUTPUT_MODE_KEY, "library-default", ["library-default", "output-srt", "custom-directory"] as const));
  const [outputDirectory, setOutputDirectory] = useState<string>(() => {
    try { return localStorage.getItem(OUTPUT_DIRECTORY_KEY) ?? ""; } catch { return ""; }
  });
  const [outputFileName, setOutputFileName] = useState<string>(() => {
    try { return localStorage.getItem(OUTPUT_FILENAME_KEY) ?? ""; } catch { return ""; }
  });

  useEffect(() => { writeStored(LANGUAGE_KEY, language); }, [language]);
  useEffect(() => { writeStored(MODEL_KEY, model); }, [model]);
  useEffect(() => { writeStored(OUTPUT_MODE_KEY, outputMode); }, [outputMode]);
  useEffect(() => { writeStored(OUTPUT_DIRECTORY_KEY, outputDirectory.trim()); }, [outputDirectory]);
  useEffect(() => { writeStored(OUTPUT_FILENAME_KEY, outputFileName.trim()); }, [outputFileName]);

  // ── Model availability ────────────────────────────────────────────────────
  const [availability, setAvailability] = useState<SubtitleModelAvailability | null>(null);
  const [checkingModel, setCheckingModel] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<SubtitleModelDownloadProgress | null>(null);
  const [downloadResult, setDownloadResult] = useState<SubtitleModelDownloadResult | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!desktopApi?.onSubtitleModelDownloadProgress) {
      return undefined;
    }
    return desktopApi.onSubtitleModelDownloadProgress(setDownloadProgress);
  }, [desktopApi]);

  useEffect(() => {
    if (!desktopApi?.getSubtitleModelAvailability) {
      return undefined;
    }
    let cancelled = false;
    setCheckingModel(true);
    setDownloadResult(null);
    void desktopApi.getSubtitleModelAvailability(model)
      .then((result) => { if (!cancelled) setAvailability(result); })
      .catch(() => {
        if (!cancelled) {
          setAvailability({ model, available: false, modelPath: null, message: "Unable to check the selected Whisper model." });
        }
      })
      .finally(() => { if (!cancelled) setCheckingModel(false); });
    return () => { cancelled = true; };
  }, [desktopApi, model]);

  async function handleDownloadModel(): Promise<void> {
    if (!desktopApi?.downloadSubtitleModel || downloading || checkingModel) {
      return;
    }
    setDownloading(true);
    setDownloadResult(null);
    setDownloadProgress({
      model, stage: "starting", fileName: null, filesCompleted: 0, totalFiles: 0,
      downloadedBytes: 0, totalBytes: null, percent: 0, message: `Preparing to download ${model}.`
    });
    try {
      const result = await desktopApi.downloadSubtitleModel(model);
      setDownloadResult(result);
      setAvailability({ model: result.model, available: result.available, modelPath: result.modelPath, message: result.ok ? result.message : result.message });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAvailability({ model, available: false, modelPath: null, message });
      setDownloadResult({ ok: false, model, available: false, modelPath: null, message, setupRequired: false });
    } finally {
      setDownloading(false);
    }
  }

  // ── Library selection ─────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const scopedMovies = useMemo(
    () => movies.filter((movie) => movie.libraryMode === mode && (mode === "normal" || gentleUnlocked)),
    [movies, mode, gentleUnlocked]
  );

  const filteredMovies = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return scopedMovies.filter((movie) => {
      const hasSubtitle = movie.subtitles.length > 0;
      if (subtitleFilter === "missing" && hasSubtitle) return false;
      if (subtitleFilter === "ready" && !hasSubtitle) return false;
      if (!needle) return true;
      return [movie.title, movie.videoId ?? "", movie.sourcePath, movie.displayName ?? ""]
        .join(" ").toLowerCase().includes(needle);
    });
  }, [scopedMovies, query, subtitleFilter]);

  // Selections only survive while they remain visible in the current filter.
  const visibleSelected = useMemo(() => {
    const visible = new Set(filteredMovies.map((movie) => movie.id));
    return selectedIds.filter((id) => visible.has(id));
  }, [selectedIds, filteredMovies]);

  useEffect(() => {
    if (!gentleUnlocked && mode === "gentle") {
      setMode("normal");
    }
  }, [gentleUnlocked, mode]);

  const allVisibleSelected = filteredMovies.length > 0 && visibleSelected.length === filteredMovies.length;

  function toggleSelection(movieId: string): void {
    setSelectedIds((current) => current.includes(movieId)
      ? current.filter((id) => id !== movieId)
      : [...current, movieId]);
  }

  function toggleAllVisible(): void {
    setSelectedIds(allVisibleSelected ? [] : filteredMovies.map((movie) => movie.id));
  }

  // ── Queue ─────────────────────────────────────────────────────────────────
  const jobs = processingQueue.jobs;
  const subtitleJobs = useMemo(() => jobs.filter((job) => job.kind === "generate-subtitle"), [jobs]);
  const activeJobs = useMemo(
    () => subtitleJobs.filter((job) => job.status === "running" || job.status === "queued"),
    [subtitleJobs]
  );
  const historyJobs = useMemo(
    () => subtitleJobs.filter((job) => job.status !== "running" && job.status !== "queued"),
    [subtitleJobs]
  );
  const completedCount = subtitleJobs.filter((job) => job.status === "completed").length;
  const failedCount = subtitleJobs.filter((job) => job.status === "failed").length;
  const cancelledCount = subtitleJobs.filter((job) => job.status === "cancelled").length;
  const runningJob = jobs.find((job) => job.status === "running") ?? null;
  const [actionMessage, setActionMessage] = useState<{ tone: Tone; text: string } | null>(null);

  // Only the newest completion matters: refresh the library so the Sub-Gen
  // page and tiles pick up the freshly written .srt file.
  useEffect(() => {
    if (completedCount > 0) {
      void onSubtitleGenerated();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedCount]);

  const settings: SubtitleQueueOptions = useMemo(() => ({
    language,
    model,
    outputMode,
    outputDirectory: outputMode === "custom-directory" ? outputDirectory.trim() || null : null,
    outputFileName: outputMode === "output-srt" ? null : outputFileName.trim() || null
  }), [language, model, outputMode, outputDirectory, outputFileName]);

  const [preview, setPreview] = useState<SubtitleGenerationPreview>({ outputPath: null, message: null });
  const previewTargetId = filteredMovies.find((movie) => visibleSelected.includes(movie.id))?.id ?? filteredMovies[0]?.id ?? null;

  useEffect(() => {
    if (!desktopApi?.previewSubtitleOutput || !previewTargetId) {
      setPreview({ outputPath: null, message: null });
      return undefined;
    }
    let cancelled = false;
    void desktopApi.previewSubtitleOutput(previewTargetId, settings)
      .then((value) => { if (!cancelled) setPreview(value); })
      .catch(() => { if (!cancelled) setPreview({ outputPath: null, message: "Unable to preview subtitle output path." }); });
    return () => { cancelled = true; };
  }, [desktopApi, previewTargetId, settings]);

  const [submitting, setSubmitting] = useState(false);
  const lastQueuedRef = useRef<string | null>(null);

  async function enqueue(ids: string[]): Promise<void> {
    if (!desktopApi?.processingEnqueueSubtitle || ids.length === 0 || submitting) {
      return;
    }
    setSubmitting(true);
    setActionMessage(null);
    let queued = 0;
    let already = 0;
    try {
      for (const movieId of ids) {
        const result = await desktopApi.processingEnqueueSubtitle(movieId, settings);
        if (result.jobId) {
          queued += 1;
          lastQueuedRef.current = result.jobId;
        } else {
          already += 1;
        }
      }
      setActionMessage({
        tone: queued > 0 ? "ok" : "warn",
        text: queued > 0
          ? `${queued} subtitle job${queued === 1 ? "" : "s"} queued${already ? ` · ${already} already in the queue` : ""}.`
          : "Those titles already have a subtitle job in the queue."
      });
      setSelectedIds([]);
    } catch (error) {
      setActionMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not queue the subtitle jobs." });
    } finally {
      setSubmitting(false);
    }
  }

  async function runJobAction(action: "cancel" | "retry" | "remove", jobId: string): Promise<void> {
    if (!desktopApi) return;
    try {
      if (action === "cancel") await desktopApi.processingCancelJob(jobId);
      if (action === "retry") await desktopApi.processingRetryJob(jobId);
      if (action === "remove") await desktopApi.processingRemoveJob(jobId);
    } catch (error) {
      setActionMessage({ tone: "error", text: error instanceof Error ? error.message : "Queue action failed." });
    }
  }

  async function clearFinished(): Promise<void> {
    if (!desktopApi?.processingClearFinished) return;
    try {
      await desktopApi.processingClearFinished();
    } catch (error) {
      setActionMessage({ tone: "error", text: error instanceof Error ? error.message : "Could not clear the history." });
    }
  }

  // ── Derived UI state ──────────────────────────────────────────────────────
  const modelReady = availability?.available === true;
  const needsFolder = outputMode === "custom-directory" && outputDirectory.trim().length === 0;
  const blockReason = needsFolder
    ? "Choose an output folder below before queuing."
    : checkingModel
      ? "Checking the selected Whisper model…"
      : downloading
        ? "Wait for the Whisper model download to finish."
        : !modelReady
          ? availability?.message ?? `${model} is not downloaded yet.`
          : null;
  const queueCount = filteredMovies.length;
  const totalMissing = scopedMovies.filter((movie) => movie.subtitles.length === 0).length;
  const percent = runningJob && runningJob.kind === "generate-subtitle" ? Math.max(2, Math.min(100, runningJob.progress)) : 0;

  return (
    <section className="page generation-center">
      <header className="gen-hero panel">
        <div>
          <p className="eyebrow">Generation Center</p>
          <h3>Queue, monitor and finish subtitles from one place.</h3>
          <p className="subtle">
            Pick the titles once, choose how Whisper should run, and the centre keeps working through the queue
            while you browse. Every job reports its own state — cancel, retry or clear it below.
          </p>
        </div>
        <dl className="gen-metrics">
          <div><dt>In library</dt><dd>{scopedMovies.length}</dd></div>
          <div><dt>Missing</dt><dd>{totalMissing}</dd></div>
          <div><dt>Completed</dt><dd>{completedCount}</dd></div>
          <div><dt>Failed</dt><dd className={failedCount ? "is-bad" : undefined}>{failedCount}</dd></div>
        </dl>
      </header>

      <div className="gen-layout">
        <div className="gen-column">
          {/* 1 — Settings */}
          <section className="panel gen-card">
            <div className="gen-card-head">
              <div><p className="eyebrow">Step 1</p><h3>Generation settings</h3></div>
              <span className={`gen-pill ${modelReady ? "ok" : "warn"}`}>{modelReady ? `${model} ready` : `${model} missing`}</span>
            </div>
            <div className="gen-field-grid">
              <label className="gen-field">
                <span>Model</span>
                <select value={model} disabled={downloading} onChange={(event) => setModel(event.target.value as SubtitleGenerationModel)}>
                  {MODELS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label} — {entry.note}</option>)}
                </select>
              </label>
              <label className="gen-field">
                <span>Spoken language</span>
                <select value={language} onChange={(event) => setLanguage(event.target.value as SubtitleGenerationLanguage)}>
                  {LANGUAGES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                </select>
              </label>
              <label className="gen-field">
                <span>Write the .srt</span>
                <select value={outputMode} onChange={(event) => setOutputMode(event.target.value as SubtitleGenerationOutputMode)}>
                  {OUTPUT_MODES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
                </select>
              </label>
              {outputMode !== "output-srt" && (
                <label className="gen-field">
                  <span>File name override</span>
                  <input
                    type="text"
                    value={outputFileName}
                    onChange={(event) => setOutputFileName(event.target.value)}
                    placeholder="Leave blank for library naming"
                  />
                </label>
              )}
            </div>

            {outputMode === "custom-directory" && (
              <div className="gen-inline-row">
                <button className="ghost-button" type="button" onClick={async () => {
                  const picked = await desktopApi?.pickLibraryFolder();
                  if (picked) setOutputDirectory(picked);
                }}>
                  {outputDirectory ? "Change folder" : "Choose folder"}
                </button>
                {outputDirectory && (
                  <button className="ghost-button" type="button" onClick={() => setOutputDirectory("")}>Clear</button>
                )}
                <code className="gen-path">{outputDirectory || "No folder selected yet."}</code>
              </div>
            )}

            <div className="gen-preview">
              <span className="eyebrow">Output preview</span>
              <code className="gen-path">{preview.outputPath ?? preview.message ?? "Pick a title to preview the final .srt path."}</code>
            </div>

            {!modelReady && !checkingModel && (
              <div className="gen-callout warn">
                <div>
                  <strong>{downloading ? `Downloading ${model}…` : `${model} is not downloaded yet`}</strong>
                  <p>{downloadResult && !downloadResult.ok ? downloadResult.message : availability?.message ?? "The app downloads each Whisper model only once, on first use."}</p>
                  {downloading && downloadProgress && (
                    <>
                      <div className="progress-track" style={{ margin: "0.6rem 0" }}>
                        <div className="progress-fill" style={{ width: `${downloadProgress.percent}%` }} />
                      </div>
                      <small>
                        {downloadProgress.percent}% · {formatBytes(downloadProgress.downloadedBytes)}
                        {downloadProgress.totalBytes ? ` / ${formatBytes(downloadProgress.totalBytes)}` : ""}
                        {downloadProgress.fileName ? ` · ${downloadProgress.fileName}` : ""}
                      </small>
                    </>
                  )}
                </div>
                <button className="primary-button" type="button" disabled={downloading || checkingModel} onClick={() => void handleDownloadModel()}>
                  {downloading ? "Downloading…" : `Download ${model}`}
                </button>
              </div>
            )}
          </section>

          {/* 2 — Titles */}
          <section className="panel gen-card">
            <div className="gen-card-head">
              <div><p className="eyebrow">Step 2</p><h3>Choose titles</h3></div>
              <div className="gen-inline-row">
                <button className="ghost-button" type="button" onClick={toggleAllVisible} disabled={filteredMovies.length === 0}>
                  {allVisibleSelected ? "Clear selection" : `Select all ${filteredMovies.length}`}
                </button>
              </div>
            </div>

            <div className="gen-toolbar">
              <div className="gen-mode-tabs" role="group" aria-label="Library mode">
                <button type="button" aria-pressed={mode === "normal"} onClick={() => setMode("normal")}>Normal</button>
                <button
                  type="button"
                  aria-pressed={mode === "gentle"}
                  disabled={!gentleUnlocked}
                  title={gentleUnlocked ? undefined : "Unlock Gentle mode first"}
                  onClick={() => setMode("gentle")}
                >
                  {gentleUnlocked ? "Gentle" : "Gentle · Locked"}
                </button>
              </div>
              <input
                className="gen-search"
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter by title, video ID or path"
              />
              <select value={subtitleFilter} onChange={(event) => setSubtitleFilter(event.target.value as "missing" | "all" | "ready")}>
                <option value="missing">Missing subtitles</option>
                <option value="all">All videos</option>
                <option value="ready">Has subtitles</option>
              </select>
            </div>

            <div className="gen-selection-line">
              <span><strong>{visibleSelected.length}</strong> selected</span>
              <span>{queueCount} in this filter</span>
            </div>

            <div className="gen-title-list">
              {filteredMovies.length === 0 && (
                <p className="gen-empty">No titles match this filter. Try “All videos” or clear the search.</p>
              )}
              {filteredMovies.slice(0, 200).map((movie) => {
                const checked = visibleSelected.includes(movie.id);
                const hasSubtitle = movie.subtitles.length > 0;
                return (
                  <label className={`gen-title-row${checked ? " is-checked" : ""}`} key={movie.id}>
                    <input type="checkbox" checked={checked} onChange={() => toggleSelection(movie.id)} />
                    <span className="gen-title-copy">
                      <strong title={movie.title}>{movie.title}</strong>
                      <small title={movie.sourcePath}>{movie.videoId ? `${movie.videoId} · ` : ""}{movie.sourcePath}</small>
                    </span>
                    <span className={`gen-pill ${hasSubtitle ? "ok" : "muted"}`}>{hasSubtitle ? `${movie.subtitles.length} sub` : "none"}</span>
                  </label>
                );
              })}
            </div>
          </section>

          {/* 3 — Queue it */}
          <section className="panel gen-card gen-run-card">
            <div className="gen-card-head">
              <div><p className="eyebrow">Step 3</p><h3>Send to the queue</h3></div>
            </div>
            <p className="subtle">
              {visibleSelected.length > 0
                ? `${visibleSelected.length} title${visibleSelected.length === 1 ? "" : "s"} · ${model} · ${languageLabel(language)}`
                : `Nothing selected — queue every title in this filter (${queueCount}).`}
            </p>
            <div className="gen-inline-row">
              <button
                className="primary-button"
                type="button"
                disabled={submitting || Boolean(blockReason) || (visibleSelected.length === 0 && queueCount === 0)}
                onClick={() => void enqueue(visibleSelected.length > 0 ? visibleSelected : filteredMovies.map((movie) => movie.id))}
              >
                {submitting
                  ? "Queuing…"
                  : visibleSelected.length > 0
                    ? `Queue ${visibleSelected.length} selected`
                    : `Queue all ${queueCount} in this filter`}
              </button>
              {activeJobs.length > 0 && runningJob && (
                <button className="ghost-button" type="button" onClick={() => void runJobAction("cancel", runningJob.id)}>
                  Stop current job
                </button>
              )}
            </div>
            {blockReason && <p className="gen-hint">{blockReason}</p>}
            {actionMessage && <p className={`gen-hint ${actionMessage.tone}`}>{actionMessage.text}</p>}
          </section>
        </div>

        {/* Queue monitor */}
        <aside className="gen-column gen-queue">
          <section className="panel gen-card">
            <div className="gen-card-head">
              <div><p className="eyebrow">Live queue</p><h3>{activeJobs.length ? `${activeJobs.length} waiting` : "Idle"}</h3></div>
              <span className={`gen-pill ${processingQueue.running ? "ok" : "muted"}`}>{processingQueue.running ? "working" : "paused"}</span>
            </div>

            {runningJob && (
              <div className="gen-running">
                <span className={`processing-job-kind ${runningJob.kind}`}>{runningJob.kind === "convert-mp4" ? "MP4" : "SUB"}</span>
                <strong title={runningJob.movieTitle}>{runningJob.movieTitle}</strong>
                <small>{runningJob.message}</small>
                {runningJob.kind === "generate-subtitle" && (
                  <div className="progress-track"><div className="progress-fill" style={{ width: `${percent}%` }} /></div>
                )}
                <button className="ghost-button" type="button" onClick={() => void runJobAction("cancel", runningJob.id)}>Cancel</button>
              </div>
            )}

            <ul className="gen-job-list">
              {activeJobs.length === 0 && !runningJob && (
                <li className="gen-empty">Nothing queued. Send titles from the form to start.</li>
              )}
              {activeJobs.map((job) => (
                <li className="gen-job" key={job.id}>
                  <div>
                    <strong title={job.movieTitle}>{job.movieTitle}</strong>
                    <small>{job.status === "running" ? job.message : job.message || "Waiting to start"}</small>
                  </div>
                  <div className="gen-job-actions">
                    <span className="gen-pill muted">{statusLabel(job)}</span>
                    <button className="ghost-button" type="button" onClick={() => void runJobAction("cancel", job.id)}>Cancel</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel gen-card">
            <div className="gen-card-head">
              <div><p className="eyebrow">History</p><h3>Finished jobs</h3></div>
              {historyJobs.length > 0 && (
                <button className="ghost-button" type="button" onClick={() => void clearFinished()}>Clear</button>
              )}
            </div>
            <div className="gen-summary-line">
              <span className="gen-pill ok">{completedCount} ready</span>
              {failedCount > 0 && <span className="gen-pill error">{failedCount} failed</span>}
              {cancelledCount > 0 && <span className="gen-pill muted">{cancelledCount} cancelled</span>}
            </div>
            <ul className="gen-job-list">
              {historyJobs.length === 0 && <li className="gen-empty">No finished jobs yet.</li>}
              {historyJobs.slice(0, 40).map((job) => (
                <li className={`gen-job status-${job.status}`} key={job.id}>
                  <div>
                    <strong title={job.movieTitle}>{job.movieTitle}</strong>
                    <small title={job.error ?? job.message}>
                      {job.status === "failed" ? job.error ?? job.message : job.message}
                      <em> · {timeAgo(job.updatedAt)}</em>
                    </small>
                  </div>
                  <div className="gen-job-actions">
                    <span className={`gen-pill ${job.status === "completed" ? "ok" : job.status === "failed" ? "error" : "muted"}`}>
                      {statusLabel(job)}
                    </span>
                    {(job.status === "failed" || job.status === "cancelled") && (
                      <button className="ghost-button" type="button" onClick={() => void runJobAction("retry", job.id)}>Retry</button>
                    )}
                    {job.status === "completed" && (
                      <button
                        className="ghost-button"
                        type="button"
                        onClick={() => { setSelectedMovieId(job.movieId); setActivePage("library"); }}
                      >
                        Open
                      </button>
                    )}
                    <button className="ghost-button" type="button" title="Remove from history" onClick={() => void runJobAction("remove", job.id)}>✕</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </section>
  );
}
