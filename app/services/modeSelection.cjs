'use strict';
function selectModeIds(database, mode, gentleUnlocked) {
  if (mode !== 'normal' && mode !== 'gentle') throw new Error('Choose Normal or Gentle mode.');
  if (mode === 'gentle' && !gentleUnlocked) throw new Error('Unlock Gentle mode to select its videos.');
  return database.listMovies({ includeGentle: mode === 'gentle', query: '', limit: 2147483647, offset: 0 }).filter(movie => movie.libraryMode === mode).map(movie => movie.id);
}
module.exports = { selectModeIds };
