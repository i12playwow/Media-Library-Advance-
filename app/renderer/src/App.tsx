import React, {
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type {
  AppPage,
  AppShellState,
  LibraryMode,
  MovieRecord,
} from "../../shared/contracts";
import { AppSidebar } from "./components/AppSidebar";
import { AppTopBar } from "./components/AppTopBar";
import { ActressesPage } from "./components/ActressesPage";
import { ContextMenu } from "./components/ContextMenu";
import { ActressContextMenu } from "./components/ActressContextMenu";
import { HomePage } from "./components/HomePage";
import { LibraryPage } from "./components/LibraryPage";
import { SearchPage } from "./components/SearchPage";
import { DuplicateResolutionModal } from "./components/DuplicateResolutionModal";
import { MovieTile } from "./components/MovieTile";
import { PlayerPage } from "./components/PlayerPage";
import { PinPromptDialog } from "./components/PinPromptDialog";
import { ScanOptionsDialog } from "./components/ScanOptionsDialog";
import { ScanToast } from "./components/ScanToast";
import { SettingsPage } from "./components/SettingsPage";
import { usePlayer } from "./hooks/usePlayer";
import { useSettings } from "./hooks/useSettings";
import { useScanProgress } from "./hooks/useScanProgress";
import { useLibrary } from "./hooks/useLibrary";
import { useSelection } from "./hooks/useSelection";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useScanHandlers } from "./hooks/useScanHandlers";
import { useLibraryActions } from "./hooks/useLibraryActions";
import { useMediaActions } from "./hooks/useMediaActions";
import { useBootstrap } from "./hooks/useBootstrap";
import { useSidebarResize } from "./hooks/useSidebarResize";
import { useDuplicateResolution } from "./hooks/useDuplicateResolution";
import {
  buildOrganizationPreview,
  getRejectedStatusLabel,
} from "./utils";

const pages: { id: AppPage; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "library", label: "Library" },
  { id: "search", label: "Sub-Gen" },
  { id: "actresses", label: "Actresses" },
  { id: "player", label: "▶ Player" },
  { id: "settings", label: "Settings" }
];

const PAGE_SIZE = 200;




