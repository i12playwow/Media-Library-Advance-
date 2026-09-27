import { useState } from "react";
import type { AppShellState, MovieRecord, ScanSummary } from "../../../shared/contracts";
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
}

export function HomePage({ movies, appState, lastScanSummary }: HomePageProps) {
  const libraryCount = movies.length;
  const gentleCount = appState.gentleUnlocked ? appState.roots.gentle.length : 0;
  const recentScans = appState.scanHistory.length > 0
    ? appState.scanHistory
    : lastScanSummary
      ? [{ createdAt: new Date().toISOString(), summary: lastScanSummary }]
      : [];
  const latestScan = recentScans[0]?.summary ?? null;
  const subtitleSearchLogs = latestScan?.subtitleSearchLogs ?? [];
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
