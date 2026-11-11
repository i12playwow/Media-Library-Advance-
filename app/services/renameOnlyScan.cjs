'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

const fileKey = file => process.platform === 'win32' ? file.toLowerCase() : file;

async function renameExclusive(source, target) {
  // Reserving the target works on external filesystems without hard links.
  const reservation = await fs.open(target, 'wx');
  try {
    await reservation.close();
    await fs.rename(source, target);
  } catch (error) {
    await fs.unlink(target).catch(() => {});
    throw error;
  }
}

async function renameScanCandidate(database, candidate, { organizationSettings, resolveLongPath, buildTargetVideoPath, readNfoMetadata, findMatchingSubtitles }) {
  const source = candidate.videoFile;
  const folder = path.dirname(source);
  const ext = path.extname(source);
  const oldStem = path.basename(source, ext);
  const id = database.findMovieIdBySourcePath(source);
  const existing = id ? database.getMovie(id) : null;
  if (existing && existing.libraryMode !== candidate.mode) return false;
  const nfo = await readNfoMetadata(source);
  const movie = existing || {
    id: database.createMovieId(source), title: nfo.title || candidate.parsed.title,
    year: nfo.year ?? candidate.parsed.year, videoId: nfo.videoId || candidate.parsed.videoId,
    sourcePath: source, folderPath: folder, libraryMode: candidate.mode,
    resolution: candidate.parsed.resolution, posterUrl: null, posterSource: 'none',
    actresses: nfo.actresses || [], keywords: candidate.parsed.keywords
  };
  const target = buildTargetVideoPath(folder, { ...movie, modelName: nfo.studio, organizationSettings, resolveLongPath }, ext);
  if (path.dirname(target) !== folder) throw new Error('The new filename must stay in the original folder.');
  const renamed = fileKey(source) !== fileKey(target);
  if (renamed && database.findMovieIdBySourcePath(target)) throw new Error('The new name is already used in the library.');
  const matches = await findMatchingSubtitles(source);
  const subtitles = new Map((existing?.subtitles || []).map(sub => [fileKey(sub.path), sub]));
  const subtitleSuffix = /^(?:\.[a-z]{2,3}(?:-[a-z]{2,4})?)?(?:\.(?:forced|sdh))?\.(?:srt|vtt|ass|ssa|sub|idx)$/i;
  for (const sub of matches) {
    const name = path.basename(sub.path);
    if (!fileKey(name).startsWith(fileKey(oldStem + '.')) || !subtitleSuffix.test(name.slice(oldStem.length))) continue;
    if (!subtitles.has(fileKey(sub.path))) subtitles.set(fileKey(sub.path), sub);
  }
  const moved = [];
  const paths = new Map();
  try {
    if (renamed) {
      const newStem = path.basename(target, path.extname(target));
      const sidecars = await fs.readdir(folder, { withFileTypes: true });
      const allowed = new Set([oldStem + '.nfo', oldStem + '.poster.jpg', path.basename(source) + '.nfo'].map(fileKey));
      const plan = [[source, target]];
      for (const entry of sidecars) {
        const from = path.join(folder, entry.name);
        if (!entry.isFile() || (!allowed.has(fileKey(entry.name)) && !subtitles.has(fileKey(from)))) continue;
        if (!fileKey(entry.name).startsWith(fileKey(oldStem + '.'))) continue;
        plan.push([from, path.join(folder, newStem + entry.name.slice(oldStem.length))]);
      }
      for (const [from, to] of plan) {
        await renameExclusive(from, to);
        moved.push([from, to]);
        paths.set(fileKey(from), to);
      }
    }
    const savedPath = renamed ? target : source;
    database.db.transaction(() => {
      if (existing) {
        if (renamed) database.updateMovieLocation(movie.id, { ...movie, sourcePath: savedPath });
      } else database.upsertMovie({ ...movie, sourcePath: savedPath });
      database.replaceSubtitles(movie.id, [...subtitles.values()].map(sub => {
        const file = paths.get(fileKey(sub.path)) || sub.path;
        return { ...sub, path: file, id: sub.id || database.createSubtitleId(movie.id, file) };
      }));
    })();
    return renamed || !existing ? { id: movie.id, path: savedPath } : false;
  } catch (error) {
    const failures = [];
    for (const [from, to] of moved.reverse()) {
      try { await renameExclusive(to, from); }
      catch { failures.push(to); }
    }
    if (failures.length) throw new Error(`Could not restore renamed files: ${failures.join(', ')}`);
    if (error.code === 'EEXIST') throw new Error('A video or sidecar with the new name already exists.');
    throw error;
  }
}

module.exports = { renameScanCandidate };
