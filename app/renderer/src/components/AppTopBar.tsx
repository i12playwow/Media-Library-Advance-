import type { LibraryMode, MediaProcessingQueueState, ScanProgress } from "../../../shared/contracts";

interface InvalidFileEntry {
  path: string;
  reason: string;
  status: string;
}

interface AppTopBarProps {
  searchInput: string;
  onSearchChange: (value: string) => void;
  isScanning: boolean;
  onOpenScanOptions: (mode: LibraryMode) => void;
  onCancelScan: () => void;
  onOpenBrowser?: () => void;
  gentleUnlocked: boolean;
  scanProgress: ScanProgress | null;
  scanStageLabel: string;
  processingQueue: MediaProcessingQueueState;
  lastScanSummaryInvalidFiles: InvalidFileEntry[];
  getRejectedStatusLabel: (status: "incomplete" | "corrupt" | "invalid") => string;
  displayName?: string;
}

export function AppTopBar({
  searchInput,
  onSearchChange,
  isScanning,
  onOpenScanOptions,
  onCancelScan,
  onOpenBrowser,
  gentleUnlocked,
  scanProgress,
  scanStageLabel,
  processingQueue,
  lastScanSummaryInvalidFiles,
  getRejectedStatusLabel: rejectedLabel,
  displayName,
}: AppTopBarProps) {
  const activeJobs = processingQueue.jobs.filter((job) => job.status === "queued" || job.status === "running");
  const conversionJobs = activeJobs.filter((job) => job.kind === "convert-mp4");
  const subtitleJobs = activeJobs.filter((job) => job.kind === "generate-subtitle");
  const runningConversion = conversionJobs.find((job) => job.status === "running");
  const runningSubtitle = subtitleJobs.find((job) => job.status === "running");
  const showScanPanel = Boolean(scanProgress && isScanning);
  const showConversionPanel = conversionJobs.length > 0;
  const showSubtitlePanel = subtitleJobs.length > 0;

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">Local only</p>
          <h2>{displayName ? `${displayName}'s library` : "No external API server"}</h2>
        </div>
        <div className="topbar-actions">
          <input
            className="search-input"
            placeholder="Search titles, video IDs, filenames, keywords..."
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          <button
            className="primary-button"
            disabled={isScanning}
            onClick={() => onOpenScanOptions("normal")}
            type="button"
          >
            {isScanning ? "Scanning..." : "Scan library"}
          </button>
          {onOpenBrowser && <button className="ghost-button" onClick={onOpenBrowser} type="button">Browser</button>}
          {isScanning ? (
            <button
              className="scan-stop-btn"
              onClick={onCancelScan}
              title="Stop the running scan (Esc)"
              type="button"
            >
              ⏹ Stop scan
            </button>
          ) : null}
          <span
            className={gentleUnlocked ? "monitor-status active" : "monitor-status"}
            title="Toggle Gentle mode with Ctrl+Alt+D"
          >
            Gentle {gentleUnlocked ? "on" : "off"} · Ctrl+Alt+D
          </span>
        </div>
      </header>

      {(showScanPanel || showConversionPanel || showSubtitlePanel) && (
        <div className="realtime-monitor-panels">
          {showScanPanel && (
            <section className="panel realtime-monitor" aria-label="Realtime scan monitor">
              <div className="realtime-monitor-row">
                <span className="monitor-status active">Scan</span>
                <span className="realtime-monitor-stat">
                  {scanStageLabel} · {scanProgress!.processedFiles}/{scanProgress!.totalFiles} · {scanProgress!.imported} added
                </span>
                {scanProgress!.currentFile && (
                  <code className="realtime-monitor-current" title={scanProgress!.currentFile}>{scanProgress!.currentFile}</code>
                )}
              </div>
            </section>
          )}

          {showConversionPanel && (
            <section className="panel realtime-monitor" aria-label="Realtime video conversion monitor">
              <div className="realtime-monitor-row">
                <span className={runningConversion ? "monitor-status active" : "monitor-status"}>Convert</span>
                <span className="realtime-monitor-stat">{conversionJobs.length} active</span>
                {runningConversion && (
                  <span className="realtime-monitor-current" title={`${runningConversion.movieTitle} — ${runningConversion.message}`}>
                    {runningConversion.movieTitle} · {Math.round(runningConversion.progress)}%
                  </span>
                )}
              </div>
            </section>
          )}

          {showSubtitlePanel && (
            <section className="panel realtime-monitor" aria-label="Realtime subtitle generation monitor">
              <div className="realtime-monitor-row">
                <span className={runningSubtitle ? "monitor-status active" : "monitor-status"}>Subtitles</span>
                <span className="realtime-monitor-stat">{subtitleJobs.length} active</span>
                {runningSubtitle && (
                  <span className="realtime-monitor-current" title={`${runningSubtitle.movieTitle} — ${runningSubtitle.message}`}>
                    {runningSubtitle.movieTitle} · {Math.round(runningSubtitle.progress)}%
                  </span>
                )}
              </div>
            </section>
          )}
        </div>
      )}

      {lastScanSummaryInvalidFiles.length > 0 && (
        <section className="panel scan-report-panel">
          <div className="scan-monitor-header">
            <div>
              <p className="eyebrow">Skipped file report</p>
              <h3>Incomplete or corrupt videos were held back from the library.</h3>
            </div>
            <span className="monitor-status">
              {lastScanSummaryInvalidFiles.length} blocked
            </span>
          </div>
          <div className="scan-report-grid">
            {lastScanSummaryInvalidFiles.map((item) => (
              <article className="report-item" key={`${item.path}:${item.reason}`}>
                <span className={`report-pill ${item.status}`}>
                  {rejectedLabel(item.status as "incomplete" | "corrupt" | "invalid")}
                </span>
                <strong className="report-reason">{item.reason}</strong>
                <code>{item.path}</code>
              </article>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
