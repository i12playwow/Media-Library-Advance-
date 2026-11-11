'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const LIMIT = 2 * 1024 * 1024;
const sharedCaptionCache = new Map();

function toVtt(content) {
  if (typeof content !== 'string' || Buffer.byteLength(content) > LIMIT) throw new Error('Subtitle file is too large.');
  const text = content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (!/(?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{3}\s*-->/.test(text) || /^\s*<(?:!doctype|html)/i.test(text)) throw new Error('The download did not contain timed SRT or VTT subtitles.');
  if (/^WEBVTT(?:\s|$)/.test(text)) return text;
  return 'WEBVTT\n\n' + text.replace(/^\d+\n/gm, '').replace(/(\d{1,2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
}
function languageMatches(result, language) {
  if (language === 'all') return true;
  const code = String(result.languageCode || '').toLowerCase();
  const name = String(result.language || '').toLowerCase();
  if (language === 'zh-hans') return ['zh', 'zh-hans', 'zh-cn', 'zh-sg'].includes(code) || name.includes('simplified');
  if (language === 'zh-hant') return ['zh', 'zh-hant', 'zh-tw', 'zh-hk'].includes(code) || name.includes('traditional');
  return code === language || code.startsWith(language + '-');
}
async function downloadContent(url, redirects = 0) {
  const target = new URL(url);
  if (target.protocol !== 'https:' || !/(^|\.)subtitlecat\.com$/i.test(target.hostname) || target.username || target.password) throw new Error('Subtitle download is unavailable.');
  const response = await fetch(target, { signal: AbortSignal.timeout(15000), redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/plain,*/*' } });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location'); await response.body?.cancel();
    if (!location || redirects >= 3) throw new Error('Subtitle redirect is unavailable.');
    return downloadContent(new URL(location, target).href, redirects + 1);
  }
  if (!response.ok || Number(response.headers.get('content-length')) > LIMIT) { await response.body?.cancel(); throw new Error('Subtitle download failed. Try another result.'); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > LIMIT) { await response.body.cancel().catch(() => {}); throw new Error('Subtitle file is too large.'); } chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}

class SubtitleWorkspace {
  constructor(database, options = {}) {
    this.database = database;
    this.resolveLongPath = options.resolveLongPath !== false;
    this.canSave = options.canSave || (() => true);
    this.searchProvider = options.searchProvider || (query => require('./subtitleCat.js').fetchSubtitleCatResults(query));
    this.downloadProvider = options.downloadProvider || downloadContent;
    this.results = new Map(); this.downloads = new Map(); this.captionCache = options.downloadProvider ? new Map() : sharedCaptionCache; this.completed = new Map();
  }
  async caption(url) {
    const cached = this.captionCache.get(url);
    if (cached && cached.expires > Date.now()) return cached.pending;
    const pending = this.downloadProvider(url).then(raw => { toVtt(raw); return raw; });
    this.captionCache.delete(url);
    this.captionCache.set(url, { pending, expires: Date.now() + 10 * 60 * 1000 });
    while (this.captionCache.size > 8) this.captionCache.delete(this.captionCache.keys().next().value);
    try { return await pending; } catch (error) { this.captionCache.delete(url); throw error; }
  }
  movie(id, allowGentle = false) {
    const movie = this.database.getMovie(id);
    if (!movie || (!allowGentle && movie.libraryMode !== 'normal')) throw new Error('Video is unavailable or locked.');
    return movie;
  }
  state(id, allowGentle = false) {
    const movie = this.movie(id, allowGentle);
    return { id: movie.id, title: movie.title, query: movie.videoId || movie.title, subtitles: movie.subtitles.filter(s => /\.(srt|vtt)$/i.test(s.path)).map(s => ({ id: s.id, language: s.language || 'und', name: path.basename(s.path) })) };
  }
  async search(id, query, language = 'en', allowGentle = false) {
    this.movie(id, allowGentle);
    if (typeof query !== 'string' || !query.trim() || query.length > 200) throw new Error('Enter a video title or ID to search.');
    if (typeof language !== 'string' || !/^(all|[a-z]{2}(?:-[a-z]{2,4})?)$/.test(language)) throw new Error('Choose a subtitle language.');
    const results = await this.searchProvider(query.trim());
    const now = Date.now();
    for (const [key, result] of this.results) if (result.expires < now) this.results.delete(key);
    const selected = results.filter(r => languageMatches(r, language)).sort((a, b) => (b.downloads || 0) - (a.downloads || 0)).slice(0, 50);
    return selected.map(result => {
      const key = crypto.randomBytes(16).toString('hex');
      this.results.set(key, { ...result, movieId: id, expires: now + 10 * 60 * 1000 });
      while (this.results.size > 500) this.results.delete(this.results.keys().next().value);
      return { id: key, title: result.title, language: result.language, languageCode: result.languageCode, downloads: result.downloads || 0 };
    });
  }
  async local(id, subtitleId, allowGentle = false) {
    const movie = this.movie(id, allowGentle);
    const subtitle = movie.subtitles.find(s => s.id === subtitleId && /\.(srt|vtt)$/i.test(s.path));
    if (!subtitle) throw new Error('Subtitle is no longer available.');
    let content;
    try {
      const stat = await fs.stat(subtitle.path);
      if (!stat.isFile() || stat.size > LIMIT) throw new Error('Unavailable');
      content = await fs.readFile(subtitle.path, 'utf8');
    } catch { throw new Error('Saved subtitle could not be read. Connect its disk and try again.'); }
    return { content: toVtt(content), language: subtitle.language || 'und', name: path.basename(subtitle.path) };
  }
  async download(id, resultId, allowGentle = false) {
    const movie = this.movie(id, allowGentle);
    const result = this.results.get(resultId);
    if (!result || result.movieId !== id || result.expires < Date.now()) throw new Error('Search again to refresh this download.');
    const key = id + ':' + movie.sourcePath + ':' + result.downloadUrl;
    if (this.downloads.has(key)) return this.downloads.get(key);
    const completed = this.completed.get(key);
    if (completed && completed.expires > Date.now()) {
      try { await fs.access(path.join(path.dirname(movie.sourcePath), completed.value.name)); return completed.value; } catch { this.completed.delete(key); }
    }
    if (this.downloads.has(key)) return this.downloads.get(key);
    const pending = (async () => {
      const raw = await this.caption(result.downloadUrl);
      if (!this.canSave()) throw new Error("Subtitle download cancelled.");
      const content = toVtt(raw);
      const language = /^[a-z]{2}(?:-[a-z]{2,4})?$/i.test(result.languageCode || '') ? result.languageCode.toLowerCase() : 'und';
      const extension = /^\uFEFF?WEBVTT/.test(raw) || raw.trimStart().startsWith('WEBVTT') ? '.vtt' : '.srt';
      const stem = path.basename(movie.sourcePath, path.extname(movie.sourcePath));
      let saved = false, name = '';
      try {
        for (let index = 0; index < 100; index++) {
          name = `${stem}.${language}${index ? '.' + index : ''}${extension}`;
          const target = require("./generatedFilePath.cjs").generatedFilePath(path.dirname(movie.sourcePath), stem, `.${language}${index ? "." + index : ""}${extension}`, this.resolveLongPath);
          name = path.basename(target);
          try { await fs.writeFile(target, raw, { encoding: 'utf8', flag: 'wx' }); } catch (error) { if (error.code === 'EEXIST') continue; throw error; }
          this.database.upsertSubtitle(id, target, language); saved = true; break;
        }
      } catch { /* Playback can still use the downloaded captions for this session. */ }
      return { content, language, name, saved, warning: saved ? '' : 'Applied for this session. Could not save beside the video; check disk access.' };
    })();
    this.downloads.set(key, pending);
    try {
      const value = await pending;
      if (value.saved) {
        this.completed.set(key, { value, expires: Date.now() + 10 * 60 * 1000 });
        while (this.completed.size > 8) this.completed.delete(this.completed.keys().next().value);
      }
      return value;
    } finally { this.downloads.delete(key); }
  }
}
function registerSubtitleWorkspace({ ipcMain, getDatabase, getWindow, getPlayerWindow, isGentleUnlocked }) {
  const workspace = new SubtitleWorkspace(getDatabase());
  for (const method of ['state', 'search', 'local', 'download']) ipcMain.handle(`subtitle-workspace:${method}`, (event, id, ...args) => {
    const { sender, senderFrame } = event;
    const trustedWindow = sender === getWindow()?.webContents || sender === getPlayerWindow?.()?.webContents;
    if (!trustedWindow || senderFrame !== sender.mainFrame) throw new Error('Unavailable outside the app player.');
    return workspace[method](id, ...args, Boolean(isGentleUnlocked()));
  });
  return workspace;
}
module.exports = { SubtitleWorkspace, registerSubtitleWorkspace, toVtt, languageMatches };
