import { useState, type Dispatch, type SetStateAction } from "react";
import type {
  AppShellState,
  DuplicateGroup,
  LibraryMode,
  ScanAutomationOptions,
  ScanSummary,
} from "../../../shared/contracts";
import { buildScanStatusMessage } from "../utils";

interface UseScanHandlersProps {
  desktopApi: typeof window.desktopApi;
  appState: AppShellState | null;
  isScanning: boolean;
  scanOptionsDraft: ScanAutomationOptions;
  setScanOptionsDraft: Dispatch<SetStateAction<ScanAutomationOptions>>;
  deferredSearch: string;
  refreshMovies: (query?: string) => Promise<void>;
  initFromAppState: (state: AppShellState) => void;
  setAppState: Dispatch<SetStateAction<AppShellState | null>>;
  setStatusMessage: (msg: string) => void;
  setLastScanSummary: Dispatch<SetStateAction<ScanSummary | null>>;
  setDuplicateGroups: Dispatch<SetStateAction<DuplicateGroup[]>>;
  setDuplicateSelections: Dispatch<SetStateAction<Record<string, string>>>;
  setShowScanOptionsPrompt: Dispatch<SetStateAction<boolean>>;
  setPendingScanMode: Dispatch<SetStateAction<LibraryMode>>;
}

export function useScanHandlers({
  desktopApi,
  appState,
  isScanning,
  scanOptionsDraft,
  setScanOptionsDraft,
  deferredSearch,
  refreshMovies,
  initFromAppState,
  setAppState,
  setStatusMessage,
  setLastScanSummary,
  setDuplicateGroups,
  setDuplicateSelections,
  setShowScanOptionsPrompt,
  setPendingScanMode,
}: UseScanHandlersProps) {
  const [scanSourceMode, setScanSourceMode] = useState<"saved" | "folder" | "system">("folder");

  async function autoResolveDuplicateGroups(
    groups: DuplicateGroup[]
  ): Promise<{ blocked: number; failed: number; firstError: string | null }> {
    if (!desktopApi) return { blocked: 0, failed: 0, firstError: null };
    let blocked = 0;
    let failed = 0;
    let firstError: string | null = null;
    for (const g of groups) {
      const keepPath = g.files.find((f) => f.autoSelected)?.path ?? g.files[0].path;
      const deletePaths = g.files.map((f) => f.path).filter((p) => p !== keepPath);
      const result = await desktopApi.resolveDuplicate(keepPath, deletePaths);
      blocked += result.blocked;
      failed += result.failed.length;
      firstError ??= result.failed[0]?.error ?? null;
    }
    return { blocked, failed, firstError };
  }

  async function handleScanSaved(): Promise<void> {
    if (!desktopApi || !appState) return;
    if (isScanning) {
      setStatusMessage("A scan is already running.");
      return;
    }
    if (appState.roots.normal.length + appState.roots.gentle.length === 0) {
      setStatusMessage("Choose a media folder first, then scan it.");
      return;
    }

    setStatusMessage("Scanning saved media folders and syncing SQLite catalog...");
    setLastScanSummary(null);

    try {
      const summary = await desktopApi.scanLibraries(scanOptionsDraft);
      setLastScanSummary(summary);
      let autoResolve = { blocked: 0, failed: 0, firstError: null as string | null };
      if (summary.duplicateGroups.length > 0) {
        if (scanOptionsDraft.autoResolveDuplicates) {
          autoResolve = await autoResolveDuplicateGroups(summary.duplicateGroups);
        } else {
          const selections: Record<string, string> = {};
          for (const g of summary.duplicateGroups) selections[g.key] = g.files[0].path;
          setDuplicateGroups(summary.duplicateGroups);
          setDuplicateSelections(selections);
        }
      }
      const nextState = await desktopApi.getAppState();
      setAppState(nextState);
      initFromAppState(nextState);
      await refreshMovies(deferredSearch);
      const blockedNote = autoResolve.blocked > 0
        ? ` · ${autoResolve.blocked} gentle-library duplicate(s) kept on disk (unlock to delete).`
        : "";
      const failedNote = autoResolve.failed > 0
        ? ` · ${autoResolve.failed} duplicate(s) not deleted: ${autoResolve.firstError ?? "the file stayed on disk"}`
        : "";
      setStatusMessage(buildScanStatusMessage(summary) + blockedNote + failedNote);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "The scan failed unexpectedly.");
    }
  }

  function openScanOptions(mode: LibraryMode): void {
    if (isScanning) {
      setStatusMessage("A scan is already running.");
      return;
    }
    setPendingScanMode(mode);
    const hasSavedRoots =
      (appState?.roots.normal.length ?? 0) + (appState?.roots.gentle.length ?? 0) > 0;
    setScanSourceMode(hasSavedRoots ? "saved" : "folder");
    setScanOptionsDraft((current) => ({
      ...current,
      addToNormalModeLibrary: mode === "normal",
      addToGentleModeLibrary: mode === "gentle",
    }));
    setShowScanOptionsPrompt(true);
  }

  async function handleConfirmScanOptions(): Promise<void> {
    if (!desktopApi) {
      setStatusMessage("Desktop bridge unavailable. Restart MLA+ and try again.");
      return;
    }
    if (scanOptionsDraft.addToNormalModeLibrary === scanOptionsDraft.addToGentleModeLibrary) {
      setStatusMessage("Select either Normal Mode library or Gentle Mode library.");
      return;
    }
    setShowScanOptionsPrompt(false);
    setLastScanSummary(null);

    try {
      const summary =
        scanSourceMode === "system"
          ? await desktopApi.scanWholeSystem(scanOptionsDraft)
          : scanSourceMode === "saved"
          ? await desktopApi.scanLibraries(scanOptionsDraft)
          : await desktopApi.pickScanFolder(scanOptionsDraft);
      setLastScanSummary(summary);
      let autoResolve = { blocked: 0, failed: 0, firstError: null as string | null };
      if (summary.duplicateGroups.length > 0) {
        if (scanOptionsDraft.autoResolveDuplicates) {
          autoResolve = await autoResolveDuplicateGroups(summary.duplicateGroups);
        } else {
          const selections: Record<string, string> = {};
          for (const g of summary.duplicateGroups) selections[g.key] = g.files[0].path;
          setDuplicateGroups(summary.duplicateGroups);
          setDuplicateSelections(selections);
        }
      }
      const nextState = await desktopApi.getAppState();
      setAppState(nextState);
      initFromAppState(nextState);
      await refreshMovies(deferredSearch);
      const blockedNote = autoResolve.blocked > 0
        ? ` · ${autoResolve.blocked} gentle-library duplicate(s) kept on disk (unlock to delete).`
        : "";
      const failedNote = autoResolve.failed > 0
        ? ` · ${autoResolve.failed} duplicate(s) not deleted: ${autoResolve.firstError ?? "the file stayed on disk"}`
        : "";
      setStatusMessage(buildScanStatusMessage(summary) + blockedNote + failedNote);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "The scan failed unexpectedly.");
    }
  }

  return {
    handleScanSaved,
    openScanOptions,
    handleConfirmScanOptions,
    scanSourceMode,
    setScanSourceMode,
  };
}
