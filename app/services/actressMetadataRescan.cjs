'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { readMatchingNfo } = require('./nfoSidecar.cjs');

function nameKey(value) {
  const key = value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  if (!key || /^(?:unknown(?: (?:actress|actor|cast))?|unknow|n\/a|none|uncredited|(?:test )?fixtures?|[-–—])$/.test(key)) return '';
  return /^[a-z]{2,12}[-_]\d{2,8}(?:[-_ .].*)?$/.test(key) ? '' : key;
}

async function rescanActressMetadata(database, { isGentleUnlocked, parseNfoXml }) {
  const includeGentle = isGentleUnlocked();
  const rows = database.db.prepare("SELECT id, source_path, library_mode FROM movies WHERE library_mode = 'normal' OR ?").all(includeGentle ? 1 : 0);
  const summary = { checked: 0, updated: 0, unknown: 0, unreadable: 0 };
  const stalled = new Set();
  let cachedFolder;
  let cachedEntries;
  function readDirectory(folder) {
    if (folder !== cachedFolder) {
      cachedFolder = folder;
      cachedEntries = fs.readdir(folder, { withFileTypes: true });
    }
    return cachedEntries;
  }
  rows.sort((a, b) => a.source_path.localeCompare(b.source_path));

  for (const row of rows) {
    if (database.db.open === false) break;
    if (row.library_mode === 'gentle' && !isGentleUnlocked()) continue;
    summary.checked++;
    let addedNames = [];
    const root = path.parse(row.source_path).root.toLowerCase();
    if (!stalled.has(root)) {
      let timer;
      try {
        const xml = await Promise.race([
          readMatchingNfo(row.source_path, readDirectory),
          new Promise(resolve => { timer = setTimeout(resolve, 3000); })
        ]);
        if (xml === undefined) { stalled.add(root); summary.unreadable++; }
        else if (xml) addedNames = parseNfoXml(xml).actresses || [];
      } catch { summary.unreadable++; }
      finally { clearTimeout(timer); }
    } else summary.unreadable++;
    if (database.db.open === false) break;
    // Read the current record after disk I/O so edits made during the scan survive.
    const movie = database.getMovie(row.id);
    if (!movie || movie.sourcePath !== row.source_path || (movie.libraryMode === 'gentle' && !isGentleUnlocked())) continue;
    const cast = [...movie.actresses];
    const keys = new Set(cast.map(nameKey).filter(Boolean));
    for (const name of addedNames) {
      const key = nameKey(name);
      if (!key || keys.has(key)) continue;
      keys.add(key);
      cast.push(name);
    }
    if (!keys.size) summary.unknown++;
    if (cast.length !== movie.actresses.length) {
      database.upsertMovie({ ...movie, actresses: cast });
      summary.updated++;
    }
    if (summary.checked % 32 === 0) await new Promise(resolve => setImmediate(resolve));
  }
  return summary;
}

module.exports = { rescanActressMetadata };
