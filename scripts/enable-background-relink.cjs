const fs = require('node:fs');
function update(file, replacements) {
  let body = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  for (const [before, after] of replacements) {
    if (body.split(before).length !== 2) throw new Error('Unexpected match in ' + file + ': ' + before);
    body = body.replace(before, () => after);
  }
  fs.writeFileSync(file, body);
}
const base = 'installed-update/dist/';
for (const name of ['backgroundRelink.cjs', 'libraryMaintenance.cjs', 'wholeSystemScan.cjs']) {
  fs.copyFileSync('app/services/' + name, base + 'services/' + name);
}
update(base + 'database/database.js', [
  ['    relinkMovieSourcePath(id, input) {', `    relinkMissingMovie(movie, input) {
        return this.db.transaction(() => {
            const current = this.db.prepare("SELECT source_path, updated_at, source_missing FROM movies WHERE id = ?").get(movie.id);
            if (!current?.source_missing || current.source_path !== movie.sourcePath || current.updated_at !== movie.updatedAt) return false;
            const occupied = this.db.prepare("SELECT 1 FROM movies WHERE source_path = ? COLLATE NOCASE AND id <> ?").get(input.sourcePath, movie.id);
            return !occupied && this.relinkMovieSourcePath(movie.id, input);
        })();
    }
    relinkMovieSourcePath(id, input) {`],
  ['            if (subtitle.path.startsWith(row.folder_path)) {\n                const nextSubtitlePath = node_path_1.default.join(input.folderPath, node_path_1.default.relative(row.folder_path, subtitle.path));', `            const nextSubtitlePath = input.verifiedSubtitles
                ? input.verifiedSubtitles.get(subtitle.path)
                : subtitle.path.startsWith(row.folder_path)
                    ? node_path_1.default.join(input.folderPath, node_path_1.default.relative(row.folder_path, subtitle.path))
                    : null;
            if (nextSubtitlePath) {`]
]);
update(base + 'main/main.js', [
  ['electron_1.app.whenReady().then(() => {', 'let stopBackgroundRelink;\nelectron_1.app.whenReady().then(() => {'],
  ['    database.startMissingSweepTimer();', ''],
  ['  electron_1.ipcMain.handle("movies:renameFile", movieRenamer.rename);', `  electron_1.ipcMain.handle("movies:renameFile", movieRenamer.rename);
    let refreshTimer;
    const stopRelink = require("../services/backgroundRelink.cjs").startBackgroundRelink({
        database,
        isBusy: () => Boolean(activeScanToken) || libraryMove.isBusy() || movieRenamer.isBusy(),
        excludedPaths: [electron_1.app.getPath("userData")],
        onChanged: () => {
            if (refreshTimer) return;
            refreshTimer = setTimeout(() => {
                refreshTimer = undefined;
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("library:availabilityChanged");
            }, 250);
        }
    });
    stopBackgroundRelink = () => {
        stopRelink();
        clearTimeout(refreshTimer);
    };`],
  ['    database?.stopMissingSweepTimer();', '    stopBackgroundRelink?.();']
]);
update(base + 'main/preload.js', [
  ['    onScanProgress: (handler) => {', `    onLibraryAvailabilityChanged: (handler) => {
        const listener = () => handler();
        electron_1.ipcRenderer.on("library:availabilityChanged", listener);
        return () => electron_1.ipcRenderer.removeListener("library:availabilityChanged", listener);
    },
    onScanProgress: (handler) => {`]
]);
update(base + 'renderer/assets/index-DiZDWUS4.js', [
  ["return()=>window.removeEventListener('mla-library-mode',change)", "const unsubscribe=e?.onLibraryAvailabilityChanged?.(()=>void j(le.current));return()=>{window.removeEventListener('mla-library-mode',change);unsubscribe?.()}"],
  ['    const timer = window.setInterval(update, 15e3);', '    const unsubscribe = window.desktopApi?.onLibraryAvailabilityChanged?.(update);\n    const timer = window.setInterval(update, 15e3);'],
  ['      window.clearInterval(timer);', '      unsubscribe?.();\n      window.clearInterval(timer);']
]);
const pkg = 'installed-update/package.json';
const metadata = JSON.parse(fs.readFileSync(pkg));
metadata.version = '1.0.45';
fs.writeFileSync(pkg, JSON.stringify(metadata, null, 2) + '\n');
