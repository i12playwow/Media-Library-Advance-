// Shared by the installed database and source main process. Disk checks yield to UI work.
const fs = require('node:fs/promises');
const path = require('node:path');
const pending = new WeakMap();
const activeReads = new WeakMap();

function sweepMissingMoviesAsync(database, { timeoutMs = 3000 } = {}) {
  if (pending.has(database)) return pending.get(database);
  const work = run(database, timeoutMs).finally(() => pending.delete(database));
  pending.set(database, work);
  return work;
}

function volumeOf(file) {
  if (process.platform === 'win32') return path.win32.parse(file).root.toLowerCase();
  return path.parse(file).root;
}

async function checkFile(file, volume, reads, timeoutMs) {
  reads.add(volume);
  // Timing out the wait does not cancel the OS read. Keep this volume reserved
  // until that read settles so the next sweep cannot queue another behind it.
  const read = Promise.resolve().then(() => fs.access(file)).then(
    () => true,
    error => ['ENOENT', 'ENOTDIR'].includes(error.code) ? false : null
  ).finally(() => reads.delete(volume));
  let timer;
  try {
    return await Promise.race([
      read,
      new Promise(resolve => { timer = setTimeout(resolve, timeoutMs); })
    ]);
  } finally { clearTimeout(timer); }
}

async function run(database, timeoutMs) {
  if (database.db.open === false) return [];
  const started = Date.now();
  const rows = database.db.prepare('SELECT * FROM movies').all();
  const byVolume = new Map();
  for (const row of rows) {
    const volume = volumeOf(row.source_path);
    if (!byVolume.has(volume)) byVolume.set(volume, []);
    byVolume.get(volume).push(row);
  }
  const reads = activeReads.get(database) || new Set();
  activeReads.set(database, reads);
  const results = new Map();
  const volumes = byVolume.entries();
  async function worker() {
    for (const [volume, files] of volumes) {
      if (database.db.open === false) return;
      if (reads.has(volume)) continue;
      for (const row of files) {
        if (database.db.open === false) return;
        const exists = await checkFile(row.source_path, volume, reads, timeoutMs);
        if (exists === undefined) break;
        if (typeof exists === "boolean") results.set(row.id, { row, exists });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, byVolume.size) }, worker));
  if (database.db.open === false) return [];
  const update = database.db.prepare('UPDATE movies SET source_missing = ? WHERE id = ? AND source_path = ? AND updated_at = ?');
  const current = database.db.prepare('SELECT source_path, updated_at, source_missing FROM movies WHERE id = ?');
  const missingRows = [];
  let changed = 0;
  database.db.transaction(() => {
    for (const { row, exists } of results.values()) {
      // A scan, relink, edit, or deletion may have happened while the disk check awaited.
      const latest = current.get(row.id);
      if (!latest || latest.source_path !== row.source_path || latest.updated_at !== row.updated_at) continue;
      if (!exists !== Boolean(latest.source_missing)) changed += update.run(exists ? 0 : 1, row.id, row.source_path, row.updated_at).changes;
      database.fileExistsCache.set(row.source_path, { exists, checkedAt: Date.now() });
      if (!exists) missingRows.push(row);
    }
  })();
  if (database.fileExistsCache.size > database.constructor.FILE_EXISTS_CACHE_MAX_ENTRIES) database.clearFileExistsCache();
  try { database.ensureFtsIndexIntegrity(); } catch {}
  const finished = new Date().toISOString();
  database.setSetting(database.constructor.MISSING_SWEEP_LAST_KEY, finished);
  database.recordSweepSample(finished, Date.now() - started, changed);
  if (changed) database.onAvailabilityChanged?.();
  return missingRows.map(row => database.hydrateMovie(row, database.getSubtitles(row.id)));
}
module.exports = { sweepMissingMoviesAsync };
