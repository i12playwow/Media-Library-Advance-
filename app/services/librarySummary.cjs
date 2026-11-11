'use strict';
function librarySummary(database, gentleUnlocked = false) {
  const hasAvailability = database.db.prepare('PRAGMA table_info(movies)').all().some(column => column.name === 'source_missing');
  const rows = database.db.prepare('SELECT library_mode, COUNT(*) AS total' + (hasAvailability ? ', SUM(CASE WHEN source_missing = 0 THEN 1 ELSE 0 END) AS available' : '') + ' FROM movies' + (gentleUnlocked ? '' : " WHERE library_mode = 'normal'") + ' GROUP BY library_mode').all();
  const normal = rows.find(row => row.library_mode === 'normal') || { total: 0, available: 0 };
  const gentle = rows.find(row => row.library_mode === 'gentle') || { total: 0, available: 0 };
  const cataloged = Number(normal.total) + (gentleUnlocked ? Number(gentle.total) : 0);
  const available = hasAvailability ? Number(normal.available) + (gentleUnlocked ? Number(gentle.available) : 0) : null;
  return { cataloged, available, missing: available === null ? null : cataloged - available, normal: Number(normal.total), gentle: gentleUnlocked ? Number(gentle.total) : null, scope: gentleUnlocked ? 'all' : 'normal', byMode: {normal:{cataloged:Number(normal.total),available:hasAvailability?Number(normal.available):null,missing:hasAvailability?Number(normal.total)-Number(normal.available):null},gentle:gentleUnlocked?{cataloged:Number(gentle.total),available:hasAvailability?Number(gentle.available):null,missing:hasAvailability?Number(gentle.total)-Number(gentle.available):null}:null} };
}
module.exports = { librarySummary };
