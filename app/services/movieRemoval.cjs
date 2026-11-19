'use strict';
function createMovieRemover({ database, confirm, trash, deletePermanently, stat = require("node:fs/promises").lstat, isGentleUnlocked = () => false }) {
  let busy = false;
  return async function removeMovies(ids, action) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 10000 || ids.some(id => typeof id !== 'string' || !id || id.length > 512)) throw new Error('Choose one or more movies to remove.');
    if (!['library','trash','delete-permanently'].includes(action)) throw new Error('Choose a removal action.');
    if (busy) throw new Error('Another removal is already in progress.');
    busy = true;
    const removed = [], failed = [], movies = [];
    try {
      for (const id of new Set(ids)) {
        const movie = database.getMovie(id);
        if (!movie) { failed.push({ id, error: 'Movie is unavailable. Use the missing-file review to remove an unavailable entry.' }); continue; }
        if (movie.libraryMode === 'gentle' && !isGentleUnlocked()) { failed.push({ id, error: 'Unlock Gentle mode first.' }); continue; }
        movies.push(movie);
      }
      if (!movies.length) return { removed, failed, cancelled: false };
      const isPermanent = action === 'delete-permanently';
      const isFileAction = action === 'trash' || isPermanent;
      const approved = await confirm({
        title: isPermanent ? 'Delete video files permanently' : action === 'trash' ? 'Remove video files' : 'Remove from library',
        message: isPermanent ? `Permanently delete ${movies.length} selected video file(s) and remove their library entries? This cannot be undone.` : action === 'trash' ? `Move ${movies.length} selected video file(s) to the Recycle Bin and remove their library entries?` : `Remove ${movies.length} selected movie(s) from the library?`,
        detail: movies.slice(0,10).map(movie => movie.title + '\n' + movie.sourcePath).join('\n\n') + (movies.length > 10 ? `\n\n…and ${movies.length - 10} more selected movies.` : '') + '\n\n' + (isPermanent ? 'WARNING: Video files will be permanently erased and cannot be recovered. Subtitles, posters, and other files stay on disk. If deletion fails, that movie stays in the library.' : action === 'trash' ? 'Only video files are moved. Subtitles, posters, and other files stay on disk. If recycling fails, that movie stays in the library.' : 'All video files, subtitles, and posters stay on disk. A future scan may add these movies again.'),
        button: isPermanent ? 'Delete permanently' : action === 'trash' ? 'Move videos to Recycle Bin' : 'Remove library entries'
      });
      if (!approved) return { removed, failed, cancelled: true };
      for (const displayed of movies) {
        try {
          const current = database.getMovie(displayed.id);
          if (!current || current.sourcePath !== displayed.sourcePath || current.libraryMode !== displayed.libraryMode) throw new Error('Movie changed while confirmation was open. Review it and try again.');
          if (current.libraryMode === 'gentle' && !isGentleUnlocked()) throw new Error('Gentle mode was locked.');
          if (isFileAction) {
            const info = await stat(current.sourcePath);
            if (!info.isFile() || info.isSymbolicLink() || !/\.(mp4|mkv|avi|mov|wmv|m4v|webm)$/i.test(current.sourcePath)) throw new Error('Only regular video files can be ' + (isPermanent ? 'deleted' : 'recycled') + '.');
            if (isPermanent) await deletePermanently(current.sourcePath);
            else await trash(current.sourcePath);
          }
          database.deleteMovie(current.id);
          removed.push(current.id);
        } catch (error) { failed.push({ id: displayed.id, error: error.message }); }
      }
      database.clearFileExistsCache?.();
      return { removed, failed, cancelled: false };
    } finally { busy = false; }
  };
}
module.exports = { createMovieRemover };
