import type { LibraryMode, OrganizationSettings, ScanAutomationOptions } from "../../../shared/contracts";

interface ScanOptionsDialogProps {
  pendingScanMode: LibraryMode;
  organizationDraft: OrganizationSettings;
  scanOptionsDraft: ScanAutomationOptions;
  scanSourceMode: "saved" | "folder";
  onChangeScanOption: <K extends keyof ScanAutomationOptions>(key: K, value: ScanAutomationOptions[K]) => void;
  onChangeScanSource: (mode: "saved" | "folder") => void;
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
  const libraryPath =
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
              Choose a source, review the destination, then confirm the scan options before import starts.
            </p>
          </div>
          <div className="scan-modal-badges">
            <span>{scanSourceMode === "saved" ? "Saved folders" : "New folder"}</span>
            <span>{pendingScanMode === "normal" ? "Normal" : "Gentle"}</span>
          </div>
        </div>

        {/* ── SECTION 0: Scan source ── */}
        <div className="scan-section">
          <p className="scan-section-label">🧭 Scan source</p>
          <div className="options-grid">
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
            {libraryPath || (
              <span className="muted-inline">
                Not set. Imported files stay under the scanned root unless organization options move them.
                <br />
                <small>Set a library path in Settings {">"} Library storage</small>
              </span>
            )}
            {libraryPath && (
              <span className="path-chip">{libraryPath}</span>
            )}
          </div>
        </div>

        {/* ── SECTION 2: File handling ── */}
        <div className="scan-section">
          <p className="scan-section-label">File handling</p>
          <p className="subtle" style={{ margin: "0.25rem 0 0" }}>
            {scanSourceMode === "saved"
              ? "Saved folders are rescanned using the current import options. Files may still be reorganized when move, rename, long-path, or conversion options apply."
              : "Choosing a new folder starts an import from that folder. Files may still be reorganized when move, rename, long-path, or conversion options apply."}
          </p>
        </div>

        {/* ── SECTION 3: Scan options ── */}
        <div className="scan-section">
          <p className="scan-section-label">⚙️ Scan options</p>
          <div className="scan-options-grid">
            <label className="toggle-field">
              <input
                checked={scanOptionsDraft.importOnlyCompleteVideos}
                onChange={(e) => onChangeScanOption("importOnlyCompleteVideos", e.target.checked)}
                type="checkbox"
              />
              <span>Import only complete videos (20 min+)</span>
            </label>
            <label className="toggle-field">
              <input
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
              <span>Auto-resolve duplicates and keep the best file</span>
            </label>
            <label className="toggle-field">
              <input
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
              <span>Resolve long file paths</span>
            </label>
            <label className="toggle-field">
              <input
                checked={scanOptionsDraft.autoConvertToMp4}
                onChange={(e) => onChangeScanOption("autoConvertToMp4", e.target.checked)}
                type="checkbox"
              />
              <span>Auto-convert to MP4</span>
            </label>
            <label className="toggle-field">
              <input
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
            {scanSourceMode === "saved" ? "Rescan saved folders" : "Scan chosen folder"}
          </button>
          <button className="ghost-button" onClick={onClose} type="button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
