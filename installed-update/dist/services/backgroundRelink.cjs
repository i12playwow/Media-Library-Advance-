'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const scanner = require('./wholeSystemScan.cjs');
const { shouldSkipDirectory, within } = scanner;

const key = file => process.platform === 'win32' ? file.toLowerCase() : file;
const filename = file => key(path.basename(file));

async function boundedRead(operation) {
  let timer;
  try {
    return await Promise.race([
      operation.catch(() => null),
      new Promise(resolve => { timer = setTimeout(() => resolve(undefined), 3000); })
    ]);
  } finally { clearTimeout(timer); }
}

async function relinkMissing(database, missing, { roots, excludedPaths, canRun, onChanged }) {
  const wanted = new Map();
  for (const movie of missing) {
    const name = filename(movie.sourcePath);
    const group = wanted.get(name) || [];
    group.push(movie);
    wanted.set(name, group);
  }
  let history;
  try { history = new Map(JSON.parse(database.getSetting('scan_import_fingerprints_v1') || '[]')); }
  catch { history = new Map(); }
  const sizes = new Map();
  for (const entry of history.values()) {
    if (entry?.movieId && Number.isFinite(entry.size) && entry.size > 0) {
      sizes.set(entry.movieId, entry);
    }
  }
  const candidates = new Map();
  for (const root of roots) {
    const pending = [root];
    while (pending.length && canRun()) {
      const folder = pending.pop();
      if (excludedPaths.some(excluded => within(folder, excluded))) continue;
      const entries = await boundedRead(fs.readdir(folder, { withFileTypes: true }));
      if (entries === undefined) break;
      for (const entry of entries || []) {
        if (entry.isSymbolicLink()) continue;
        const file = path.join(folder, entry.name);
        if (entry.isDirectory() && !shouldSkipDirectory(entry.name)) pending.push(file);
        if (!entry.isFile() || !wanted.has(key(entry.name))) continue;
        const matches = candidates.get(key(entry.name)) || new Map();
        matches.set(key(file), file);
        candidates.set(key(entry.name), matches);
      }
    }
  }
  for (const [name, movies] of wanted) {
    if (!canRun()) return;
    // A shared filename cannot identify which catalog entry owns the file.
    if (movies.length !== 1) continue;
    const movie = movies[0];
    const saved = sizes.get(movie.id);
    const size = saved?.importedPath === movie.sourcePath ? saved.size : null;
    const oldRelative = path.relative(path.parse(movie.sourcePath).root, movie.sourcePath);
    const matches = [];
    for (const file of candidates.get(name)?.values() || []) {
      if (!canRun()) return;
      if (key(file) === key(movie.sourcePath)) continue;
      const sameRelative = key(path.relative(path.parse(file).root, file)) === key(oldRelative);
      if (!size && !(sameRelative && path.dirname(oldRelative) !== '.')) continue;
      const stat = await boundedRead(fs.stat(file));
      if (stat?.isFile() && stat.size > 0 && (!size || stat.size === size)) matches.push(file);
    }
    if (matches.length !== 1 || !canRun()) continue;
    const sourcePath = matches[0];
    const folderPath = path.dirname(sourcePath);
    const verifiedSubtitles = new Map();
    for (const subtitle of movie.subtitles || []) {
      if (!canRun()) return;
      if (!movie.folderPath || !within(subtitle.path, movie.folderPath)) continue;
      const missing = await boundedRead(fs.stat(subtitle.path).then(() => false, error => ['ENOENT', 'ENOTDIR'].includes(error.code)));
      if (!missing || !canRun()) continue;
      const next = path.join(folderPath, path.relative(movie.folderPath, subtitle.path));
      const stat = await boundedRead(fs.stat(next));
      if (stat?.isFile()) verifiedSubtitles.set(subtitle.path, next);
    }
    const originalMissing = await boundedRead(fs.stat(movie.sourcePath).then(() => false, error => ['ENOENT', 'ENOTDIR'].includes(error.code)));
    if (!originalMissing || !canRun()) continue;
    if (database.relinkMissingMovie(movie, { sourcePath, folderPath, verifiedSubtitles })) onChanged();
  }
}

function startBackgroundRelink({ database, isBusy, excludedPaths, onChanged }) {
  let stopped = false;
  let lastSearch = 0;
  let lastRoots = '';
  let timer;
  const canRun = () => !stopped && !isBusy();
  const notify = () => { if (!stopped) onChanged(); };
  database.onAvailabilityChanged = notify;

  async function tick() {
    try {
      if (!canRun()) return;
      const missing = await database.sweepMissingMoviesAsync();
      if (!missing.length || !canRun()) return;
      const roots = await scanner.connectedDrives({ cancelToken: { get cancelled() { return !canRun(); } } });
      const signature = [...roots].sort().join('|');
      if (!canRun() || (signature === lastRoots && Date.now() - lastSearch < 300_000)) return;
      lastRoots = signature;
      lastSearch = Date.now();
      await relinkMissing(database, missing, { roots, excludedPaths, canRun, onChanged: notify });
      if (!canRun()) lastSearch = 0;
    } catch (error) {
      if (!stopped) console.warn('Background relink could not finish:', error.message);
    } finally {
      if (!stopped) timer = setTimeout(tick, 30_000);
    }
  }

  timer = setTimeout(tick, 1500);
  return () => {
    stopped = true;
    clearTimeout(timer);
    database.onAvailabilityChanged = undefined;
  };
}

module.exports = { startBackgroundRelink, relinkMissing };
