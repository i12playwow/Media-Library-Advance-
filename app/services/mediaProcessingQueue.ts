import fs from "node:fs";
import path from "node:path";
import type { DatabaseClient } from "../database/database";
import type {
  MediaProcessingJob,
  MediaProcessingJobKind,
  MediaProcessingQueueState,
  SubtitleGenerationOptions,
  SubtitleQueueOptions
} from "../shared/contracts";
import { probeVideoFile, runFfmpeg } from "./ffmpegService";

interface QueueOptions {
  generateSubtitle: (movieId: string, options: SubtitleGenerationOptions) => Promise<{ ok: boolean; message: string }>;
  onChanged: (state: MediaProcessingQueueState) => void;
}

/** Thrown when the operator cancelled the job that was in flight. */
class CancelledJobError extends Error {
  constructor() {
    super("Cancelled by the operator.");
    this.name = "CancelledJobError";
  }
}

const SUBTITLE_DEFAULTS: SubtitleQueueOptions = {
  language: "auto",
  model: "small",
  outputMode: "library-default"
};

const LANGUAGE_LABEL: Record<string, string> = { auto: "Auto", ja: "Japanese", zh: "Chinese" };

function describeSubtitleJob(settings: SubtitleQueueOptions): string {
  return `${settings.model} · ${LANGUAGE_LABEL[settings.language] ?? settings.language}`;
}

