import React, { useEffect, useState } from "react";
import { GuardsChainSection } from "./GuardsChainCard";
import type {
  AppShellState,
  MetadataSettings,
  OrganizationSettings,
  PlayerSettings,
  SubtitleGenerationModel,
  SubtitleModelAvailability,
  SubtitleScanResult,
} from "../../../shared/contracts";
import {
  DEFAULT_ORGANIZATION_SETTINGS,
  ORGANIZATION_TEMPLATE_TOKENS,
} from "../../../shared/organizationTemplates";

interface OrganizationPreview {
  normalPath: string;
  gentlePath: string;
  fileName: string;
}

interface SettingsPageProps {
  appState: AppShellState;

  // metadata settings
  metadataDraft: MetadataSettings;
  setMetadataDraft: React.Dispatch<React.SetStateAction<MetadataSettings>>;
  onSaveMetadataSettings: () => Promise<void>;
  onBackfillPosters: () => Promise<void>;

  // organization settings
  organizationDraft: OrganizationSettings;
  setOrganizationDraft: React.Dispatch<React.SetStateAction<OrganizationSettings>>;
  themeModeDraft: "dark" | "light";
  setThemeModeDraft: React.Dispatch<React.SetStateAction<"dark" | "light">>;
  onSaveThemeMode: () => Promise<void>;
  organizationPreview: OrganizationPreview;
  onSaveOrganizationSettings: () => Promise<void>;
  applyOrganizationPreset: (preset: OrganizationSettings) => void;
  insertOrganizationToken: (token: string) => void;
  setFocusedOrganizationField: React.Dispatch<React.SetStateAction<keyof OrganizationSettings>>;

  // player settings (for the settings panel sliders)
  playerSettings: PlayerSettings;
  setPlayerSettings: React.Dispatch<React.SetStateAction<PlayerSettings>>;
  setPlayerVolume: (v: number) => void;
  onSavePlayerSettings: () => Promise<void>;

  // subtitle dirs
  subtitleScanRunning: boolean;
  subtitleScanResult: SubtitleScanResult | null;
  onAddSubtitleDir: () => Promise<void>;
  onRemoveSubtitleDir: (dir: string) => Promise<void>;
  onRunSubtitleScan: () => Promise<void>;

  // library path browse
  onPickLibraryFolder: () => Promise<string | undefined>;
}

