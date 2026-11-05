function distinctPosterMovies(movies, groupCopies = true) {
  const ids = new Set(), groups = new Set();
  return movies.filter(movie => {
    if (ids.has(movie.id)) return false;
    ids.add(movie.id);
    if (!groupCopies) return true;
    const name = (movie.sourcePath || '').split(/[\\/]/).pop() || movie.title;
    const part = name.match(/(?:^|[\s._-])(?:part|pt|cd|disc|disk)[\s._-]*(\d+)(?=$|[\s._-])/i)?.[1] || '';
    const identity = movie.videoId ? 'id:' + movie.videoId.trim().toUpperCase() : movie.posterUrl ? 'title:' + movie.title.trim().toLowerCase() + ':' + (movie.year || '') + ':' + movie.posterUrl : 'record:' + movie.id;
    const key = JSON.stringify([movie.libraryMode, identity, part]);
    if (groups.has(key)) return false;
    groups.add(key);
    return true;
  });
}
module.exports = { distinctPosterMovies };