export function createMediaProcessingQueue(database: DatabaseClient, options: QueueOptions) {
  let running = false;

  // Per-job subtitle settings, keyed by job id. Only the head job is ever
  // consumed, so the map stays tiny; entries are dropped once their job
  // finishes. Jobs enqueued elsewhere in the app fall back to the defaults.
  const subtitleSettings = new Map<string, SubtitleQueueOptions>();
  // Jobs the operator cancelled while they were still running. The running
  // promise cannot be killed mid-flight (Whisper holds the file), so the
  // result is discarded and the row is marked cancelled instead.
  const cancelledJobs = new Set<string>();

  // state() maps every returned job row through getMovie(), so each publish
  // costs O(jobs) queries. The startup enqueue loop fires thousands of
  // publishes in a burst — coalescing them keeps the main thread responsive
  // (each coalesced tick still emits the freshest state).
  const PUBLISH_COALESCE_MS = 150;
  let publishTimer: ReturnType<typeof setTimeout> | null = null;
  function schedulePublish(): void {
    if (publishTimer) {
      return;
    }
    publishTimer = setTimeout(() => {
      publishTimer = null;
      publish();
    }, PUBLISH_COALESCE_MS);
  }

  function mapJob(row: ReturnType<DatabaseClient["listMediaProcessingJobs"]>[number]): MediaProcessingJob {
    const movie = database.getMovie(row.movie_id);
    return {
      id: row.id,
      movieId: row.movie_id,
      movieTitle: movie?.title ?? "Unknown movie",
      kind: row.kind as MediaProcessingJobKind,
      status: row.status as MediaProcessingJob["status"],
      progress: row.progress,
      message: row.message,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function state(): MediaProcessingQueueState {
    return { jobs: database.listMediaProcessingJobs().map(mapJob), running };
  }

  function publish(): void {
    options.onChanged(state());
  }

  function enqueue(movieId: string, kind: MediaProcessingJobKind, settings?: SubtitleQueueOptions): string | null {
    const subtitle: SubtitleQueueOptions = kind === "generate-subtitle"
      ? { ...SUBTITLE_DEFAULTS, ...(settings ?? {}) }
      : SUBTITLE_DEFAULTS;
    const queuedMessage = kind === "generate-subtitle" ? `Queued · ${describeSubtitleJob(subtitle)}` : "Waiting to start";
    const id = database.enqueueMediaProcessingJob(movieId, kind, queuedMessage);
    if (id) subtitleSettings.set(id, subtitle);
    schedulePublish();
    void pump();
    return id;
  }

  /** Drop a queued job, or flag a running one so its result is discarded
   *  when the underlying process returns. Converts never enqueue follow-ups
   *  after a cancel. */
  function cancel(jobId: string): void {
    const job = database.listMediaProcessingJobs(500).find((row) => row.id === jobId);
    if (!job) return;
    if (job.status === "queued") {
      subtitleSettings.delete(jobId);
      database.updateMediaProcessingJob(jobId, { status: "cancelled", progress: 0, message: "Cancelled", error: null });
    } else if (job.status === "running") {
      cancelledJobs.add(jobId);
      database.updateMediaProcessingJob(jobId, { message: "Cancelling after this file…" });
    } else {
      return;
    }
    publish();
  }

  /** Re-run a failed or cancelled job with the settings it was queued with. */
  function retry(jobId: string): string | null {
    const job = database.listMediaProcessingJobs(500).find((row) => row.id === jobId);
    if (!job || (job.status !== "failed" && job.status !== "cancelled")) return null;
    cancelledJobs.delete(jobId);
    database.updateMediaProcessingJob(jobId, { status: "queued", progress: 0, message: job.message, error: null });
    schedulePublish();
    void pump();
    return jobId;
  }

  /** Remove a finished job row from the centre's history. */
  function remove(jobId: string): void {
    const job = database.listMediaProcessingJobs(500).find((row) => row.id === jobId);
    if (!job || job.status === "running" || job.status === "queued") return;
    subtitleSettings.delete(jobId);
    cancelledJobs.delete(jobId);
    database.deleteMediaProcessingJob(jobId);
    publish();
  }

  /** Wipe the failed/cancelled history so the centre can start a fresh run. */
  function clearFinished(): void {
    database.clearFinishedMediaProcessingJobs();
    publish();
  }

  async function pump(): Promise<void> {
    if (running) return;
    const next = database.listMediaProcessingJobs(1).find((job) => job.status === "queued");
    if (!next) {
      publish();
      return;
    }
    running = true;
    database.updateMediaProcessingJob(next.id, { status: "running", progress: 1, message: "Starting" });
    publish();
    let followUp: string | null = null;
    try {
      const movie = database.getMovie(next.movie_id);
      if (!movie || !fs.existsSync(movie.sourcePath)) throw new Error("The source video is no longer available.");
      if (next.kind === "convert-mp4") {
        const output = path.join(movie.folderPath, `${path.basename(movie.sourcePath, path.extname(movie.sourcePath))}.mp4`);
        if (path.resolve(output).toLowerCase() !== path.resolve(movie.sourcePath).toLowerCase() && !fs.existsSync(output)) {
          await runFfmpeg(["-n", "-i", movie.sourcePath, "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", output]);
        }
        if (cancelledJobs.has(next.id)) throw new CancelledJobError();
        if (!fs.existsSync(output)) throw new Error("MP4 conversion did not produce an output file.");
        database.updateMovieLocation(movie.id, { sourcePath: output, folderPath: path.dirname(output), libraryMode: movie.libraryMode });
        database.updateMediaProcessingJob(next.id, { status: "completed", progress: 100, message: "MP4 conversion completed", error: null });
        followUp = movie.id;
      } else {
        const settings = subtitleSettings.get(next.id) ?? SUBTITLE_DEFAULTS;
        const result = await options.generateSubtitle(movie.id, settings);
        if (cancelledJobs.has(next.id)) throw new CancelledJobError();
        if (!result.ok) throw new Error(result.message);
        database.updateMediaProcessingJob(next.id, { status: "completed", progress: 100, message: `Subtitle created · ${describeSubtitleJob(settings)}`, error: null });
      }
    } catch (error) {
      if (error instanceof CancelledJobError || cancelledJobs.has(next.id)) {
        database.updateMediaProcessingJob(next.id, { status: "cancelled", progress: 0, message: "Cancelled", error: null });
      } else {
        database.updateMediaProcessingJob(next.id, { status: "failed", progress: 100, message: "Processing failed", error: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      subtitleSettings.delete(next.id);
      cancelledJobs.delete(next.id);
      running = false;
      publish();
      // Cancelling a conversion must not trigger the subtitle follow-up.
      if (followUp) enqueueSubtitleIfMissing(followUp);
      void pump();
    }
  }

  function enqueueSubtitleIfMissing(movieId: string): void {
    const movie = database.getMovie(movieId);
    if (!movie || movie.subtitles.length > 0) return;
    void probeVideoFile(movie.sourcePath).then((probe) => {
      if (probe.valid && (probe.subtitleStreamCount ?? 0) === 0) enqueue(movieId, "generate-subtitle");
    }).catch(() => undefined);
  }

  function enqueueAutomatic(movieId: string): void {
    const movie = database.getMovie(movieId);
    if (!movie) return;
    if (path.extname(movie.sourcePath).toLowerCase() !== ".mp4") {
      enqueue(movie.id, "convert-mp4");
      return;
    }
    enqueueSubtitleIfMissing(movie.id);
  }

  return { enqueue, enqueueAutomatic, cancel, retry, remove, clearFinished, state };
}