export function SettingsPage({
  appState,
  metadataDraft,
  setMetadataDraft,
  onSaveMetadataSettings,
  onBackfillPosters,
  organizationDraft,
  setOrganizationDraft,
  themeModeDraft,
  setThemeModeDraft,
  onSaveThemeMode,
  organizationPreview,
  onSaveOrganizationSettings,
  applyOrganizationPreset,
  insertOrganizationToken,
  setFocusedOrganizationField,
  playerSettings,
  setPlayerSettings,
  setPlayerVolume,
  onSavePlayerSettings,
  subtitleScanRunning,
  subtitleScanResult,
  onAddSubtitleDir,
  onRemoveSubtitleDir,
  onRunSubtitleScan,
  onPickLibraryFolder
}: SettingsPageProps) {
  const whisperModels: SubtitleGenerationModel[] = ["small", "medium", "large-v3"];
  const [gentleShortcutDraft, setGentleShortcutDraft] = useState("");
  const [gentleSaveStatus, setGentleSaveStatus] = useState<string | null>(null);
  const [subtitleModelStatuses, setSubtitleModelStatuses] = useState<SubtitleModelAvailability[]>([]);
  const [isRefreshingSubtitleModels, setIsRefreshingSubtitleModels] = useState(false);

  const refreshSubtitleModelStatuses = async () => {
    setIsRefreshingSubtitleModels(true);
    try {
      const statuses = await Promise.all(
        whisperModels.map((model) => window.desktopApi.getSubtitleModelAvailability(model))
      );
      setSubtitleModelStatuses(statuses);
    } catch {
      setSubtitleModelStatuses(
        whisperModels.map((model) => ({
          model,
          available: false,
          modelPath: null,
          message: "Unable to check model status.",
        }))
      );
    } finally {
      setIsRefreshingSubtitleModels(false);
    }
  };

  useEffect(() => {
    // Load current shortcut on mount
    void window.desktopApi.getGentleShortcut().then(setGentleShortcutDraft);
    void refreshSubtitleModelStatuses();
  }, []);

  const handleSaveGentleShortcut = async () => {
    setGentleSaveStatus(null);
    try {
      const nextShortcut = gentleShortcutDraft.trim() || "Ctrl+Alt+D";
      await window.desktopApi.setGentleShortcut(gentleShortcutDraft.trim());
      window.dispatchEvent(
        new CustomEvent("mla:gentleShortcutChanged", {
          detail: nextShortcut,
        })
      );
      setGentleShortcutDraft(nextShortcut);
      setGentleSaveStatus("Saved!");
    } catch (e) {
      setGentleSaveStatus("Failed to save");
    }
  };
  return (
    <section className="page settings-page">
      <div className="settings-grid">

        {/* ── Web posters ── */}
        <div className="panel">
          <p className="eyebrow">Web posters</p>
          <h3>Online metadata</h3>
          <p className="subtle">
            The app now generates local poster frames from your video files first,
            then follows the metadata source profile below. Add a TMDB v4 read
            access token only if you want title-based fallback for files that do
            not have a usable video ID. Existing titles can be backfilled by
            running Scan saved folders.
          </p>
          <p className="subtle">
            Get your token from{" "}
            <a
              href="https://developer.themoviedb.org/docs/getting-started"
              rel="noreferrer"
              target="_blank"
            >
              TMDB Getting Started
            </a>
            , then paste the v4 read access token below.
          </p>
          <div className="settings-form">
            <label className="form-field">
              <span>TMDB v4 read access token</span>
              <input
                className="search-input"
                onChange={(event) =>
                  setMetadataDraft((current) => ({
                    ...current,
                    tmdbReadAccessToken: event.target.value,
                  }))
                }
                placeholder="Paste TMDB v4 read access token"
                type="password"
                value={metadataDraft.tmdbReadAccessToken}
              />
            </label>
            <label className="form-field">
              <span>Language</span>
              <input
                className="search-input"
                onChange={(event) =>
                  setMetadataDraft((current) => ({
                    ...current,
                    language: event.target.value,
                  }))
                }
                placeholder="en-US"
                type="text"
                value={metadataDraft.language}
              />
            </label>
            <label className="form-field">
              <span>Region</span>
              <input
                className="search-input"
                onChange={(event) =>
                  setMetadataDraft((current) => ({
                    ...current,
                    region: event.target.value,
                  }))
                }
                placeholder="US"
                type="text"
                value={metadataDraft.region}
              />
            </label>
            <label className="form-field">
              <span>Metadata source profile</span>
              <select
                className="search-input"
                onChange={(event) =>
                  setMetadataDraft((current) => ({
                    ...current,
                    sourceProfile: event.target.value as
                      | "auto"
                      | "adult-first"
                      | "mainstream-first"
                      | "local-only",
                  }))
                }
                value={metadataDraft.sourceProfile}
              >
                <option value="auto">Auto</option>
                <option value="adult-first">Adult-first</option>
                <option value="mainstream-first">Mainstream-first</option>
                <option value="local-only">Local-only</option>
              </select>
            </label>
            <label className="toggle-field">
              <input
                checked={metadataDraft.autoFetchWebPosters}
                onChange={(event) =>
                  setMetadataDraft((current) => ({
                    ...current,
                    autoFetchWebPosters: event.target.checked,
                  }))
                }
                type="checkbox"
              />
              <span>Auto-fetch web posters after each file import</span>
            </label>
            <label className="toggle-field">
              <input
                checked={metadataDraft.tmdbNonCommercialUse}
                onChange={(event) =>
                  setMetadataDraft((current) => ({
                    ...current,
                    tmdbNonCommercialUse: event.target.checked,
                  }))
                }
                type="checkbox"
              />
                <span>I will use TMDB only under its free non-commercial terms and provide attribution</span>
              </label>
            <p className="subtle">
              Auto keeps JAV-style ID lookups first when the app can detect one,
              then falls back to title-based search. Mainstream-first prefers
              title search first, while local-only skips all online metadata.
              TMDB fallback is disabled until the non-commercial checkbox is enabled.
            </p>
            <div className="inline-actions">
              <button
                className="primary-button"
                onClick={() => void onSaveMetadataSettings()}
                type="button"
              >
                Save metadata settings
              </button>
              <button
                className="secondary-button"
                onClick={() => void onBackfillPosters()}
                type="button"
              >
                Refresh missing posters
              </button>
            </div>
          </div>
          <p className="subtle">
            TMDB is used only for the optional title-based fallback and is not endorsed
            or certified by TMDB. Use TMDB only for content that complies with their
            terms and attribution requirements.
          </p>
        </div>

        {/* ── Naming setup ── */}
        <div className="panel">
          <p className="eyebrow">Naming setup</p>
          <h3>Choose your folder and file structure</h3>
          <p className="subtle">
            Use the tokens below to build your own layout. Save once, then
            new imports and future library moves will follow it automatically.
          </p>
          <div className="settings-form">
            <div className="inline-actions">
              <button
                className="secondary-button"
                onClick={() => applyOrganizationPreset({ ...DEFAULT_ORGANIZATION_SETTINGS })}
                type="button"
              >
                Use default
              </button>
              <button
                className="ghost-button"
                onClick={() =>
                  applyOrganizationPreset({
                    normalPathTemplate: "{dvdId} {title}",
                    gentlePathTemplate: "{studio}/{actress}/{dvdId} {title}",
                    fileNameTemplate: "{dvdId} {title}",
                    normalLibraryPath: organizationDraft.normalLibraryPath,
                    gentleLibraryPath: organizationDraft.gentleLibraryPath,
                  })
                }
                type="button"
              >
                ID + title preset
              </button>
            </div>

            <div className="token-bank">
              {ORGANIZATION_TEMPLATE_TOKENS.map((item) => (
                <button
                  className="token-chip"
                  key={item.token}
                  onClick={() => insertOrganizationToken(item.token)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>

            <p className="subtle">
              Click a token to insert it into the field you last selected.
            </p>

            <label className="form-field">
              <span>Normal path template</span>
              <input
                className="search-input template-input"
                onChange={(event) =>
                  setOrganizationDraft((current) => ({
                    ...current,
                    normalPathTemplate: event.target.value,
                  }))
                }
                onFocus={() => setFocusedOrganizationField("normalPathTemplate")}
                placeholder="{title} ({year})"
                type="text"
                value={organizationDraft.normalPathTemplate}
              />
            </label>

            <label className="form-field">
              <span>Gentle path template</span>
              <input
                className="search-input template-input"
                onChange={(event) =>
                  setOrganizationDraft((current) => ({
                    ...current,
                    gentlePathTemplate: event.target.value,
                  }))
                }
                onFocus={() => setFocusedOrganizationField("gentlePathTemplate")}
                placeholder="{studio}/{actress}/{dvdId}"
                type="text"
                value={organizationDraft.gentlePathTemplate}
              />
            </label>

            <label className="form-field">
              <span>File name template</span>
              <input
                className="search-input template-input"
                onChange={(event) =>
                  setOrganizationDraft((current) => ({
                    ...current,
                    fileNameTemplate: event.target.value,
                  }))
                }
                onFocus={() => setFocusedOrganizationField("fileNameTemplate")}
                placeholder="{dvdId}"
                type="text"
                value={organizationDraft.fileNameTemplate}
              />
            </label>

            <div className="template-preview-card">
              <span className="label">Preview with the current selected title</span>
              <code>Normal: {organizationPreview.normalPath}</code>
              <code>Gentle: {organizationPreview.gentlePath}</code>
              <code>
                Files: {organizationPreview.fileName}.mp4 / {organizationPreview.fileName}.nfo /{" "}
                {organizationPreview.fileName}.srt
              </code>
            </div>

            <div className="inline-actions">
              <button
                className="primary-button"
                onClick={() => void onSaveOrganizationSettings()}
                type="button"
              >
                Save naming setup
              </button>
            </div>
          </div>
        </div>

        {/* ── Library storage ── */}
        <div className="panel">
          <p className="eyebrow">Library storage</p>
          <h3>Where files are kept</h3>
          <p className="subtle">
            Set a base folder for each library. Files will be moved here when "Move / Rename"
            is enabled during scan. Supports internal drives and external drives.
            Leave blank to keep files in their original location.
          </p>
          <div className="settings-form">
            <div className="form-field">
              <span>Normal library base path</span>
              <div className="path-picker-row">
                <input
                  className="search-input"
                  onChange={(event) =>
                    setOrganizationDraft((current) => ({
                      ...current,
                      normalLibraryPath: event.target.value,
                    }))
                  }
                  placeholder="e.g. D:\Library\Normal or leave blank"
                  type="text"
                  value={organizationDraft.normalLibraryPath}
                />
                <button
                  className="secondary-button"
                  onClick={async () => {
                    const picked = await onPickLibraryFolder();
                    if (picked) {
                      setOrganizationDraft((current) => ({
                        ...current,
                        normalLibraryPath: picked,
                      }));
                    }
                  }}
                  type="button"
                >
                  Browse…
                </button>
                {organizationDraft.normalLibraryPath && (
                  <button
                    className="ghost-button"
                    onClick={() =>
                      setOrganizationDraft((current) => ({
                        ...current,
                        normalLibraryPath: "",
                      }))
                    }
                    type="button"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            <div className="form-field">
              <span>Gentle library base path</span>
              <div className="path-picker-row">
                <input
                  className="search-input"
                  onChange={(event) =>
                    setOrganizationDraft((current) => ({
                      ...current,
                      gentleLibraryPath: event.target.value,
                    }))
                  }
                  placeholder="e.g. E:\Library\Gentle or leave blank"
                  type="text"
                  value={organizationDraft.gentleLibraryPath}
                />
                <button
                  className="secondary-button"
                  onClick={async () => {
                    const picked = await onPickLibraryFolder();
                    if (picked) {
                      setOrganizationDraft((current) => ({
                        ...current,
                        gentleLibraryPath: picked,
                      }));
                    }
                  }}
                  type="button"
                >
                  Browse…
                </button>
                {organizationDraft.gentleLibraryPath && (
                  <button
                    className="ghost-button"
                    onClick={() =>
                      setOrganizationDraft((current) => ({
                        ...current,
                        gentleLibraryPath: "",
                      }))
                    }
                    type="button"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            <div className="inline-actions">
              <button
                className="primary-button"
                onClick={() => void onSaveOrganizationSettings()}
                type="button"
              >
                Save library paths
              </button>
            </div>
          </div>
        </div>


        {/* ── Gentle mode security ── */}
        <div className="panel">
          <p className="eyebrow">Gentle mode security</p>
          <h3>In-app unlock shortcut</h3>
          <div className="settings-form">
            <label>
              Shortcut key
              <input
                type="text"
                placeholder="Ctrl+Alt+D"
                value={gentleShortcutDraft}
                onChange={e => setGentleShortcutDraft(e.target.value)}
              />
            </label>
            <p className="subtle">
              This shortcut only works while MLA+ is focused. It does not register outside the app.
            </p>
            <div className="inline-actions">
              <button
                className="primary-button"
                type="button"
                onClick={handleSaveGentleShortcut}
              >
                Save unlock shortcut
              </button>
              {gentleSaveStatus && <span style={{ marginLeft: 12 }}>{gentleSaveStatus}</span>}
            </div>
          </div>
        </div>

        <div className="panel">
          <p className="eyebrow">Whisper models</p>
          <h3>Sub-Gen model cache</h3>
          <p className="subtle">
            Check which local Whisper models are ready before starting subtitle generation.
          </p>
          <div className="inline-actions" style={{ marginBottom: "0.75rem" }}>
            <button
              className="secondary-button"
              disabled={isRefreshingSubtitleModels}
              onClick={() => void refreshSubtitleModelStatuses()}
              type="button"
            >
              {isRefreshingSubtitleModels ? "Refreshing..." : "Refresh model status"}
            </button>
          </div>
          <div className="home-status-list" style={{ marginTop: 0 }}>
            {subtitleModelStatuses.map((status) => (
              <div key={status.model}>
                <strong>{status.model}</strong>
                <span>
                  {status.available ? "Installed" : status.message ?? "Not installed"}
                </span>
                {status.modelPath && (
                  <span>{status.modelPath}</span>
                )}
              </div>
            ))}
            {subtitleModelStatuses.length === 0 && (
              <div>
                <strong>Status</strong>
                <span>{isRefreshingSubtitleModels ? "Checking models..." : "No model status loaded yet."}</span>
              </div>
            )}
          </div>
        </div>

        {/* ── Appearance ── */}
        <div className="panel">
          <p className="eyebrow">Appearance</p>
          <h3>Theme</h3>
          <div className="settings-form">
            <label className="toggle-field">
              <input
                checked={themeModeDraft === "light"}
                onChange={(event) => setThemeModeDraft(event.target.checked ? "light" : "dark")}
                type="checkbox"
              />
              <span>Use light theme</span>
            </label>
            <div className="inline-actions">
              <button
                className="primary-button"
                onClick={() => void onSaveThemeMode()}
                type="button"
              >
                Save theme
              </button>
            </div>
          </div>
        </div>

        {/* ── Built-in player ── */}
        <div className="panel">
          <p className="eyebrow">Built-in player</p>
          <h3>Player settings</h3>
          <div className="settings-form">
            <label>
              Default volume ({Math.round(playerSettings.defaultVolume * 100)}%)
              <input
                type="range" min={0} max={1} step={0.05}
                value={playerSettings.defaultVolume}
                onChange={(e) =>
                  setPlayerSettings((s) => ({ ...s, defaultVolume: Number(e.target.value) }))
                }
              />
            </label>
            <label>
              Subtitle font size ({playerSettings.subtitleFontSize}px)
              <input
                type="range" min={12} max={48} step={1}
                value={playerSettings.subtitleFontSize}
                onChange={(e) =>
                  setPlayerSettings((s) => ({ ...s, subtitleFontSize: Number(e.target.value) }))
                }
              />
            </label>
            <label>
              Subtitle colour
              <input
                type="color" value={playerSettings.subtitleColor}
                onChange={(e) => setPlayerSettings((s) => ({ ...s, subtitleColor: e.target.value }))}
              />
            </label>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox" checked={playerSettings.autoPlayNext}
                onChange={(e) => setPlayerSettings((s) => ({ ...s, autoPlayNext: e.target.checked }))}
              />
              Auto-play next movie
            </label>
            <label style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input
                type="checkbox" checked={playerSettings.rememberPosition}
                onChange={(e) => setPlayerSettings((s) => ({ ...s, rememberPosition: e.target.checked }))}
              />
              Remember playback position
            </label>
            <label>
              Video filter preset
              <select
                value={playerSettings.videoFilterPreset}
                onChange={(e) =>
                  setPlayerSettings((s) => ({
                    ...s,
                    videoFilterPreset: e.target.value as PlayerSettings["videoFilterPreset"],
                  }))
                }
              >
                <option value="none">None</option>
                <option value="vivid">Vivid</option>
                <option value="warm">Warm</option>
                <option value="cool">Cool</option>
                <option value="mono">Mono</option>
                <option value="sepia">Sepia</option>
              </select>
            </label>
            <label>
              Filter strength ({playerSettings.videoFilterStrength}%)
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={playerSettings.videoFilterStrength}
                onChange={(e) =>
                  setPlayerSettings((s) => ({ ...s, videoFilterStrength: Number(e.target.value) }))
                }
              />
            </label>
            <div className="inline-actions">
              <button
                className="primary-button"
                type="button"
                onClick={async () => {
                  await onSavePlayerSettings();
                  setPlayerVolume(playerSettings.defaultVolume);
                }}
              >
                Save player settings
              </button>
            </div>
          </div>
        </div>

        {/* ── Guards chain ── */}
        <GuardsChainSection />

        {/* ── System ── */}
        <div className="panel">
          <p className="eyebrow">System</p>
          <h3>App state</h3>
          <ul className="plain-list">
            <li>Platform: {appState.platform}</li>
            <li>Version: {appState.version}</li>
            <li>Gentle unlocked: {appState.gentleUnlocked ? "Yes" : "No"}</li>
            <li>Default in-app unlock shortcut: Ctrl+Alt+D</li>
          </ul>
        </div>

        {/* ── Library roots ── */}
        <div className="panel">
          <p className="eyebrow">Library roots</p>
          <h3>Normal</h3>
          <ul className="plain-list">
            {appState.roots.normal.length > 0 ? (
              appState.roots.normal.map((root) => <li key={root}>{root}</li>)
            ) : (
              <li>No normal roots configured.</li>
            )}
          </ul>
          <h3>Gentle</h3>
          <ul className="plain-list">
            {appState.roots.gentle.length > 0 ? (
              appState.roots.gentle.map((root) => <li key={root}>{root}</li>)
            ) : (
              <li>No gentle roots configured.</li>
            )}
          </ul>
        </div>

        {/* ── Subtitle Directories ── */}
        <div className="panel">
          <p className="eyebrow">Subtitle folders</p>
          <p className="subtle" style={{ marginBottom: "0.75rem" }}>
            Add folders that contain .srt / .ass / .vtt files. "Scan subtitles" will match them
            to movies in your library by video ID and import them automatically.
          </p>
          <ul className="plain-list" style={{ marginBottom: "0.75rem" }}>
            {appState.subtitleDirs.length > 0 ? (
              appState.subtitleDirs.map((dir) => (
                <li key={dir} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ flex: 1, wordBreak: "break-all" }}>{dir}</span>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => void onRemoveSubtitleDir(dir)}
                  >✕</button>
                </li>
              ))
            ) : (
              <li className="muted-inline">No subtitle directories configured.</li>
            )}
          </ul>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void onAddSubtitleDir()}
            >
              + Add Directory
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={subtitleScanRunning || appState.subtitleDirs.length === 0}
              onClick={() => void onRunSubtitleScan()}
            >
              {subtitleScanRunning ? "Scanning…" : "Scan subtitles"}
            </button>
          </div>
          {subtitleScanResult && (
            <div className="subtitle-scan-result">
              <strong>Scan complete</strong> — {subtitleScanResult.total} files found ·{" "}
              <span style={{ color: "var(--success, #4caf50)" }}>{subtitleScanResult.matched} matched</span> ·{" "}
              {subtitleScanResult.unmatched} unmatched · {subtitleScanResult.skipped} skipped
            </div>
          )}
        </div>

        {/* ── Architecture ── */}
        <div className="panel">
          <p className="eyebrow">Architecture</p>
          <h3>Main process responsibilities</h3>
          <ul className="plain-list">
            <li>Scan folders, rename, and move files</li>
            <li>Own SQLite source-of-truth records</li>
            <li>Fetch poster metadata from the web as a second step</li>
            <li>Expose only secure IPC methods through preload</li>
          </ul>
        </div>

      </div>
    </section>
  );
}
