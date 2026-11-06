'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const SETTING = 'scan_import_fingerprints_v1';
function createScanImportHistory(database, cancelToken = {}) {
  let entries;
  try { entries = new Map(JSON.parse(database.getSetting?.(SETTING) || '[]')); } catch { entries = new Map(); }
  let dirty = false;
  const key = file => { const resolved = path.resolve(file); return crypto.createHash('sha256').update(process.platform === 'win32' ? resolved.toLowerCase() : resolved).digest('hex'); };
  async function stat(file) {
    let timer;
    const deadline = Date.now() + 2000;
    const stop = new Promise(resolve => { timer = setInterval(() => { if (cancelToken.cancelled || Date.now() >= deadline) resolve(null); }, 50); });
    try { return await Promise.race([fs.stat(file).catch(() => null), stop]); } finally { clearInterval(timer); }
  }
  function movieIdFor(file) {
    const direct = database.findMovieIdBySourcePath?.(file);
    if (direct) return direct;
    const saved = entries.get(key(file));
    if (!saved || typeof saved.movieId !== 'string' || typeof saved.importedPath !== 'string') return null;
    const movie = database.getMovie?.(saved.movieId);
    return movie && movie.sourcePath === saved.importedPath ? saved.movieId : null;
  }
  async function record(file, movieId, importedPath = file) {
    const current = await stat(file);
    if (!current || !current.isFile()) return;
    entries.set(key(file), { movieId, importedPath, size: current.size, mtime: current.mtimeMs });
    dirty = true;
  }
  return {
    movieIdFor,
    async shouldSkip(file) {
      const movieId = movieIdFor(file);
      if (!movieId) return false;
      const current = await stat(file);
      if (!current || !current.isFile()) return true;
      const previous = entries.get(key(file));
      if (previous && previous.movieId === movieId && typeof previous.size === 'number' && typeof previous.mtime === 'number') return previous.size === current.size && previous.mtime === current.mtimeMs;
      entries.set(key(file), { movieId, importedPath: database.getMovie?.(movieId)?.sourcePath || file, size: current.size, mtime: current.mtimeMs });
      dirty = true;
      return true;
    },
    record,
    flush() {
      if (!dirty) return;
      while (entries.size > 50000) entries.delete(entries.keys().next().value);
      database.setSetting?.(SETTING, JSON.stringify([...entries]));
      dirty = false;
    }
  };
}
module.exports = { createScanImportHistory };
