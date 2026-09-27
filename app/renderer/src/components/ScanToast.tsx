import type { ScanProgress } from "../../../shared/contracts";

interface ScanToastProps {
  scanProgress: ScanProgress;
  isScanning: boolean;
  progressPercent: number;
  scanStageLabel: string;
  onCancel: () => void;
  onDismiss: () => void;
}

export function ScanToast({
  scanProgress,
  isScanning,
  progressPercent,
  scanStageLabel,
  onCancel,
  onDismiss,
}: ScanToastProps) {
  return (
    <div className={`scan-toast${isScanning ? " active" : " done"}`}>
      <div className="scan-toast-top">
        <span className="scan-toast-label">
          {isScanning ? "⏳ Scanning…" : "✅ Scan complete"}
        </span>
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          {isScanning && (
            <button
              className="scan-toast-stop"
              onClick={onCancel}
              title="Stop scan (Esc)"
              type="button"
            >⏹</button>
          )}
          {!isScanning && (
            <button
              className="scan-toast-stop"
              onClick={onDismiss}
              title="Dismiss"
              type="button"
            >✕</button>
          )}
        </div>
      </div>
      <div className="scan-toast-bar-track">
        <div className="scan-toast-bar-fill" style={{ width: `${progressPercent}%` }} />
      </div>
      <div className="scan-toast-info">
        <span className="scan-toast-pct">{progressPercent}%</span>
        <span className="scan-toast-count">
          {scanProgress.imported}/{scanProgress.totalFiles} movies
        </span>
        <span className="scan-toast-msg">{scanStageLabel}</span>
      </div>
    </div>
  );
}
