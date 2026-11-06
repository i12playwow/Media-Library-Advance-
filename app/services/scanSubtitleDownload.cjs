'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { SubtitleWorkspace } = require('./subtitleWorkspace.cjs');
function createScanSubtitleDownloader(database, { language = 'en', resolveLongPath = true, cancelToken = {}, workspace } = {}) {
  const captions = workspace || new SubtitleWorkspace(database, { resolveLongPath, canSave: () => !cancelToken.cancelled });
  return async function downloadMissingSubtitle(id, mode) {
    if (cancelToken.cancelled) return 'Cancelled';
    let timer;
    const cancelled = new Promise(resolve => { timer = setInterval(() => { if (cancelToken.cancelled) resolve('Cancelled'); }, 50); });
    const work = (async () => {
      const movie = database.getMovie(id);
      if (!movie || movie.libraryMode !== mode) return 'Video unavailable';
      for (const subtitle of movie.subtitles || []) {
        try { await fs.access(subtitle.path); return 'Local subtitle already available'; } catch {}
      }
      if (movie.sourcePath) {
        const directory = path.dirname(movie.sourcePath), stem = path.basename(movie.sourcePath, path.extname(movie.sourcePath)).toLowerCase();
        try {
          for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            if (!entry.isFile() || !/\.(srt|vtt|ass|ssa)$/i.test(entry.name)) continue;
            const subStem = path.basename(entry.name, path.extname(entry.name)).toLowerCase();
            if (subStem !== stem && !subStem.startsWith(stem + '.') && !subStem.startsWith(stem + ' ')) continue;
            const language = entry.name.match(/\.([a-z]{2}(?:-[a-z]{2,4})?)\.(?:srt|vtt|ass|ssa)$/i)?.[1].toLowerCase() || 'und';
            database.upsertSubtitle(id, path.join(directory, entry.name), language);
            return 'Local subtitle already available';
          }
        } catch {}
      }
      const results = await captions.search(id, movie.videoId || movie.title, language, mode === 'gentle');
      if (cancelToken.cancelled) return 'Cancelled';
      if (!results.length) return `No ${language} subtitle found`;
      const result = await captions.download(id, results[0].id, mode === 'gentle');
      return result.saved ? `Saved ${result.language} subtitle` : result.warning || 'Subtitle could not be saved';
    })().catch(error => 'Subtitle download: ' + error.message);
    try { return await Promise.race([work, cancelled]); } finally { clearInterval(timer); }
  };
}
module.exports = { createScanSubtitleDownloader };
