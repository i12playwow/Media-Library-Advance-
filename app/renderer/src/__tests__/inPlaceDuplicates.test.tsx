import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useScanHandlers } from "../hooks/useScanHandlers";
import { DEFAULT_SCAN_OPTIONS } from "../../../services/libraryScanner";

describe("in-place duplicate protection", () => {
  for (const action of ["handleScanSaved", "handleConfirmScanOptions"] as const) {
    for (const cleanup of [false, true]) {
    it(`${action} cleans duplicates only when explicitly selected: ${cleanup}`, async () => {
      const summary = { imported: 1, discovered: 2, skipped: 1, errors: [],
        subtitleSearchLogs: [], invalidFiles: [], cancelled: false,
        scannedRoots: { normal: ["media"], gentle: [] },
        duplicateGroups: [{ key: "sample", title: "Sample", videoId: null,
          files: [{ path: "a.mp4", autoSelected: true }, { path: "b.mp4" }] }] };
      const state = { roots: { normal: ["media"], gentle: [] }, gentleUnlocked: false };
      const api = { scanLibraries: vi.fn().mockResolvedValue(summary),
        pickScanFolder: vi.fn().mockResolvedValue(summary),
        resolveDuplicate: vi.fn().mockResolvedValue({ blocked: 0 }), getAppState: vi.fn().mockResolvedValue(state) };
      const props = { desktopApi: api, appState: state, isScanning: false,
        scanOptionsDraft: { ...DEFAULT_SCAN_OPTIONS, moveRename: false, autoResolveDuplicates: cleanup },
        deferredSearch: "", refreshMovies: vi.fn().mockResolvedValue(undefined),
        initFromAppState: vi.fn(), setScanOptionsDraft: vi.fn(), setAppState: vi.fn(),
        setStatusMessage: vi.fn(), setLastScanSummary: vi.fn(), setDuplicateGroups: vi.fn(),
        setDuplicateSelections: vi.fn(), setShowScanOptionsPrompt: vi.fn(), setPendingScanMode: vi.fn() };
      const { result } = renderHook(() => useScanHandlers(props as unknown as Parameters<typeof useScanHandlers>[0]));
      await act(async () => { await result.current[action](); });
      if (cleanup) {
        expect(api.resolveDuplicate).toHaveBeenCalledExactlyOnceWith("a.mp4", ["b.mp4"], false);
        expect(props.setDuplicateGroups).not.toHaveBeenCalled();
      } else {
        expect(api.resolveDuplicate).not.toHaveBeenCalled();
        expect(props.setDuplicateGroups).toHaveBeenCalledWith(summary.duplicateGroups);
      }
      expect(props.refreshMovies).toHaveBeenCalled();
    });
    }
  }
});
