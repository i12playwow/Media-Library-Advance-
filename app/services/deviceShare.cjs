'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const https = require('node:https');
const dns = require('node:dns/promises');
const { fileURLToPath } = require('node:url');

const IMAGE_LIMIT = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
function publicImageAddress(address) {
  const ip = address.replace(/^::ffff:/i, '');
  if (ip.includes(':')) return /^[23][a-f\d]{3}:/i.test(ip);
  const parts = ip.split('.').map(Number);
  return parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
    && !privateAddress(ip) && parts[0] !== 0 && parts[0] < 224
    && !(parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
    && !(parts[0] === 192 && parts[1] === 0);
}
async function downloadPoster(source, redirects = 0) {
  const url = new URL(source);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port))) throw new Error('Invalid image URL.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(item => !publicImageAddress(item.address))) throw new Error('Image host is not public.');
  const target = addresses[0];
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).get(url, {
      signal: AbortSignal.timeout(12000),
      headers: { 'User-Agent': 'Mozilla/5.0 MLAPlus', Accept: 'image/avif,image/webp,image/*' },
      lookup: (_hostname, options, callback) => options?.all ? callback(null, [target]) : callback(null, target.address, target.family)
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (redirects >= 3 || !response.headers.location) return reject(new Error('Image redirect unavailable.'));
        return resolve(downloadPoster(new URL(response.headers.location, url).href, redirects + 1));
      }
      const type = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (response.statusCode !== 200 || !IMAGE_TYPES.has(type) || Number(response.headers['content-length']) > IMAGE_LIMIT) {
        response.destroy(); return reject(new Error('Image unavailable.'));
      }
      let bytes = 0; const chunks = [];
      response.on('data', chunk => { bytes += chunk.length; if (bytes > IMAGE_LIMIT) response.destroy(new Error('Image too large.')); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => resolve({ type, data: Buffer.concat(chunks) }));
    });
    request.setTimeout(8000, () => request.destroy(new Error('Image request timed out.')));
    request.on('error', reject);
  });
}
async function readPoster(source) {
  if (typeof source !== 'string' || !source) throw new Error('No poster.');
  if (/^https?:/i.test(source)) return downloadPoster(source);
  const match = /^data:(image\/(?:jpeg|png|webp|gif|avif));base64,([a-z\d+/=\s]+)$/i.exec(source);
  if (match) {
    if (match[2].length > IMAGE_LIMIT * 1.4) throw new Error('Image too large.');
    const data = Buffer.from(match[2], 'base64');
    if (!data.length || data.length > IMAGE_LIMIT) throw new Error('Image unavailable.');
    return { type: match[1].toLowerCase(), data };
  }
  const local = /^file:/i.test(source) ? fileURLToPath(source) : source;
  const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' };
  const type = types[path.extname(local).toLowerCase()];
  if (!type || !path.isAbsolute(local) || local.startsWith('\\\\')) throw new Error('Image unavailable.');
  const stat = await fsp.stat(local);
  if (!stat.isFile() || stat.size > IMAGE_LIMIT) throw new Error('Image unavailable.');
  return { type, data: await fsp.readFile(local) };
}

const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.ts': 'video/mp2t' };
function privateAddress(address = '') {
  const ip = address.replace(/^::ffff:/, '');
  return ip === '::1' || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip) || /^(fc|fd|fe80:)/i.test(ip);
}
function parseRange(value, size) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) throw new Error('range');
  let start, end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix < 1) throw new Error('range');
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) throw new Error('range');
  return { start, end };
}

