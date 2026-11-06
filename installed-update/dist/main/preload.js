"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const api = {
    getGentleShortcut: () => electron_1.ipcRenderer.invoke("settings:getGentleShortcut"),
    setGentleShortcut: (shortcut) => electron_1.ipcRenderer.invoke("settings:setGentleShortcut", shortcut),
    toggleGentleMode: () => electron_1.ipcRenderer.invoke("gentle:toggle"),
    verifyGentlePin: (pin) => electron_1.ipcRenderer.invoke("settings:verifyGentlePin", pin),
    getThemeMode: () => electron_1.ipcRenderer.invoke("settings:getThemeMode"),
    setThemeMode: (themeMode) => electron_1.ipcRenderer.invoke("settings:setThemeMode", themeMode),
    getAppState: () => electron_1.ipcRenderer.invoke("app:getState"),
    getFtsHealth: () => electron_1.ipcRenderer.invoke("settings:getFtsHealth"),
    rebuildFtsIndex: () => electron_1.ipcRenderer.invoke("settings:rebuildFtsIndex"),
    saveMetadataSettings: (settings) => electron_1.ipcRenderer.invoke("settings:saveMetadata", settings),
    saveOrganizationSettings: (settings) => electron_1.ipcRenderer.invoke("settings:saveOrganization", settings),
    pickLibraryFolder: () => electron_1.ipcRenderer.invoke("settings:pickLibraryFolder"),
    openFile: (filePath) => electron_1.ipcRenderer.invoke("shell:openFile", filePath),
    showInFolder: (filePath) => electron_1.ipcRenderer.invoke("shell:showInFolder", filePath),
    pickScanFolder: (options) => electron_1.ipcRenderer.invoke("movies:pickScan", options),
    listMovies: (query, limit, offset, sortOrder) => electron_1.ipcRenderer.invoke("movies:list", { query, limit, offset, sortOrder }),
    countMovies: (query) => electron_1.ipcRenderer.invoke("movies:count", { query }),
    ensureMoviePosters: (movieIds) => electron_1.ipcRenderer.invoke("movies:ensurePosters", movieIds),
    refreshMoviePosters: (movieIds) => electron_1.ipcRenderer.invoke("movies:refreshPosters", movieIds),
    backfillMissingPosters: () => electron_1.ipcRenderer.invoke("movies:backfillPosters"),
    linkActressMovies: (name, ids) => electron_1.ipcRenderer.invoke("actress:linkMovies", name, ids),
    librarySummary: () => electron_1.ipcRenderer.invoke("movies:summary"),
    scanWholeSystem: options => electron_1.ipcRenderer.invoke("movies:scanWholeSystem", options),
    scanLibraries: (options) => electron_1.ipcRenderer.invoke("movies:scan", options),
    cancelScan: () => electron_1.ipcRenderer.invoke("scan:cancel"),
    addLibraryRoot: (mode) => electron_1.ipcRenderer.invoke("library:addRoot", mode),
    moveMovie: (movieId, mode) => electron_1.ipcRenderer.invoke("movies:moveMode", movieId, mode),
    moveMovies: (movieIds, mode) => electron_1.ipcRenderer.invoke("movies:batchMoveMode", movieIds, mode),
    unlockGentle: (pin) => electron_1.ipcRenderer.invoke("auth:unlockGentle", pin),
    toggleGentle: () => electron_1.ipcRenderer.invoke("auth:toggleGentle"),
    getActressPhotos: () => electron_1.ipcRenderer.invoke("actress:getPhotos"),
    getActressRegions: () => electron_1.ipcRenderer.invoke("actress:getRegions"),
    getActressRegion: (name) => electron_1.ipcRenderer.invoke("actress:getRegion", name),
    refreshActressPhotos: () => electron_1.ipcRenderer.invoke("actress:refreshPhotos"),
    actressRemovePhoto: (name, photoUrl) => electron_1.ipcRenderer.invoke("actress:removePhoto", name, photoUrl),
    actressListPhotos: (name) => electron_1.ipcRenderer.invoke("actress:listPhotos", name),
    actressSetPrimaryPhoto: (name, photoUrl) => electron_1.ipcRenderer.invoke("actress:setPrimaryPhoto", name, photoUrl),
    actressSetRegion: (name, region) => electron_1.ipcRenderer.invoke("actress:setRegion", name, region),
    selectMovieModeIds: mode => electron_1.ipcRenderer.invoke("movies:selectModeIds", mode),
    removeMovies: (ids, action) => electron_1.ipcRenderer.invoke("movies:remove", ids, action),
    listAllMovies: () => electron_1.ipcRenderer.invoke("movies:listAll"),
    sweepMissingMovies: () => electron_1.ipcRenderer.invoke("movies:sweepMissing"),
    forgetMissingMovie: (movieId) => electron_1.ipcRenderer.invoke("movies:forgetMissing", movieId),
    relinkMissingMovie: (movieId) => electron_1.ipcRenderer.invoke("movies:relinkMissing", movieId),
    playerFetchSubtitles: (dvdId) => electron_1.ipcRenderer.invoke("player:fetchSubtitles", dvdId),
    playerDownloadSubtitle: (url) => electron_1.ipcRenderer.invoke("player:downloadSubtitle", url),
    playerInstallSubtitle: (movieId, language, content) => electron_1.ipcRenderer.invoke("player:installSubtitle", movieId, language, content),
    playerGetSettings: () => electron_1.ipcRenderer.invoke("player:getSettings"),
    playerSaveSettings: (settings) => electron_1.ipcRenderer.invoke("player:saveSettings", settings),
    playerGetPlaybackCheckpoint: (movieId) => electron_1.ipcRenderer.invoke("player:getPlaybackCheckpoint", movieId),
    playerSavePlaybackCheckpoint: (movieId, positionSeconds) => electron_1.ipcRenderer.invoke("player:savePlaybackCheckpoint", movieId, positionSeconds),
    playerClearPlaybackCheckpoint: (movieId) => electron_1.ipcRenderer.invoke("player:clearPlaybackCheckpoint", movieId),
    playerGetFileUrl: (filePath, folderPath) => electron_1.ipcRenderer.invoke("player:getFileUrl", filePath, folderPath ?? null),
    playerConvertToMp4: (filePath) => electron_1.ipcRenderer.invoke("player:convertToMp4", filePath),
    onScanProgress: (handler) => {
        const listener = (_event, progress) => {
            handler(progress);
        };
        electron_1.ipcRenderer.on("scan:progress", listener);
        return () => {
            electron_1.ipcRenderer.removeListener("scan:progress", listener);
        };
    },
    onGentleUnlockResult: (handler) => {
        const listener = (_event, result) => {
            handler(result);
        };
        electron_1.ipcRenderer.on("gentle:unlockResult", listener);
        return () => {
            electron_1.ipcRenderer.removeListener("gentle:unlockResult", listener);
        };
    },
    resolveDuplicate: (keepPath, deletePaths, gentleUnlocked) => electron_1.ipcRenderer.invoke("duplicates:resolve", keepPath, deletePaths, gentleUnlocked),
    actressSetPhoto: (name) => electron_1.ipcRenderer.invoke("actress:setPhoto", name),
    addSubtitleDir: () => electron_1.ipcRenderer.invoke("subtitle:addDir"),
    removeSubtitleDir: (dir) => electron_1.ipcRenderer.invoke("subtitle:removeDir", dir),
    scanSubtitleDirs: () => electron_1.ipcRenderer.invoke("subtitle:scan"),
    onGentleToggled: (handler) => {
        const listener = (_event, state) => {
            handler(state);
        };
        electron_1.ipcRenderer.on("gentle:toggled", listener);
        return () => {
            electron_1.ipcRenderer.removeListener("gentle:toggled", listener);
        };
    },
    generateSubtitleForMovie: (movieId, options) => electron_1.ipcRenderer.invoke("subtitle:generateForMovie", movieId, options),
    getSubtitleModelAvailability: (model) => electron_1.ipcRenderer.invoke("subtitle:getModelAvailability", model),
    downloadSubtitleModel: (model) => electron_1.ipcRenderer.invoke("subtitle:downloadModel", model),
    onSubtitleModelDownloadProgress: (handler) => {
        const listener = (_event, progress) => {
            handler(progress);
        };
        electron_1.ipcRenderer.on("subtitle:modelDownloadProgress", listener);
        return () => {
            electron_1.ipcRenderer.removeListener("subtitle:modelDownloadProgress", listener);
        };
    },
    previewSubtitleOutput: (movieId, options) => electron_1.ipcRenderer.invoke("subtitle:previewOutput", movieId, options)
};
electron_1.contextBridge.exposeInMainWorld("desktopApi", api);

electron_1.contextBridge.exposeInMainWorld("deviceShare", { state: () => electron_1.ipcRenderer.invoke("device-share:state"), start: () => electron_1.ipcRenderer.invoke("device-share:start"), stop: () => electron_1.ipcRenderer.invoke("device-share:stop"), copy: text => electron_1.ipcRenderer.invoke("device-share:copy", text) });


electron_1.contextBridge.exposeInMainWorld("subtitleWorkspace", { state: id => electron_1.ipcRenderer.invoke("subtitle-workspace:state", id), search: (id, query, language) => electron_1.ipcRenderer.invoke("subtitle-workspace:search", id, query, language), local: (id, subtitle) => electron_1.ipcRenderer.invoke("subtitle-workspace:local", id, subtitle), download: (id, result) => electron_1.ipcRenderer.invoke("subtitle-workspace:download", id, result) });
