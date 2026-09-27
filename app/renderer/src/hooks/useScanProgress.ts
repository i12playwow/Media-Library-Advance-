import { useEffect, useRef, useState } from "react";
import type {
  DuplicateGroup,
  ScanProgress,
  ScanSummary,
  SubtitleScanResult,
} from "../../../shared/contracts";
import { getProgressPercent, getScanStageLabel } from "../utils";

const activeScanStages = new Set(["preparing", "discovering", "processing"]);

interface UseScanProgressOptions {
  desktopApi: typeof window.desktopApi | undefined;
  /** Called when the IPC scan listener determines a movie-list refresh is needed. */
  onScanRefresh: () => void;
}

export function useScanProgress({ desktopApi, onScanRefresh }: UseScanProgressOptions) {
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [lastScanSummary, setLastScanSummary] = useState<ScanSummary | null>(null);
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [duplicateSelections, setDuplicateSelections] = useState<Record<string, string>>({});
  const [recentProcessedFiles, setRecentProcessedFiles] = useState<string[]>([]);
  const [subtitleScanRunning, setSubtitleScanRunning] = useState(false);
  const [subtitleScanResult, setSubtitleScanResult] = useState<SubtitleScanResult | null>(null);

  const lastScanImportedRef = useRef(0);
  const scanRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScanRefreshRef = useRef(onScanRefresh);
  onScanRefreshRef.current = onScanRefresh;

  useEffect(() => {
    if (!desktopApi) return;

    const unsubscribe = window.desktopApi.onScanProgress((progress) => {
      if (scanDismissTimerRef.current) {
        clearTimeout(scanDismissTimerRef.current);
        scanDismissTimerRef.current = null;
      }

      setScanProgress(progress);

      if (progress.stage === "preparing") {
        setRecentProcessedFiles([]);
        setLastScanSummary(null);
        lastScanImportedRef.current = 0;
      }

      if (progress.currentFile) {
        setRecentProcessedFiles((current) =>
          [
            progress.currentFile as string,
            ...current.filter((file) => file !== progress.currentFile),
          ].slice(0, 8)
        );
      }

      // Real-time refresh: throttled to every 3s while importing
      const newImported = progress.imported ?? 0;
      if (newImported > lastScanImportedRef.current) {
        lastScanImportedRef.current = newImported;
        if (scanRefreshTimerRef.current) clearTimeout(scanRefreshTimerRef.current);
        scanRefreshTimerRef.current = setTimeout(() => {
          onScanRefreshRef.current();
        }, 3000);
      }

      // Final refresh on scan end
      if (progress.stage === "completed" || progress.stage === "cancelled") {
        if (scanRefreshTimerRef.current) clearTimeout(scanRefreshTimerRef.current);
        onScanRefreshRef.current();
        scanDismissTimerRef.current = setTimeout(() => {
          setScanProgress(null);
          scanDismissTimerRef.current = null;
        }, 5000);
      }
    });

    return () => {
      if (scanRefreshTimerRef.current) {
        clearTimeout(scanRefreshTimerRef.current);
      }
      if (scanDismissTimerRef.current) {
        clearTimeout(scanDismissTimerRef.current);
      }
      unsubscribe();
    };
  }, [desktopApi]);

  const isScanning = Boolean(scanProgress && activeScanStages.has(scanProgress.stage));
  const progressPercent = getProgressPercent(scanProgress);
  const scanStageLabel = getScanStageLabel(scanProgress);

  return {
    scanProgress,
    setScanProgress,
    lastScanSummary,
    setLastScanSummary,
    duplicateGroups,
    setDuplicateGroups,
    duplicateSelections,
    setDuplicateSelections,
    recentProcessedFiles,
    subtitleScanRunning,
    setSubtitleScanRunning,
    subtitleScanResult,
    setSubtitleScanResult,
    isScanning,
    progressPercent,
    scanStageLabel,
  };
}