export function App() {
  const desktopApi = window.desktopApi;
  const [appState, setAppState] = useState<AppShellState | null>(null);
  const [activePage, setActivePage] = useState<AppPage>("home");
  const [statusMessage, setStatusMessage] = useState("Preparing local library...");
  const [showScanOptionsPrompt, setShowScanOptionsPrompt] = useState(false);
  const [pendingScanMode, setPendingScanMode] = useState<LibraryMode>("normal");
  const [showPinPrompt, setShowPinPrompt] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    movie: MovieRecord;
    x: number;
    y: number;
  } | null>(null);
  const [actressContextMenu, setActressContextMenu] = useState<{
    name: string;
    x: number;
    y: number;
  } | null>(null);
  const [isRefreshingActressPhotos, setIsRefreshingActressPhotos] = useState(false);
  const [actressRegions, setActressRegions] = useState<Record<string, string>>({});
  const [selectedActressRegionDraft, setSelectedActressRegionDraft] = useState("");

  // ── Custom hooks ──────────────────────────────────────────────────────────
  const settings = useSettings({
    desktopApi,
    onStateChange: (state) => {
      setAppState(state);
    },
    onStatus: setStatusMessage,
  });
  const {
    metadataDraft, setMetadataDraft,
    organizationDraft, setOrganizationDraft,
    themeModeDraft, setThemeModeDraft,
    focusedOrganizationField, setFocusedOrganizationField,
    scanOptionsDraft, setScanOptionsDraft,
    initFromAppState,
    handleSaveThemeMode,
    handleSaveMetadataSettings,
    handleSaveOrganizationSettings,
    insertOrganizationToken,
    applyOrganizationPreset,
  } = settings;

  // Stub ref so useScanProgress can call refreshMovies before useLibrary is wired
  const refreshMoviesRef = useRef<() => void>(() => {});

  const {
    scanProgress, setScanProgress,
    lastScanSummary, setLastScanSummary,
    duplicateGroups, setDuplicateGroups,
    duplicateSelections, setDuplicateSelections,
    recentProcessedFiles,
    subtitleScanRunning, setSubtitleScanRunning,
    subtitleScanResult, setSubtitleScanResult,
    isScanning, progressPercent, scanStageLabel,
  } = useScanProgress({
    desktopApi,
    onScanRefresh: () => refreshMoviesRef.current(),
  });

  const {
    movies, setMovies,
    movieTotalCount, setMovieTotalCount, movieLoadOffset, setMovieLoadOffset,
    sortMode, setSortMode,
    selectedMovieId, setSelectedMovieId,
    searchInput, setSearchInput,
    allMoviesPool, setAllMoviesPool,
    actressPhotos, setActressPhotos,
    selectedActress, setSelectedActress,
    actressModeFilter, setActressModeFilter,
    actressSortMode, setActressSortMode,
    actressGridCols, changeActressGridCols,
    gridColumns, changeGridColumns,
    sortedMovies, actressDirectory, deferredSearch,
    moviesRef,
    refreshMovies, loadMoreMovies, refreshPostersOnly,
  } = useLibrary({
    desktopApi,
    gentleUnlocked: appState?.gentleUnlocked,
    isScanning,
    setActivePage,
    actressRegions,
  });

  const [selectedActressPhotos, setSelectedActressPhotos] = useState<string[]>([]);

  // Wire scan refresh to the live refreshMovies from useLibrary
  refreshMoviesRef.current = () => void refreshMovies();

  const player = usePlayer({
    desktopApi,
    movies,
    allMoviesPool,
    onSubtitleInstalled: async () => {
      if (!desktopApi) {
        return;
      }
      try {
        const [nextMovies, allMovies] = await Promise.all([
          desktopApi.listMovies(undefined, PAGE_SIZE, 0),
          desktopApi.listAllMovies()
        ]);
        setMovies(nextMovies);
        setAllMoviesPool(allMovies);
      } catch {
        // keep current state if refresh fails
      }
    }
  });
  const {
    videoRef,
    playerContainerRef,
    playerConfigRef,
    playerMovieIdRef,
    pendingRestorePositionRef,
    playerMovieId, setPlayerMovieId,
    playerFileUrl, setPlayerFileUrl,
    playerPlaying, setPlayerPlaying,
    playerVolume, setPlayerVolume,
    playerMuted, setPlayerMuted,
    playerCurrentTime, setPlayerCurrentTime,
    playerDuration, setPlayerDuration,
    playerPlaybackError, setPlayerPlaybackError,
    playerSubtitles, setPlayerSubtitles,
    playerSubTrackUrl, setPlayerSubTrackUrl,
    playerSubTrackLang, setPlayerSubTrackLang,
    playerSubLoading,
    playerSubSearching, setPlayerSubSearching,
    playerShowSubPanel, setPlayerShowSubPanel,
    playerSubLangFilter, setPlayerSubLangFilter,
    playerSubTargetLang, setPlayerSubTargetLang,
    playerSubDownloadingId,
    playerSubHasSearched, setPlayerSubHasSearched,
    playerSettings, setPlayerSettings,
    playerShowMovieList, setPlayerShowMovieList,
    playerHoveredMovieId, setPlayerHoveredMovieId,
    playerRate, setPlayerRate,
    playerShowConfig, setPlayerShowConfig,
    playerIsFullscreen,
    loadMovieIntoPlayer,
    handlePlaybackTimeUpdate,
    handlePlaybackEnded,
    applySubtitle,
    handleDownloadSubtitle,
    handleSearchSubtitles,
    navigatePlaylist,
    convertMovieToMp4,
  } = player;

  const activePageRef = useRef(activePage);
  activePageRef.current = activePage;

  const {
    selectedIds, setSelectedIds, selectionBox, gridRef,
    handleGridMouseDown, handleTileClick, toggleSelected,
  } = useSelection({ moviesRef, activePageRef });

  const selectedMovie = useMemo(
    () => movies.find((movie) => movie.id === selectedMovieId) ?? null,
    [movies, selectedMovieId]
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const organizationPreview = useMemo(
    () => buildOrganizationPreview(organizationDraft, selectedMovie),
    [organizationDraft, selectedMovie]
  );

  const {
    sidebarCollapsed, setSidebarCollapsed,
    sidebarWidth,
    handleSidebarDragStart,
  } = useSidebarResize();

  // ── Handler hooks ─────────────────────────────────────────────────────────
  const {
    handleScanSaved,
    openScanOptions,
    handleConfirmScanOptions,
    scanSourceMode,
    setScanSourceMode,
  } = useScanHandlers({
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
  });

  const {
    handleMoveOne,
    handleBatchMove,
    selectMissingPosterTitles,
    handlePickLibraryFolder,
  } = useLibraryActions({
    desktopApi,
    movies,
    selectedIds,
    setSelectedIds,
    deferredSearch,
    refreshMovies,
    initFromAppState,
    setAppState,
    setStatusMessage,
  });

  const {
    handleBackfillPosters,
    handleRefreshActressPhotos,
    handleRefreshSelectedPosters,
    handleAddSubtitleDir,
    handleRemoveSubtitleDir,
    handleRunSubtitleScan,
    handleSavePlayerSettings,
  } = useMediaActions({
    desktopApi,
    selectedIds,
    deferredSearch,
    playerSettings,
    refreshMovies,
    refreshPostersOnly,
    setActressPhotos,
    setAllMoviesPool,
    setStatusMessage,
    setSubtitleScanRunning,
    setSubtitleScanResult,
    setAppState,
    setIsRefreshingActressPhotos,
  });

  useBootstrap({
    desktopApi,
    initFromAppState,
    setAppState,
    setMovies,
    setMovieTotalCount,
    setMovieLoadOffset,
    setSelectedMovieId,
    setAllMoviesPool,
    setActressPhotos,
    setPlayerSettings: player.setPlayerSettings,
    setPlayerVolume: player.setPlayerVolume,
    setStatusMessage,
  });

  const {
    resolveGroup: handleResolveGroup,
    resolveAll: handleResolveAll,
    skipAll: handleSkipAllDuplicates,
  } = useDuplicateResolution({
    desktopApi,
    appState,
    duplicateGroups,
    duplicateSelections,
    setDuplicateGroups,
    setStatusMessage,
  });

  useEffect(() => {
    if (!desktopApi || !selectedActress) {
      setSelectedActressPhotos([]);
      setSelectedActressRegionDraft("");
      return;
    }

    void desktopApi
      .actressListPhotos(selectedActress)
      .then(setSelectedActressPhotos)
      .catch(() => setSelectedActressPhotos([]));
    setSelectedActressRegionDraft(
      actressRegions[selectedActress] ??
      actressDirectory.find((entry) => entry.name === selectedActress)?.region ??
      ""
    );
  }, [desktopApi, selectedActress, actressPhotos, actressRegions, actressDirectory]);

  useEffect(() => {
    document.documentElement.dataset.theme = appState?.themeMode ?? "dark";
  }, [appState?.themeMode]);

  useEffect(() => {
    if (!desktopApi) {
      return;
    }

    return desktopApi.onGentleUnlockResult(async (result) => {
      setStatusMessage(result.message);
      if (!result.ok) {
        return;
      }

      const nextState = await desktopApi.getAppState();
      setAppState(nextState);
      initFromAppState(nextState);
      setActivePage("library");
    });
  }, [desktopApi, initFromAppState]);

  useEffect(() => {
    if (!showPinPrompt) {
      setPinInput("");
    }
  }, [showPinPrompt]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  useKeyboardShortcuts({
    onToggleGentle: async () => {
      if (!desktopApi) return;
      const nextState = await desktopApi.toggleGentle();
      setAppState(nextState);
      settings.initFromAppState(nextState);
      await refreshMovies(deferredSearch);
      if (!nextState.gentleUnlocked && actressModeFilter === "gentle") {
        setActressModeFilter("all");
      }
      setStatusMessage(
        nextState.gentleUnlocked
          ? "Gentle mode enabled."
          : "Gentle mode disabled."
      );
    },
    desktopApi,
    appState,
    isScanning,
    activePageRef,
    videoRef,
    playerContainerRef,
    setActivePage,
    setContextMenu,
    setShowScanOptionsPrompt,
    setPlayerShowSubPanel,
    setPlayerShowMovieList,
    setPlayerPlaying,
    setPlayerMuted,
    setPlayerVolume,
    setPlayerRate,
    setPlayerCurrentTime,
    navigatePlaylist,
    handleScanSaved: () => void handleScanSaved(),
    openScanOptions,
  });

  // Gentle state arrives over the gentle:unlockResult push channel (see
  // onGentleUnlockResult); main never emitted a second gentle:toggled
  // signal, so that dead subscription is gone.

  if (!desktopApi) {
    return (
      <div className="loading-shell">
        MLA+ is waiting for the Electron desktop bridge. Restart the app window if this screen stays here.
      </div>
    );
  }

  if (!appState) {
    return <div className="loading-shell">Booting MLA+ desktop shell...</div>;
  }

  return (
    <div className="app-shell">
      <AppSidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        width={sidebarWidth}
        onResizeStart={handleSidebarDragStart}
        pages={pages}
        activePage={activePage}
        onNavigate={(page) => {
          setActivePage(page);
          if (page !== "actresses") setSelectedActress(null);
        }}
        movies={movies}
        statusMessage={statusMessage}
      />

      <main className="content">
        <AppTopBar
          searchInput={searchInput}
          onSearchChange={setSearchInput}
          isScanning={isScanning}
          onOpenScanOptions={openScanOptions}
          onCancelScan={() => void desktopApi?.cancelScan()}
          gentleUnlocked={appState?.gentleUnlocked ?? false}
          scanProgress={scanProgress}
          scanStageLabel={scanStageLabel}
          lastScanSummaryInvalidFiles={lastScanSummary?.invalidFiles ?? []}
          getRejectedStatusLabel={getRejectedStatusLabel}
        />

        {activePage === "home" && (
          <HomePage
            movies={movies}
            appState={appState}
            lastScanSummary={lastScanSummary}
          />
        )}

        {activePage === "library" && (
          <LibraryPage
            movies={movies}
            sortedMovies={sortedMovies}
            movieTotalCount={movieTotalCount}
            sortMode={sortMode}
            setSortMode={setSortMode}
            gridColumns={gridColumns}
            changeGridColumns={changeGridColumns}
            selectedMovieId={selectedMovieId}
            selectedIdSet={selectedIdSet}
            isScanning={isScanning}
            gridRef={gridRef as React.RefObject<HTMLDivElement>}
            handleGridMouseDown={handleGridMouseDown}
            handleTileClick={handleTileClick}
            toggleSelected={toggleSelected}
            setContextMenu={setContextMenu}
            openScanOptions={openScanOptions}
            selectMissingPosterTitles={selectMissingPosterTitles}
            handleRefreshSelectedPosters={handleRefreshSelectedPosters}
            handleBatchMove={handleBatchMove}
            loadMoreMovies={loadMoreMovies}
            PAGE_SIZE={PAGE_SIZE}
          />
        )}

        {activePage === "search" && (
          <SearchPage
            movies={movies}
            setSelectedMovieId={setSelectedMovieId}
            setActivePage={setActivePage}
            onSubtitleGenerated={() => refreshMovies()}
          />
        )}

        {activePage === "actresses" && (
          <ActressesPage
            actressDirectory={actressDirectory}
            selectedActress={selectedActress}
            setSelectedActress={setSelectedActress}
            actressGridCols={actressGridCols}
            changeActressGridCols={changeActressGridCols}
            actressModeFilter={actressModeFilter}
            setActressModeFilter={setActressModeFilter}
            gentleUnlocked={appState?.gentleUnlocked ?? false}
            actressSortMode={actressSortMode}
            setActressSortMode={setActressSortMode}
            isRefreshingActressPhotos={isRefreshingActressPhotos}
            setIsRefreshingActressPhotos={setIsRefreshingActressPhotos}
            actressPhotos={actressPhotos}
            setActressPhotos={setActressPhotos}
            allMoviesPool={allMoviesPool}
            movies={movies}
            selectedMovieId={selectedMovieId}
            setSelectedMovieId={setSelectedMovieId}
            setActivePage={setActivePage}
            setContextMenu={setContextMenu}
          setActressContextMenu={setActressContextMenu}
          selectedActressPhotos={selectedActressPhotos}
          selectedActressRegion={selectedActressRegionDraft}
          setSelectedActressRegion={setSelectedActressRegionDraft}
          onAddActressPhoto={async (name) => {
            if (!desktopApi) return;
            const updated = await desktopApi.actressSetPhoto(name);
            setActressPhotos(updated);
            if (selectedActress === name) {
              const photos = await desktopApi.actressListPhotos(name);
              setSelectedActressPhotos(photos);
            }
          }}
          onRemoveActressPhoto={async (name, photoUrl) => {
            if (!desktopApi) return;
            const updated = await desktopApi.actressRemovePhoto(name, photoUrl);
            setActressPhotos(updated);
            if (selectedActress === name) {
              const photos = await desktopApi.actressListPhotos(name);
              setSelectedActressPhotos(photos);
            }
          }}
          onSetPrimaryActressPhoto={async (name, photoUrl) => {
            if (!desktopApi) return;
            const updated = await desktopApi.actressSetPrimaryPhoto(name, photoUrl);
            setActressPhotos(updated);
            if (selectedActress === name) {
              const photos = await desktopApi.actressListPhotos(name);
              setSelectedActressPhotos(photos);
            }
          }}
          onSaveActressRegion={async (name, region) => {
            if (!desktopApi) return;
            const updated = await desktopApi.actressSetRegion(name, region);
            setActressRegions(updated);
            if (selectedActress === name) {
              setSelectedActressRegionDraft(updated[name] ?? region);
            }
          }}
          onRefreshActressPhotos={handleRefreshActressPhotos}
        />
      )}

        {activePage === "player" && (
          <PlayerPage
            movies={movies}
            allMoviesPool={allMoviesPool}
            playerMovieId={playerMovieId}
            videoRef={videoRef as React.RefObject<HTMLVideoElement>}
            playerContainerRef={playerContainerRef as React.RefObject<HTMLElement>}
            playerConfigRef={playerConfigRef as React.RefObject<HTMLElement>}
            playerFileUrl={playerFileUrl}
            playerPlaying={playerPlaying}
            playerMuted={playerMuted}
            playerVolume={playerVolume}
            playerRate={playerRate}
            playerCurrentTime={playerCurrentTime}
            playerDuration={playerDuration}
            playerPlaybackError={playerPlaybackError}
            playerIsFullscreen={playerIsFullscreen}
            playerSettings={playerSettings}
            playerShowConfig={playerShowConfig}
            playerShowMovieList={playerShowMovieList}
            playerHoveredMovieId={playerHoveredMovieId}
            playerShowSubPanel={playerShowSubPanel}
            playerSubTrackUrl={playerSubTrackUrl}
            playerSubTrackLang={playerSubTrackLang}
            playerSubTargetLang={playerSubTargetLang}
            playerSubtitles={playerSubtitles}
            playerSubSearching={playerSubSearching}
            playerSubHasSearched={playerSubHasSearched}
            playerSubDownloadingId={playerSubDownloadingId}
            setPlayerPlaying={setPlayerPlaying}
            setPlayerMuted={setPlayerMuted}
            setPlayerVolume={setPlayerVolume}
            setPlayerRate={setPlayerRate}
            setPlayerCurrentTime={setPlayerCurrentTime}
            setPlayerDuration={setPlayerDuration}
            setPlayerPlaybackError={setPlayerPlaybackError}
            setPlayerSettings={setPlayerSettings}
            setPlayerShowConfig={setPlayerShowConfig}
            setPlayerShowMovieList={setPlayerShowMovieList}
            setPlayerHoveredMovieId={setPlayerHoveredMovieId}
            setPlayerShowSubPanel={setPlayerShowSubPanel}
            setPlayerSubTrackUrl={setPlayerSubTrackUrl}
            setPlayerSubTargetLang={setPlayerSubTargetLang}
            setPlayerSubtitles={setPlayerSubtitles}
            setPlayerSubHasSearched={setPlayerSubHasSearched}
            loadMovieIntoPlayer={loadMovieIntoPlayer}
            navigatePlaylist={navigatePlaylist}
            applySubtitle={applySubtitle}
            handleSearchSubtitles={handleSearchSubtitles}
            handleDownloadSubtitle={handleDownloadSubtitle}
            convertMovieToMp4={convertMovieToMp4}
            pendingRestorePositionRef={pendingRestorePositionRef}
            handlePlaybackTimeUpdate={handlePlaybackTimeUpdate}
            handlePlaybackEnded={handlePlaybackEnded}
            playerSaveSettings={async (s) => { await desktopApi?.playerSaveSettings(s); }}
            playerDownloadSubtitleFile={async (url) => desktopApi?.playerDownloadSubtitle(url) ?? null}
            playerOpenFile={async (filePath) => { await desktopApi?.openFile(filePath); }}
            playerShowInFolder={async (filePath) => { await desktopApi?.showInFolder(filePath); }}
          />
        )}

        {activePage === "settings" && (
          <SettingsPage
            appState={appState}
            metadataDraft={metadataDraft}
            setMetadataDraft={setMetadataDraft}
            onSaveMetadataSettings={handleSaveMetadataSettings}
            onBackfillPosters={handleBackfillPosters}
            organizationDraft={organizationDraft}
            setOrganizationDraft={setOrganizationDraft}
            themeModeDraft={themeModeDraft}
            setThemeModeDraft={setThemeModeDraft}
            onSaveThemeMode={handleSaveThemeMode}
            organizationPreview={organizationPreview}
            onSaveOrganizationSettings={handleSaveOrganizationSettings}
            applyOrganizationPreset={applyOrganizationPreset}
            insertOrganizationToken={insertOrganizationToken}
            setFocusedOrganizationField={setFocusedOrganizationField}
            playerSettings={playerSettings}
            setPlayerSettings={setPlayerSettings}
            setPlayerVolume={setPlayerVolume}
            onSavePlayerSettings={handleSavePlayerSettings}
            subtitleScanRunning={subtitleScanRunning}
            subtitleScanResult={subtitleScanResult}
            onAddSubtitleDir={handleAddSubtitleDir}
            onRemoveSubtitleDir={handleRemoveSubtitleDir}
            onRunSubtitleScan={handleRunSubtitleScan}
            onPickLibraryFolder={handlePickLibraryFolder}
          />
        )}
      </main>

      {showScanOptionsPrompt && (
        <ScanOptionsDialog
          pendingScanMode={pendingScanMode}
          organizationDraft={organizationDraft}
          scanOptionsDraft={scanOptionsDraft}
          scanSourceMode={scanSourceMode}
          onChangeScanOption={(key, value) => {
            setScanOptionsDraft((current) => {
              const next = { ...current, [key]: value };
              // mutual exclusion for library mode
              if (key === "addToNormalModeLibrary" && value === true) next.addToGentleModeLibrary = false;
              if (key === "addToGentleModeLibrary" && value === true) next.addToNormalModeLibrary = false;
              return next;
            });
          }}
          onChangeScanSource={setScanSourceMode}
          onConfirm={() => void handleConfirmScanOptions()}
          onClose={() => setShowScanOptionsPrompt(false)}
        />
      )}

      {selectionBox && (
        <div
          className="selection-box"
          style={{
            height: selectionBox.height,
            left: selectionBox.left,
            top: selectionBox.top,
            width: selectionBox.width
          }}
        />
      )}

      {contextMenu && (
        <ContextMenu
          contextMenu={contextMenu}
          isSelected={selectedIdSet.has(contextMenu.movie.id)}
          onClose={() => setContextMenu(null)}
          onOpenInPlayer={() => {
            void loadMovieIntoPlayer(contextMenu.movie);
            setActivePage("player");
            setContextMenu(null);
          }}
          onOpenExternal={() => { void desktopApi?.openFile(contextMenu.movie.sourcePath); setContextMenu(null); }}
          onShowInFolder={() => { void desktopApi?.showInFolder(contextMenu.movie.sourcePath); setContextMenu(null); }}
          onRefreshPoster={() => { void handleRefreshSelectedPosters([contextMenu.movie.id]); setContextMenu(null); }}
          onMove={() => {
            const target = contextMenu.movie.libraryMode === "normal" ? "gentle" : "normal";
            void handleMoveOne(contextMenu.movie.id, target);
            setContextMenu(null);
          }}
          onToggleSelect={() => { toggleSelected(contextMenu.movie.id); setContextMenu(null); }}
          onCopyPath={() => { void navigator.clipboard.writeText(contextMenu.movie.sourcePath); setContextMenu(null); }}
          onCopyVideoId={contextMenu.movie.videoId ? () => { void navigator.clipboard.writeText(contextMenu.movie.videoId!); setContextMenu(null); } : undefined}
        />
      )}

      {actressContextMenu && (
        <ActressContextMenu
          menu={actressContextMenu}
          onClose={() => setActressContextMenu(null)}
          onAddPhoto={async () => {
            if (!desktopApi) return;
            const updated = await desktopApi.actressSetPhoto(actressContextMenu.name);
            setActressPhotos(updated);
            const photos = await desktopApi.actressListPhotos(actressContextMenu.name);
            setSelectedActressPhotos(photos);
            setActressContextMenu(null);
          }}
          onSetPhoto={async () => {
            if (!desktopApi) return;
            const updated = await desktopApi.actressSetPhoto(actressContextMenu.name);
            setActressPhotos(updated);
            const photos = await desktopApi.actressListPhotos(actressContextMenu.name);
            setSelectedActressPhotos(photos);
            setActressContextMenu(null);
          }}
          onRemovePhoto={async () => {
            if (!desktopApi) return;
            const updated = await desktopApi.actressRemovePhoto(actressContextMenu.name);
            setActressPhotos(updated);
            setSelectedActressPhotos([]);
            setActressContextMenu(null);
          }}
          onViewTitles={() => {
            setSelectedActress(actressContextMenu.name);
            setActressContextMenu(null);
          }}
        />
      )}

      {/* Floating scan progress bar — bottom-left corner */}
      {scanProgress && (
        <ScanToast
          scanProgress={scanProgress}
          isScanning={isScanning}
          progressPercent={progressPercent}
          scanStageLabel={scanStageLabel}
          onCancel={() => void desktopApi?.cancelScan()}
          onDismiss={() => setScanProgress(null)}
        />
      )}

      {showPinPrompt && desktopApi && !appState?.gentleUnlocked && (
        <PinPromptDialog
          pinInput={pinInput}
          onPinChange={setPinInput}
          onUnlock={async () => {
            const result = await desktopApi.verifyGentlePin(pinInput.trim());
            setStatusMessage(result.message);
            if (!result.ok) {
              return;
            }

            const nextState = await desktopApi.getAppState();
            setAppState(nextState);
            initFromAppState(nextState);
            setActivePage("library");
            setShowPinPrompt(false);
          }}
          onClose={() => setShowPinPrompt(false)}
        />
      )}

      {/* Duplicate resolution modal */}
      {duplicateGroups.length > 0 && !isScanning && (
        <DuplicateResolutionModal
          duplicateGroups={duplicateGroups}
          duplicateSelections={duplicateSelections}
          onSelectFile={(groupKey, filePath) =>
            setDuplicateSelections((s) => ({ ...s, [groupKey]: filePath }))
          }
          onResolveGroup={(groupKey) => void handleResolveGroup(groupKey)}
          onResolveAll={() => void handleResolveAll()}
          onSkipAll={handleSkipAllDuplicates}
        />
      )}
    </div>
  );
}
