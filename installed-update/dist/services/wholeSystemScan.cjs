'use strict';
const fs = require('node:fs/promises');
const { isJavMoviePath } = require('./javScanFilter.cjs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const SKIP = new Set(['$recycle.bin', 'system volume information', 'windows', 'program files', 'program files (x86)', 'programdata', 'recovery', 'config.msi', 'appdata', 'node_modules', '.git', '.codex', '.agents', '.cache', '.npm', '.nuget', '.venv', '__pycache__', 'site-packages', 'diagnostics', 'test-results', '.pytest_cache', '$windows.~bt', '$windows.~ws']);
const VIDEO = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.m4v', '.webm']);
const SUBTITLE = new Set(['.srt', '.vtt', '.ass', '.ssa']);
async function connectedDrives({ cancelToken } = {}) {
  if (process.platform !== 'win32') return ['/'];
  const abort = new AbortController();
  const poll = setInterval(() => { if (cancelToken?.cancelled) abort.abort(); }, 50);
  try {
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "@(Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Root -match '^[A-Za-z]:\\\\$' } | Select-Object -ExpandProperty Root) | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 5000, maxBuffer: 16384, signal: abort.signal });
    const result = JSON.parse(stdout.trim().replace(/^\uFEFF/, ''));
    const roots = (Array.isArray(result) ? result : [result]).filter(root => typeof root === 'string' && /^[a-z]:\\$/i.test(root));
    if (roots.length) return [...new Set(roots)];
  } catch { /* Fall back to checking drive letters, without changing drive mappings. */ }
  finally { clearInterval(poll); }
  if (cancelToken?.cancelled) return [];
  const checks = await Promise.all('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(async letter => {
    const root = letter + ':\\';
    const accessible = await Promise.race([fs.access(root).then(() => true, () => false), new Promise(resolve => { const timer = setTimeout(() => resolve(false), 1000); timer.unref(); })]);
    return accessible ? root : null;
  }));
  return checks.filter(Boolean);
}
function within(file, directory) {
  const relative = path.relative(directory, file);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
async function scanWholeSystem(database, { roots, validateComplete = true, autoConvertToMp4 = false, javOnly = true, autoResolveDuplicates = false, mode = 'normal', cancelToken = { cancelled: false }, onProgress, excludedPaths = [], directoryTimeoutMs = 12000, heartbeatMs = 500, readDirectory = (directory) => fs.readdir(directory, { withFileTypes: true }) } = {}) {
  if (!['normal', 'gentle'].includes(mode)) throw new Error('Choose Normal or Gentle mode.');
  const scanRoots = [...new Set((roots || await connectedDrives()).map(root => path.resolve(root)))];
  if (!scanRoots.length && !cancelToken.cancelled) throw new Error('No accessible drives were found. Connect a drive and try again.');
  let imported = 0, skipped = 0, discovered = 0, directories = 0, lastProgress = 0;
  const invalidFiles = [];
  const errors = [], seen = new Set(), preferred = new Map();
  let duplicatesResolved = 0, skippedUnrecognized = 0;
  function duplicateKey(file) { return path.basename(file, path.extname(file)).toLowerCase().replace(/\b(2160|1080|720|480)p\b|\b4k\b/g, " ").replace(/[._]+/g, " ").replace(/\s+/g, " ").trim(); }
  function quality(file) { return Number(file.match(/\b(2160|1080|720|480)p\b/i)?.[1] || (/\b4k\b/i.test(file) ? 2160 : 0)); }
  const scannedRoots = { normal: mode === 'normal' ? scanRoots : [], gentle: mode === 'gentle' ? scanRoots : [] };
  function report(stage, root, file, force = false) {
    if (!force && Date.now() - lastProgress < 250) return;
    lastProgress = Date.now();
    onProgress?.({ stage, mode, currentRoot: root, currentFile: file, processedFiles: imported + skipped, totalFiles: discovered, imported, skipped, message: `Whole-system scan: ${discovered} videos found, ${imported} added; ${directories} folders checked. ${skippedUnrecognized} unrecognized files skipped. Files stay in place.` });
  }
  function warning(directory, error) { if (errors.length < 100) errors.push(`${directory}: ${error.code || 'Could not read folder'}`); }
  const waiting = new Map();
  async function readWithCancellation(directory, root) {
    let timer;
    const started = Date.now(); waiting.set(directory, root);
    const stopOrTimeout = new Promise((resolve, reject) => {
      const check = () => {
        if (cancelToken.cancelled) return resolve(null);
        if (Date.now() - started >= directoryTimeoutMs) return reject(Object.assign(new Error('Drive read timed out; drive skipped for this scan'), { code: 'ETIMEDOUT' }));
        timer = setTimeout(check, 50);
      };
      timer = setTimeout(check, 50);
    });
    try { return await Promise.race([Promise.resolve().then(() => readDirectory(directory)), stopOrTimeout]); }
    finally { clearTimeout(timer); waiting.delete(directory); }
  }
  report('preparing', null, null, true);
  const heartbeat = setInterval(() => { const item = waiting.entries().next().value; if (item) report('discovering', item[1], item[0], true); }, heartbeatMs);
  async function scanRoot(root) {
    const pending = [root];
    while (pending.length && !cancelToken.cancelled) {
      const directory = pending.pop();
      const key = process.platform === 'win32' ? directory.toLowerCase() : directory;
      if (seen.has(key) || excludedPaths.some(excluded => within(directory, excluded))) continue;
      seen.add(key);
      let entries;
      try { entries = await readWithCancellation(directory, root); if (entries === null) break; directories++; } catch (error) { warning(directory, error); if (error.code === 'ETIMEDOUT') break; continue; }
      const localSubtitles = entries.filter(entry => entry.isFile() && SUBTITLE.has(path.extname(entry.name).toLowerCase()));
      report('discovering', root, directory, directories === 1);
      for (const entry of entries) {
        if (cancelToken.cancelled) break;
        if (entry.isSymbolicLink()) continue;
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) { if (!SKIP.has(entry.name.toLowerCase())) pending.push(file); continue; }
        if (!entry.isFile() || !VIDEO.has(path.extname(entry.name).toLowerCase())) continue;
        discovered++;
        if (javOnly && !isJavMoviePath(file)) { skipped++; skippedUnrecognized++; report("processing", root, file); if (discovered % 32 === 0) await new Promise(resolve => setImmediate(resolve)); continue; }
        try {
          const existingId = database.findMovieIdBySourcePath(file);
          if (existingId) {
            const existing = database.getMovie?.(existingId);
            if (autoResolveDuplicates && existing?.libraryMode === mode) {
              const key = duplicateKey(file), previous = preferred.get(key);
              if (!previous) preferred.set(key, { id: existingId, file, existing: true });
              else if (previous.id !== existingId) {
                if (quality(file) > quality(previous.file)) { database.deleteMovie(previous.id); if (!previous.existing) imported--; preferred.set(key, { id: existingId, file, existing: true }); }
                else database.deleteMovie(existingId);
                duplicatesResolved++;
              }
            }
            skipped++; report('processing', root, file);
            if (discovered % 32 === 0) await new Promise(resolve => setImmediate(resolve));
            continue;
          }
          report("processing", root, file, true);
          if (validateComplete) {
            const result = await require("./videoImport.cjs").validateCompleteVideo(file, { cancelToken });
            if (!result.ok) { skipped++; invalidFiles.push({ path: file, reason: result.reason, status: result.status }); continue; }
          }
          let importFile = file;
          if (autoConvertToMp4 && path.extname(file).toLowerCase() !== ".mp4") {
            const target = path.join(directory, path.basename(file, path.extname(file)) + ".mp4");
            await require("./videoImport.cjs").convertVideoToMp4(file, target, { cancelToken });
            importFile = target;
          }
          const stem = path.basename(entry.name, path.extname(entry.name));
          const title = stem.replace(/[._]+/g, ' ').trim() || stem;
          const year = stem.match(/\b(19\d{2}|20\d{2})\b/);
          const resolution = stem.match(/\b(2160|1080|720|480)p\b/i)?.[0].toUpperCase() || (/\b4k\b/i.test(stem) ? '2160P' : 'Unknown');
          let videoId = null;
          try { videoId = require('../shared/videoId').extractVideoId(stem); } catch { videoId = stem.match(/[a-z]{2,8}-\d{2,7}/i)?.[0].toUpperCase() || null; }
          const id = database.createMovieId(importFile);
          const key = duplicateKey(file);
          const previous = autoResolveDuplicates ? preferred.get(key) : null;
          if (previous && quality(file) <= quality(previous.file)) { duplicatesResolved++; skipped++; continue; }
          database.upsertMovie({ id, title, year: year ? Number(year[1]) : null, videoId, sourcePath: importFile, folderPath: directory, libraryMode: mode, resolution, posterUrl: null, posterSource: 'none', actresses: [], keywords: [] });
          for (const subtitle of localSubtitles) {
            const subStem = path.basename(subtitle.name, path.extname(subtitle.name)).toLowerCase();
            const videoStem = stem.toLowerCase();
            if (subStem !== videoStem && !subStem.startsWith(videoStem + '.') && !subStem.startsWith(videoStem + ' ')) continue;
            const language = subtitle.name.match(/\.([a-z]{2}(?:-[a-z]{2,4})?)\.(srt|vtt|ass|ssa)$/i)?.[1].toLowerCase() || 'und';
            database.upsertSubtitle(id, path.join(directory, subtitle.name), language);
          }
          if (autoResolveDuplicates) {
            if (previous) { database.deleteMovie(previous.id); duplicatesResolved++; if (!previous.existing) imported--; }
            preferred.set(key, { id, file, existing: false });
          }
          imported++;
        } catch (error) { skipped++; warning(file, error); }
        report('processing', root, file);
        if (discovered % 32 === 0) await new Promise(resolve => setImmediate(resolve));
      }
    }
  }
  let nextRoot = 0;
  async function worker() { while (!cancelToken.cancelled && nextRoot < scanRoots.length) { const root = scanRoots[nextRoot++]; await scanRoot(root); } }
  try { await Promise.all(Array.from({ length: Math.min(3, scanRoots.length) }, () => worker())); }
  finally { clearInterval(heartbeat); }
  report(cancelToken.cancelled ? 'cancelled' : 'completed', null, null, true);
  return { discovered, imported, skipped, skippedUnrecognized, duplicatesResolved, errors, subtitleSearchLogs: [], invalidFiles, duplicateGroups: [], scannedRoots, cancelled: Boolean(cancelToken.cancelled) };
}
module.exports = { connectedDrives, scanWholeSystem, within };
