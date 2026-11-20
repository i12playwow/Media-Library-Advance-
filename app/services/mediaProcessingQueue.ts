import fs from "node:fs";
import path from "node:path";
import type { DatabaseClient } from "../database/database";
import type { MediaProcessingJob, MediaProcessingJobKind, MediaProcessingQueueState, SubtitleGenerationOptions } from "../shared/contracts";
import { probeVideoFile, runFfmpeg } from "./ffmpegService";

interface QueueOptions {
  generateSubtitle: (movieId: string, options: SubtitleGenerationOptions) => Promise<{ ok: boolean; message: string }>;
  onChanged: (state: MediaProcessingQueueState) => void;
}

export function createMediaProcessingQueue(database: DatabaseClient, options: QueueOptions) {
  let running = false;

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

  function enqueue(movieId: string, kind: MediaProcessingJobKind): string | null {
    const id = database.enqueueMediaProcessingJob(movieId, kind);
    schedulePublish();
    void pump();
    return id;
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
    try {
      const movie = database.getMovie(next.movie_id);
      if (!movie || !fs.existsSync(movie.sourcePath)) throw new Error("The source video is no longer available.");
      if (next.kind === "convert-mp4") {
        const output = path.join(movie.folderPath, `${path.basename(movie.sourcePath, path.extname(movie.sourcePath))}.mp4`);
        if (path.resolve(output).toLowerCase() !== path.resolve(movie.sourcePath).toLowerCase() && !fs.existsSync(output)) {
          await runFfmpeg(["-n", "-i", movie.sourcePath, "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", output]);
        }
        if (!fs.existsSync(output)) throw new Error("MP4 conversion did not produce an output file.");
        database.updateMovieLocation(movie.id, { sourcePath: output, folderPath: path.dirname(output), libraryMode: movie.libraryMode });
        database.updateMediaProcessingJob(next.id, { status: "completed", progress: 100, message: "MP4 conversion completed" });
        enqueueSubtitleIfMissing(movie.id);
      } else {
        const result = await options.generateSubtitle(movie.id, { language: "auto", model: "small", outputMode: "library-default" });
        if (!result.ok) throw new Error(result.message);
        database.updateMediaProcessingJob(next.id, { status: "completed", progress: 100, message: "Subtitle generation completed" });
      }
    } catch (error) {
      database.updateMediaProcessingJob(next.id, { status: "failed", progress: 100, message: "Processing failed", error: error instanceof Error ? error.message : String(error) });
    } finally {
      running = false;
      publish();
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

  return { enqueue, enqueueAutomatic, state };
}
