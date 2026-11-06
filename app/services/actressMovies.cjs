'use strict';
function createActressMovieLinker({ database, isGentleUnlocked = () => false }) {
  return function linkActressMovies(name, ids) {
    if (typeof name !== 'string') throw new Error('Enter an actress name.');
    name = name.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!name || name.length > 120 || /[\x00-\x1f\x7f]/.test(name)) throw new Error('Enter an actress name of 1 to 120 characters.');
    if (!Array.isArray(ids) || !ids.length || ids.length > 10000 || ids.some(id => typeof id !== 'string' || !id || id.length > 512)) throw new Error('Select library movies to link.');
    const updated = [], failed = [];
    for (const id of new Set(ids)) {
      try {
        const movie = database.getMovie(id);
        if (!movie) throw new Error('Movie is unavailable.');
        if (movie.libraryMode === 'gentle' && !isGentleUnlocked()) throw new Error('Unlock Gentle mode first.');
        const actresses = movie.actresses || [];
        if (!actresses.some(value => value.toLocaleLowerCase() === name.toLocaleLowerCase())) database.upsertMovie({ ...movie, actresses: [...actresses, name] });
        updated.push(id);
      } catch (error) { failed.push({ id, error: error.message }); }
    }
    return { name, updated, failed };
  };
}
module.exports = { createActressMovieLinker };
