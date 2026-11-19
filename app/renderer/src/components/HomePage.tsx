import { useState } from "react";
import type { AppShellState, MediaProcessingQueueState, MovieRecord, ScanSummary } from "../../../shared/contracts";
import { SamplePosterCard } from "./SamplePosterCard";

const popularSamples = [
  { title: "Spider-Man", year: "2018", accent: "linear-gradient(180deg, #f44336, #102c61)" },
  { title: "Iron Man", year: "2008", accent: "linear-gradient(180deg, #ff8a00, #661d00)" },
  { title: "Batman", year: "2022", accent: "linear-gradient(180deg, #1a1d24, #48546a)" },
  { title: "Avengers", year: "2019", accent: "linear-gradient(180deg, #4f46e5, #090b24)" },
  { title: "Avatar", year: "2022", accent: "linear-gradient(180deg, #00bcd4, #0a2147)" },
  { title: "Interstellar", year: "2014", accent: "linear-gradient(180deg, #263238, #090c1a)" }
] as const;

interface HomePageProps {
  movies: MovieRecord[];
  appState: AppShellState;
  lastScanSummary: ScanSummary | null;
  processingQueue?: MediaProcessingQueueState;
}

export function HomePage({ movies, appState, lastScanSummary, processingQueue }: HomePageProps) {
  const libraryCount = movies.length;
  const gentleCount = appState.gentleUnlocked ? appState.roots.gentle.length : 0;
  const recentScans = appState.scanHistory.length > 0
    ? appState.scanHistory
    : lastScanSummary
      ? [{ createdAt: new Date().toISOString(), summary: lastScanSummary }]
      : [];
  const latestScan = recentScans[0]?.summary ?? null;
  const subtitleSearchLogs = latestScan?.subtitleSearchLogs ?? [];
  const visibleQueueJobs = processingQueue?.jobs.filter((job) => job.status === "queued" || job.status === "running" || job.status === "failed") ?? [];
  const conversionJobs = visibleQueueJobs.filter((job) => job.kind === "convert-mp4");
  const subtitleJobs = visibleQueueJobs.filter((job) => job.kind === "generate-subtitle");
  const activeConversionJobs = conversionJobs.filter((job) => job.status !== "failed");
  const activeSubtitleJobs = subtitleJobs.filter((job) => job.status !== "failed");
  const failedCount = visibleQueueJobs.filter((job) => job.status === "failed").length;
  const [copiedLogs, setCopiedLogs] = useState(false);

  async function handleCopySubtitleLogs(): Promise<void> {
    if (subtitleSearchLogs.length === 0) {
      return;
    }

    await navigator.clipboard.writeText(subtitleSearchLogs.join("\n"));
    setCopiedLogs(true);
    window.setTimeout(() => setCopiedLogs(false), 1800);
  }

  return (
    <section className="page home-page">
      <div className="hero-card home-hero">
        <div className="home-hero-copy">
          <p className="eyebrow">Pipeline</p>
          <h3>Scan, classify, organize, then act from one desktop shell.</h3>
          <p>
            The renderer talks to Electron through IPC, while the main process
            owns file access, database writes, and FFmpeg-backed file jobs.
          </p>
          <div className="home-chips">
            <span>Local-first</span>
            <span>Poster-driven</span>
            <span>Manual scan</span>
            <span>Subtitle-aware</span>
          </div>
        </div>
        <div className="hero-metrics home-metrics">
          <div className="metric">
            <strong>{libraryCount}</strong>
            <span>Visible titles</span>
          </div>
          <div className="metric">
            <strong>{appState.roots.normal.length}</strong>
            <span>Normal roots</span>
          </div>
          <div className="metric">
            <strong>{gentleCount}</strong>
            <span>Gentle roots</span>
          </div>
        </div>
      </div>

      <section className="home-grid">
        <article className="panel home-panel">
          <p className="eyebrow">Quick status</p>
          <h3>What the shell is ready to do</h3>
          <div className="home-status-list">
            <div>
              <strong>Library</strong>
              <span>{libraryCount} titles in local SQLite</span>
            </div>
            <div>
              <strong>Roots</strong>
              <span>{appState.roots.normal.length} normal and {gentleCount} gentle roots configured</span>
            </div>
            <div>
              <strong>Unlock</strong>
              <span>{appState.gentleUnlocked ? "Gentle mode is available" : "Gentle mode is locked"}</span>
            </div>
          </div>
        </article>

        <article className="panel home-panel">
          <p className="eyebrow">Workflow</p>
          <h3>How the app moves from scan to browse</h3>
          <div className="home-workflow">
            <span>Scan folders</span>
            <span>Resolve metadata</span>
            <span>Write .nfo</span>
            <span>Generate posters</span>
            <span>Browse by card</span>
            <span>Play with subtitles</span>
          </div>
        </article>
      </section>

      {processingQueue && visibleQueueJobs.length > 0 && (
        <div className="processing-monitor-panels">
          <section className="panel processing-monitor-compact" aria-label="Video conversion monitor">
            <div className="processing-monitor-summary">
              <div>
                <p className="eyebrow">Realtime monitor</p>
                <strong>Video conversion</strong>
              </div>
              <span className="processing-monitor-count"><strong>{activeConversionJobs.length}</strong> active</span>
            </div>
            <div className="processing-monitor-jobs">
              {(conversionJobs.length > 0 ? conversionJobs : visibleQueueJobs).slice(0, 3).map((job) => (
                <div className="processing-monitor-job" key={job.id}>
                  <span className={`processing-job-kind ${job.kind}`}>MP4</span>
                  <strong title={job.movieTitle}>{job.movieTitle}</strong>
                  <span>{job.status === "failed" ? job.error || job.message : `${job.status} · ${Math.round(job.progress)}% · ${job.message}`}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel processing-monitor-compact" aria-label="Subtitle generation monitor">
            <div className="processing-monitor-summary">
              <div>
                <p className="eyebrow">Realtime monitor</p>
                <strong>Subtitles</strong>
              </div>
              <span className="processing-monitor-count"><strong>{activeSubtitleJobs.length}</strong> active</span>
            </div>
            <div className="processing-monitor-jobs">
              {(subtitleJobs.length > 0 ? subtitleJobs : visibleQueueJobs).slice(0, 3).map((job) => (
                <div className="processing-monitor-job" key={job.id}>
                  <span className={`processing-job-kind ${job.kind}`}>SUB</span>
                  <strong title={job.movieTitle}>{job.movieTitle}</strong>
                  <span>{job.status === "failed" ? job.error || job.message : `${job.status} · ${Math.round(job.progress)}% · ${job.message}`}</span>
                </div>
              ))}
            </div>
          </section>

          {failedCount > 0 && (
            <section className="panel processing-monitor-compact processing-monitor-failed-panel" aria-label="Failed media jobs">
              <div className="processing-monitor-summary">
                <div>
                  <p className="eyebrow">Realtime monitor</p>
                  <strong>Failed jobs</strong>
                </div>
                <span className="processing-monitor-count processing-monitor-failed"><strong>{failedCount}</strong> failed</span>
              </div>
              <div className="processing-monitor-jobs">
                {visibleQueueJobs.filter((job) => job.status === "failed").slice(0, 3).map((job) => (
                  <div className="processing-monitor-job" key={job.id}>
                    <span className={`processing-job-kind ${job.kind}`}>{job.kind === "convert-mp4" ? "MP4" : "SUB"}</span>
                    <strong title={job.movieTitle}>{job.movieTitle}</strong>
                    <span>{job.error || job.message}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {recentScans.length > 0 && (
        <section className="panel home-panel">
          <p className="eyebrow">Recent scans</p>
          <h3>Scan results</h3>
          {subtitleSearchLogs.length > 0 && (
            <div className="inline-actions" style={{ marginBottom: "0.85rem" }}>
              <button className="ghost-button" onClick={() => void handleCopySubtitleLogs()} type="button">
                {copiedLogs ? "Copied subtitle logs" : "Copy subtitle logs"}
              </button>
            </div>
          )}
          <div className="home-status-list">
            {recentScans.map((entry) => (
              <div key={`${entry.createdAt}-${entry.summary.imported}-${entry.summary.discovered}`}>
                <strong>{new Date(entry.createdAt).toLocaleString()}</strong>
                <span>
                  {entry.summary.imported} imported, {entry.summary.skipped} skipped, {entry.summary.subtitleSearchLogs.length} subtitle match{entry.summary.subtitleSearchLogs.length === 1 ? "" : "es"}
                </span>
              </div>
            ))}
          </div>
          {subtitleSearchLogs.length > 0 && (
            <div className="home-status-list">
              {subtitleSearchLogs.map((entry) => (
                <div key={entry}>
                  <strong>SubtitleCat</strong>
                  <span>{entry}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="row-block">
        <div className="row-header">
          <h3>Popular picks</h3>
          <span>Built-in sample posters</span>
        </div>
        <div className="poster-row">
          {popularSamples.map((sample) => (
            <SamplePosterCard key={sample.title} sample={sample} />
          ))}
        </div>
      </section>
    </section>
  );
}
