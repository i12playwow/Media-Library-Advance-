import type { LibraryMode, OrganizationSettings, ScanAutomationOptions } from "../../../shared/contracts";

interface ScanOptionsDialogProps {
  pendingScanMode: LibraryMode;
  organizationDraft: OrganizationSettings;
  scanOptionsDraft: ScanAutomationOptions;
  scanSourceMode: "saved" | "folder" | "system";
  onChangeScanOption: <K extends keyof ScanAutomationOptions>(key: K, value: ScanAutomationOptions[K]) => void;
  onChangeScanSource: (mode: "saved" | "folder" | "system") => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function ScanOptionsDialog({
  pendingScanMode,
  organizationDraft,
  scanOptionsDraft,
  scanSourceMode,
  onChangeScanOption,
  onChangeScanSource,
  onConfirm,
  onClose,
}: ScanOptionsDialogProps) {
  const systemScan = scanSourceMode === "system";
  const libraryPath = systemScan ? "Original locations on connected drives" :
    pendingScanMode === "normal"
      ? organizationDraft.normalLibraryPath
      : organizationDraft.gentleLibraryPath;

  return (
    <div className="modal-backdrop">
      <div className="modal-card scan-modal">
        <div className="scan-modal-header">
          <div>
            <p className="eyebrow">Scan</p>
            <h3>{pendingScanMode === "normal" ? "Normal mode" : "Gentle mode"} setup</h3>
            <p className="subtle">
              JAV-only scan: files without a recognizable movie code in the filename or immediate folder are skipped. Original files are kept.
            </p>
          </div>
          <div className="scan-modal-badges">
            <span>{systemScan ? "Whole system" : scanSourceMode === "saved" ? "Saved folders" : "New folder"}</span>
            <span>{pendingScanMode === "normal" ? "Normal" : "Gentle"}</span>
          </div>
        </div>

        {/* ── SECTION 0: Scan source ── */}
        <div className="scan-section">
          <p className="scan-section-label">🧭 Scan source</p>
          <div className="options-grid">
            <label className="toggle-field">
              <input checked={scanSourceMode === "system"} type="radio" name="scan-source" onChange={() => {
                onChangeScanSource("system");
                onChangeScanOption("moveRename", false);
                onChangeScanOption("copyToLibrary", false);
                onChangeScanOption("autoResolveDuplicates", false);
                onChangeScanOption("autoConvertToMp4", false);
                onChangeScanOption("autoDownloadSubtitleFromSubtitleCat", false);
                onChangeScanOption("importOnlyCompleteVideos", true);
                onChangeScanOption("importBetterQuality", false);

                onChangeScanOption("scanAllSubfolders", true);
                onChangeScanOption("autoMatchSubtitle", true);
              }} />
              <span>Whole system — connected drives, no moving</span>
            </label>
            <label className="toggle-field">
              <input
                checked={scanSourceMode === "saved"}
                onChange={() => onChangeScanSource("saved")}
                type="radio"
                name="scan-source"
              />
              <span>Scan saved library folders</span>
            </label>
            <label className="toggle-field">
              <input
                checked={scanSourceMode === "folder"}
                onChange={() => onChangeScanSource("folder")}
                type="radio"
                name="scan-source"
              />
              <span>Choose a new folder</span>
            </label>
          </div>
        </div>

        {/* ── SECTION 1: Library destination ── */}
        <div className="scan-section">
          <p className="scan-section-label">Library folder destination</p>
          <div className="scan-library-path">
            {!scanOptionsDraft.moveRename ? (
              <span>Original video locations — no destination folder needed</span>
            ) : libraryPath || (
              <span className="muted-inline">
                Not set. Imported files stay under the scanned root unless organization options move them.
                <br />
                <small>Set a library path in Settings {">"} Library storage</small>
              </span>
            )}
            {scanOptionsDraft.moveRename && libraryPath && (
              <span className="path-chip">{libraryPath}</span>
            )}
          </div>
        </div>

        {/* ── SECTION 2: File handling ── */}
        <div className="scan-section">
          <p className="scan-section-label">File handling</p>
          <p className="subtle" style={{ margin: "0.25rem 0 0" }}>
            {scanOptionsDraft.moveRename
              ? "Videos and matched subtitles will be moved into your library folder structure."
              : "Videos and local subtitles stay at their original paths. Optional MP4 conversion creates a new file and keeps the original. No renaming or poster sidecars. Duplicate cleanup runs only if you select it below. Optional subtitle downloads add a new file beside the video."}
          </p>
        </div>

        {/* ── SECTION 3: Scan options ── */}
        <div className="scan-section">
          <p className="scan-section-label">⚙️ Scan options</p>
          <div className="scan-options-grid">
            <label className="toggle-field">
              <input
                disabled={systemScan}
                checked={!scanOptionsDraft.moveRename}
                onChange={() => onChangeScanOption("moveRename", false)}
                type="radio"
                name="import-placement"
              />
              <span>
                Import in place — keep files in their original folders
              </span>
            </label>
            <label className="toggle-field">
              <input
                disabled={systemScan}
                checked={scanOptionsDraft.moveRename}
                onChange={() => onChangeScanOption("moveRename", true)}
                type="radio"
                name="import-placement"
              />
              <span>Move and rename files into library folders</span>
            </label>
            <label className="toggle-field">
              <input
                checked={scanOptionsDraft.importOnlyCompleteVideos}
                onChange={(e) => onChangeScanOption("importOnlyCompleteVideos", e.target.checked)}
                type="checkbox"
              />
              <span>Skip unfinished or damaged videos (checks file stability and video data)</span>
            </label>
            <label className="toggle-field">
              <input
                disabled={systemScan}
                checked={scanOptionsDraft.importBetterQuality}
                onChange={(e) => onChangeScanOption("importBetterQuality", e.target.checked)}
                type="checkbox"
              />
              <span>Prefer better quality</span>
            </label>
            <label className="toggle-field">
              <input
                checked={scanOptionsDraft.autoResolveDuplicates}
                onChange={(e) => onChangeScanOption("autoResolveDuplicates", e.target.checked)}
                type="checkbox"
              />
              <span>{systemScan ? "Auto-resolve duplicate videos — keep highest resolution in library; keep all files on disk" : "Auto-resolve duplicates and keep the best file (deletes lower-quality duplicates)"}</span>
            </label>
            <label className="toggle-field">
              <input
                disabled={systemScan}
                checked={scanOptionsDraft.scanAllSubfolders}
                onChange={(e) => onChangeScanOption("scanAllSubfolders", e.target.checked)}
                type="checkbox"
              />
              <span>Scan all subfolders</span>
            </label>
            <label className="toggle-field">
              <input
                checked={scanOptionsDraft.resolveLongPath}
                onChange={(e) => onChangeScanOption("resolveLongPath", e.target.checked)}
                type="checkbox"
              />
              <span>{systemScan ? "Resolve long file paths for new MP4 and subtitle files (keep originals unchanged)" : "Resolve long file paths (applies when moving or renaming)"}</span>
            </label>
            <label className="toggle-field">
              <input
                checked={scanOptionsDraft.autoConvertToMp4}
                onChange={(e) => onChangeScanOption("autoConvertToMp4", e.target.checked)}
                type="checkbox"
              />
              <span>Convert to MP4 — keep original file</span>
            </label>
            <label className="toggle-field">
              <input
                disabled={systemScan}
                checked={scanOptionsDraft.autoMatchSubtitle}
                onChange={(e) => onChangeScanOption("autoMatchSubtitle", e.target.checked)}
                type="checkbox"
              />
              <span>Auto-match local subtitle files</span>
            </label>
            <label className="toggle-field">
              <input
                checked={scanOptionsDraft.autoDownloadSubtitleFromSubtitleCat}
                onChange={(e) =>
                  onChangeScanOption("autoDownloadSubtitleFromSubtitleCat", e.target.checked)
                }
                type="checkbox"
              />
              <span>Download from SubtitleCat when no local subtitle matches</span>
            </label>
            <label className="toggle-field">
              <span>Preferred SubtitleCat language</span>
              <select
                value={scanOptionsDraft.preferredSubtitleLanguage}
                onChange={(e) =>
                  onChangeScanOption("preferredSubtitleLanguage", e.target.value as ScanAutomationOptions["preferredSubtitleLanguage"])
                }
                disabled={!scanOptionsDraft.autoDownloadSubtitleFromSubtitleCat}
              >
                <option value="zh-hans">Chinese Simplified</option>
                <option value="zh-hant">Chinese Traditional</option>
                <option value="zh">Chinese</option>
                <option value="en">English</option>
                <option value="ja">Japanese</option>
                <option value="ko">Korean</option>
                <option value="fr">French</option>
                <option value="es">Spanish</option>
                <option value="de">German</option>
                <option value="pt">Portuguese</option>
                <option value="th">Thai</option>
                <option value="vi">Vietnamese</option>
                <option value="id">Indonesian</option>
                <option value="ar">Arabic</option>
                <option value="ru">Russian</option>
                <option value="it">Italian</option>
              </select>
            </label>
            <label className="toggle-field">
              <input
                checked={scanOptionsDraft.addToNormalModeLibrary}
                onChange={(e) =>
                  onChangeScanOption("addToNormalModeLibrary", e.target.checked)
                }
                type="checkbox"
              />
              <span>Add to Normal Mode</span>
            </label>
            <label className="toggle-field">
              <input
                checked={scanOptionsDraft.addToGentleModeLibrary}
                onChange={(e) =>
                  onChangeScanOption("addToGentleModeLibrary", e.target.checked)
                }
                type="checkbox"
              />
              <span>Add to Gentle Mode</span>
            </label>
          </div>
        </div>

        <div className="inline-actions scan-modal-actions">
          <button className="primary-button" onClick={onConfirm} type="button">
            {scanSourceMode === "system" ? "Scan whole system (no moving)" : scanSourceMode === "saved" ? "Rescan saved folders" : "Scan chosen folder"}
          </button>
          <button className="ghost-button" onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