class DeviceShareServer {
  constructor(database, options = {}) { this.database = database; this.subtitles = options.subtitles || new (require('./subtitleWorkspace.cjs').SubtitleWorkspace)(database); this.server = null; this.pending = null; this.token = null; this.posterCache = new Map(); this.posterPending = new Map(); this.posterBytes = 0; this.posterActive = 0; this.posterQueue = []; }
  async poster(source) {
    if (this.posterCache.has(source)) return this.posterCache.get(source);
    if (this.posterPending.has(source)) return this.posterPending.get(source);
    const task = (async () => {
      if (this.posterActive >= 4) await new Promise(resolve => this.posterQueue.push(resolve));
      else this.posterActive++;
      try {
        const result = await readPoster(source);
        while (this.posterBytes + result.data.length > 32 * 1024 * 1024 && this.posterCache.size) {
          const oldest = this.posterCache.keys().next().value;
          this.posterBytes -= this.posterCache.get(oldest).data.length; this.posterCache.delete(oldest);
        }
        this.posterCache.set(source, result); this.posterBytes += result.data.length;
        return result;
      } finally { const next = this.posterQueue.shift(); if (next) next(); else this.posterActive--; }
    })();
    this.posterPending.set(source, task);
    try { return await task; } finally { this.posterPending.delete(source); }
  }
  state() {
    const port = this.server?.address()?.port;
    const addresses = [...new Set(Object.values(os.networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal && privateAddress(n.address)).map(n => n.address))];
    return { enabled: Boolean(port), port: port || null, urls: port ? addresses.map(ip => `http://${ip}:${port}/s/${this.token}/`) : [] };
  }
  async start(port = 48321) {
    if (this.server?.listening) return this.state();
    if (this.pending) return this.pending;
    this.pending = (async () => {
      this.token = crypto.randomBytes(24).toString('hex');
      const server = http.createServer((req, res) => this.handle(req, res).catch(() => { if (!res.headersSent) res.writeHead(500); res.end('Unable to read this media.'); }));
      server.requestTimeout = 30000; server.headersTimeout = 15000;
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '0.0.0.0', () => { server.removeListener('error', reject); resolve(); });
      }).catch(async error => {
        if (error.code !== 'EADDRINUSE' || port === 0) throw error;
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '0.0.0.0', () => { server.removeListener('error', reject); resolve(); }); });
      });
      this.server = server;
      server.on('error', () => { void this.stop(); });
      return this.state();
    })();
    try { return await this.pending; } finally { this.pending = null; }
  }
  async stop() {
    if (this.pending) { try { await this.pending; } catch {} }
    const server = this.server; this.server = null; this.token = null;
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    return this.state();
  }
  async handle(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    const fail = (code, message) => { res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(message); };
    if (!privateAddress(req.socket.remoteAddress)) return fail(403, 'Local network access only.');
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const prefix = `/s/${this.token}/`;
    if (!this.token || !pathname.startsWith(prefix)) return fail(404, 'This sharing link is unavailable. Get the current link from MLA+.');
    const route = pathname.slice(prefix.length);
    if (req.method === 'POST' && route === 'api/subtitles/download') {
      if (req.headers.origin !== `http://${req.headers.host}`) return fail(403, 'Use the subtitle controls on the sharing page.');
      try {
        let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 4096) return fail(413, 'Request is too large.'); }
        const input = JSON.parse(body);
        const result = await this.subtitles.download(input.movieId, input.resultId, false);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify(result));
      } catch (error) { return fail(400, error.message || 'Subtitle download failed.'); }
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return fail(405, 'Videos are read-only.'); }
    if (route.startsWith('api/subtitles/')) {
      const url = new URL(req.url, 'http://localhost'); const id = url.searchParams.get('movie');
      try {
        let result;
        if (route === 'api/subtitles/state') result = this.subtitles.state(id, false);
        else if (route === 'api/subtitles/search') result = await this.subtitles.search(id, url.searchParams.get('q'), url.searchParams.get('language') || 'en', false);
        else if (route === 'api/subtitles/local') result = await this.subtitles.local(id, url.searchParams.get('subtitle'), false);
        else return fail(404, 'Not found.');
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(req.method === 'HEAD' ? undefined : JSON.stringify(result));
      } catch (error) { return fail(400, error.message || 'Subtitles are unavailable.'); }
    }
    if (route === 'api/movies') {
      const url = new URL(req.url, 'http://localhost');
      const page = Math.min(100000, Math.max(0, Number.parseInt(url.searchParams.get('page') || '0', 10) || 0));
      const query = (url.searchParams.get('q') || '').slice(0, 200);
      const movies = this.database.listMovies({ includeGentle: false, query, limit: 40, offset: page * 40 });
      const total = this.database.countMovies({ includeGentle: false, query });
      const items = movies.map(m => ({ id: m.id, title: m.title, year: m.year, videoId: m.videoId, resolution: m.resolution, hasPoster: Boolean(m.posterUrl), subtitleCount: m.subtitles?.length || 0 }));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ items, total, page, hasMore: (page + 1) * 40 < total }));
    }
    if (route.startsWith('poster/')) {
      let id; try { id = decodeURIComponent(route.slice(7)); } catch { return fail(400, 'Invalid poster.'); }
      if (!id || id.length > 200 || /[\/\\]/.test(id)) return fail(404, 'Poster unavailable.');
      const movie = this.database.getMovie(id);
      if (!movie || movie.libraryMode !== 'normal' || !movie.posterUrl) return fail(404, 'Poster unavailable.');
      try {
        const image = await this.poster(movie.posterUrl);
        if (res.destroyed) return;
        res.writeHead(200, { 'Content-Type': image.type, 'Content-Length': image.data.length });
        return res.end(req.method === 'HEAD' ? undefined : image.data);
      } catch { return fail(404, 'Poster unavailable.'); }
    }
    if (route.startsWith('video/')) {
      let id; try { id = decodeURIComponent(route.slice(6)); } catch { return fail(400, 'Invalid video.'); }
      if (!id || id.length > 200 || /[\/\\]/.test(id)) return fail(404, 'Video unavailable.');
      const movie = this.database.getMovie(id);
      if (!movie || movie.libraryMode !== 'normal') return fail(404, 'Video unavailable.');
      let file;
      try { file = await fsp.open(movie.sourcePath, 'r'); } catch { return fail(404, 'Video offline. Connect its disk to the computer and try again.'); }
      try {
        const stat = await file.stat();
        if (!stat.isFile()) { await file.close(); return fail(404, 'Video unavailable.'); }
        let range;
        try { range = parseRange(req.headers.range, stat.size); } catch { await file.close(); res.setHeader('Content-Range', `bytes */${stat.size}`); return fail(416, 'Requested range is unavailable.'); }
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', MIME[path.extname(movie.sourcePath).toLowerCase()] || 'application/octet-stream');
        if (range) res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`);
        res.setHeader('Content-Length', range ? range.end - range.start + 1 : stat.size);
        res.writeHead(range ? 206 : 200);
        if (req.method === 'HEAD' || stat.size === 0) { await file.close(); return res.end(); }
        const stream = file.createReadStream(range || {});
        stream.on('error', () => res.destroy());
        res.on('close', () => stream.destroy());
        stream.pipe(res);
      } catch (error) { await file.close().catch(() => {}); throw error; }
      return;
    }
    const assets = { '': ['mobile.html', 'text/html'], 'mobile.js': ['mobile.js', 'text/javascript'], 'mobile.css': ['mobile.css', 'text/css'], 'subtitle-workspace.js': ['../subtitle-workspace/common.js', 'text/javascript'], 'subtitle-workspace.css': ['../subtitle-workspace/common.css', 'text/css'] };
    if (!Object.hasOwn(assets, route)) return fail(404, 'Not found.');
    const [file, type] = assets[route];
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    const content = await fsp.readFile(path.join(__dirname, '../renderer/device-share', file));
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Content-Length': content.length });
    res.end(req.method === 'HEAD' ? undefined : content);
  }
}

function registerDeviceSharing({ app, ipcMain, getDatabase, getWindow }) {
  const sharing = new DeviceShareServer(getDatabase());
  for (const [name, action] of Object.entries({ state: () => sharing.state(), start: () => sharing.start(), stop: () => sharing.stop(), copy: text => {
    if (!sharing.state().urls.includes(text)) throw new Error('Sharing link is no longer active.');
    require('electron').clipboard.writeText(text);
  } })) {
    ipcMain.handle(`device-share:${name}`, (event, value) => {
      if (event.sender !== getWindow()?.webContents) throw new Error('Unavailable outside the main app.');
      return action(value);
    });
  }
  app.on('before-quit', () => { void sharing.stop(); });
  return sharing;
}
module.exports = { DeviceShareServer, registerDeviceSharing, parseRange, privateAddress, readPoster, publicImageAddress };
