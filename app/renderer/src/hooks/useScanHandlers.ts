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
  const [scanSourceMode, setScanSourceMode] = useState<"saved" | "folder">("folder");

  async function autoResolveDuplicateGroups(
    groups: DuplicateGroup[],
    gentleUnlocked: boolean
  ): Promise<number> {
    if (!desktopApi) return 0;
    let blocked = 0;
    for (const g of groups) {
      const keepPath = g.files.find((f) => f.autoSelected)?.path ?? g.files[0].path;
      const deletePaths = g.files.map((f) => f.path).filter((p) => p !== keepPath);
      const result = await desktopApi.resolveDuplicate(keepPath, deletePaths, gentleUnlocked);
      blocked += result.blocked;
    }
    return blocked;
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
      let autoResolveBlocked = 0;
      if (summary.duplicateGroups.length > 0) {
        if (scanOptionsDraft.autoResolveDuplicates) {
          autoResolveBlocked = await autoResolveDuplicateGroups(
            summary.duplicateGroups,
            appState.gentleUnlocked ?? false
          );
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
      const blockedNote = autoResolveBlocked > 0
        ? ` · ${autoResolveBlocked} gentle-library duplicate(s) kept on disk (unlock to delete).`
        : "";
      setStatusMessage(buildScanStatusMessage(summary) + blockedNote);
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
        scanSourceMode === "saved"
          ? await desktopApi.scanLibraries(scanOptionsDraft)
          : await desktopApi.pickScanFolder(scanOptionsDraft);
      setLastScanSummary(summary);
      let autoResolveBlocked = 0;
      if (summary.duplicateGroups.length > 0) {
        if (scanOptionsDraft.autoResolveDuplicates) {
          autoResolveBlocked = await autoResolveDuplicateGroups(
            summary.duplicateGroups,
            appState?.gentleUnlocked ?? false
          );
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
      const blockedNote = autoResolveBlocked > 0
        ? ` · ${autoResolveBlocked} gentle-library duplicate(s) kept on disk (unlock to delete).`
        : "";
      setStatusMessage(buildScanStatusMessage(summary) + blockedNote);
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
