import { useState } from "react";
import type {
  AppShellState,
  MetadataSettings,
  OrganizationSettings,
  ScanAutomationOptions,
} from "../../../shared/contracts";
import {
  DEFAULT_ORGANIZATION_SETTINGS,
} from "../../../shared/organizationTemplates";

type DesktopApi = NonNullable<typeof window.desktopApi>;

const defaultMetadataDraft: MetadataSettings = {
  tmdbReadAccessToken: "",
  language: "en-US",
  region: "US",
  autoFetchWebPosters: true,
  tmdbNonCommercialUse: false,
  sourceProfile: "auto",
};

const defaultOrganizationDraft: OrganizationSettings = {
  ...DEFAULT_ORGANIZATION_SETTINGS,
};

export const defaultScanOptions: ScanAutomationOptions = {
  importOnlyCompleteVideos: true,
  importBetterQuality: true,
  autoResolveDuplicates: false,
  moveRename: false,
  copyToLibrary: false,
  scanAllSubfolders: true,
  resolveLongPath: true,
  autoConvertToMp4: false,
  autoMatchSubtitle: true,
  autoDownloadSubtitleFromSubtitleCat: true,
  preferredSubtitleLanguage: "zh-hans",
  addToNormalModeLibrary: true,
  addToGentleModeLibrary: false,
};

interface UseSettingsOptions {
  desktopApi: DesktopApi | undefined;
  /** Called after any save that returns a new AppShellState */
  onStateChange: (state: AppShellState) => void;
  /** Called to surface status/error messages to the sidebar */
  onStatus: (message: string) => void;
}

export function useSettings({ desktopApi, onStateChange, onStatus }: UseSettingsOptions) {
  const [metadataDraft, setMetadataDraft] = useState<MetadataSettings>(defaultMetadataDraft);
  const [organizationDraft, setOrganizationDraft] =
    useState<OrganizationSettings>(defaultOrganizationDraft);
  const [themeModeDraft, setThemeModeDraft] = useState<"dark" | "light">("dark");
  const [focusedOrganizationField, setFocusedOrganizationField] =
    useState<keyof OrganizationSettings>("gentlePathTemplate");
  const [scanOptionsDraft, setScanOptionsDraft] =
    useState<ScanAutomationOptions>(defaultScanOptions);

  function initFromAppState(state: AppShellState): void {
    setMetadataDraft(state.metadataSettings);
    setOrganizationDraft(state.organizationSettings);
    setThemeModeDraft(state.themeMode);
  }

  async function handleSaveThemeMode(): Promise<void> {
    if (!desktopApi) {
      onStatus("Desktop bridge unavailable. Restart MLA+ and try again.");
      return;
    }

    const nextState = await desktopApi.setThemeMode(themeModeDraft);
    onStateChange(nextState);
    setThemeModeDraft(nextState.themeMode);
    onStatus(`Theme saved. UI is now using ${nextState.themeMode} mode.`);
  }

  async function handleSaveMetadataSettings(): Promise<void> {
    if (!desktopApi) {
      onStatus("Desktop bridge unavailable. Restart MLA+ and try again.");
      return;
    }

    const normalized: MetadataSettings = {
      tmdbReadAccessToken: metadataDraft.tmdbReadAccessToken.trim(),
      language: metadataDraft.language.trim() || "en-US",
      region: metadataDraft.region.trim() || "US",
      autoFetchWebPosters: metadataDraft.autoFetchWebPosters,
      tmdbNonCommercialUse: metadataDraft.tmdbNonCommercialUse,
      sourceProfile:
        metadataDraft.sourceProfile === "adult-first" ||
        metadataDraft.sourceProfile === "mainstream-first" ||
        metadataDraft.sourceProfile === "local-only"
          ? metadataDraft.sourceProfile
          : "auto",
    };

    const nextState = await desktopApi.saveMetadataSettings(normalized);
    onStateChange(nextState);
    setMetadataDraft(nextState.metadataSettings);
    setOrganizationDraft(nextState.organizationSettings);
    onStatus(
      normalized.sourceProfile === "local-only"
        ? "Metadata settings saved. The app will use local posters only."
        : normalized.sourceProfile === "mainstream-first"
        ? "Metadata settings saved. The app will prefer title-based matches first."
        : normalized.tmdbReadAccessToken && normalized.tmdbNonCommercialUse
        ? "Poster settings saved. Video-ID lookup is active, and TMDB title fallback is enabled."
        : "Poster settings saved. TMDB fallback remains off until you enable the non-commercial use checkbox."
    );
  }

  async function handleSaveOrganizationSettings(): Promise<void> {
    if (!desktopApi) {
      onStatus("Desktop bridge unavailable. Restart MLA+ and try again.");
      return;
    }

    const normalized: OrganizationSettings = {
      normalPathTemplate:
        organizationDraft.normalPathTemplate.trim() ||
        DEFAULT_ORGANIZATION_SETTINGS.normalPathTemplate,
      gentlePathTemplate:
        organizationDraft.gentlePathTemplate.trim() ||
        DEFAULT_ORGANIZATION_SETTINGS.gentlePathTemplate,
      fileNameTemplate:
        organizationDraft.fileNameTemplate.trim() ||
        DEFAULT_ORGANIZATION_SETTINGS.fileNameTemplate,
      normalLibraryPath: organizationDraft.normalLibraryPath,
      gentleLibraryPath: organizationDraft.gentleLibraryPath,
    };

    const nextState = await desktopApi.saveOrganizationSettings(normalized);
    onStateChange(nextState);
    setOrganizationDraft(nextState.organizationSettings);
    setMetadataDraft(nextState.metadataSettings);
    onStatus("Naming setup saved. New imports and library moves will use this structure.");
  }

  function insertOrganizationToken(token: string): void {
    setOrganizationDraft((current) => {
      const currentValue = current[focusedOrganizationField];
      const spacer =
        currentValue.length > 0 && !/[\\/ ]$/.test(currentValue) ? " " : "";
      return {
        ...current,
        [focusedOrganizationField]: `${currentValue}${spacer}${token}`.trimStart(),
      };
    });
  }

  function applyOrganizationPreset(preset: OrganizationSettings): void {
    setOrganizationDraft(preset);
  }

  return {
    // State
    metadataDraft, setMetadataDraft,
    organizationDraft, setOrganizationDraft,
    themeModeDraft, setThemeModeDraft,
    focusedOrganizationField, setFocusedOrganizationField,
    scanOptionsDraft, setScanOptionsDraft,
    // Functions
    initFromAppState,
    handleSaveThemeMode,
    handleSaveMetadataSettings,
    handleSaveOrganizationSettings,
    insertOrganizationToken,
    applyOrganizationPreset,
  };
}
