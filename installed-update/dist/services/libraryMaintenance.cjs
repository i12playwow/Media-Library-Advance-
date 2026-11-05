// Shared by the installed database and source main process. Disk checks yield to UI work.
const fs = require('node:fs/promises');
const pending = new WeakMap();
function sweepMissingMoviesAsync(database) {
  if (pending.has(database)) return pending.get(database);
  const work = run(database).finally(() => pending.delete(database));
  pending.set(database, work);
  return work;
}
async function run(database) {
  const started = Date.now();
  const rows = database.db.prepare('SELECT * FROM movies').all();
  const results = new Map();
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      let timer;
      try {
        const exists = await Promise.race([
          fs.access(row.source_path).then(() => true, error => ['ENOENT', 'ENOTDIR'].includes(error.code) ? false : null),
          new Promise(resolve => { timer = setTimeout(() => resolve(undefined), 3000); })
        ]);
        if (typeof exists === "boolean") results.set(row.id, { row, exists });
        // A stalled drive must not queue more reads behind a blocked filesystem worker.
        if (exists === undefined) return;
      } finally { clearTimeout(timer); }
    }
  }
  await Promise.all(Array.from({length: Math.min(4, rows.length)}, worker));
  const update = database.db.prepare('UPDATE movies SET source_missing = ? WHERE id = ? AND source_path = ? AND updated_at = ?');
  const current = database.db.prepare('SELECT source_path, updated_at FROM movies WHERE id = ?');
  const missingRows = [];
  let changed = 0;
  database.db.transaction(() => {
    for (const { row, exists } of results.values()) {
      // A scan, relink, edit, or deletion may have happened while the disk check awaited.
      const latest = current.get(row.id);
      if (!latest || latest.source_path !== row.source_path || latest.updated_at !== row.updated_at) continue;
      if (!exists !== Boolean(row.source_missing)) changed += update.run(exists ? 0 : 1, row.id, row.source_path, row.updated_at).changes;
      database.fileExistsCache.set(row.source_path, { exists, checkedAt: Date.now() });
      if (!exists) missingRows.push(row);
    }
  })();
  if (database.fileExistsCache.size > database.constructor.FILE_EXISTS_CACHE_MAX_ENTRIES) database.clearFileExistsCache();
  try { database.ensureFtsIndexIntegrity(); } catch {}
  const finished = new Date().toISOString();
  database.setSetting(database.constructor.MISSING_SWEEP_LAST_KEY, finished);
  database.recordSweepSample(finished, Date.now() - started, changed);
  return missingRows.map(row => database.hydrateMovie(row, database.getSubtitles(row.id)));
}
module.exports = { sweepMissingMoviesAsync };
