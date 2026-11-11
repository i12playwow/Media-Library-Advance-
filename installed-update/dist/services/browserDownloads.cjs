'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

function decode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function filenameFor(response, url) {
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = disposition.match(/(?:^|;)\s*filename\*=UTF-8'[^']*'([^;]+)/i)?.[1];
  const plain = disposition.match(/(?:^|;)\s*filename=(?:"([^"]*)"|([^;]+))/i);
  const raw = (encoded ? decode(encoded) : plain?.[1] || plain?.[2]) || decode(path.posix.basename(new URL(url).pathname)) || 'download';
  let name = raw.replace(/[<>:"/\\|?*\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '_').trim().replace(/[. ]+$/, '');
  if (!name) name = 'download';
  if (/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)) name = '_' + name;
  const ext = path.extname(name).slice(0, 24);
  return name.slice(0, (ext ? name.length - path.extname(name).length : name.length)).slice(0, 130) + ext;
}

async function reserveFile(folder, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  for (let n = 0; n < 1000; n++) {
    const candidate = n ? `${base} (${n})${ext}` : name;
    const target = path.join(folder, candidate);
    try { return { target, handle: await fs.open(target, 'wx'), name: candidate }; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  throw new Error('Too many files with the same name in the download folder.');
}

function createDownloadQueue({ fetchFile, publish, verify }) {
  let entries = [];
  let folder;
  let running = false;
  let paused = null;
  let retryAt = 0;
  let controller;
  const automaticRetries = new Set();

  function state() { return { entries, folder, running, paused }; }
  const update = () => publish(state());

  async function run() {
    if (running || !folder) return;
    running = true;
    paused = null;
    controller = new AbortController();
    const { signal } = controller;
    update();
    try {
      for (const entry of entries) {
        if (signal.aborted) break;
        if (entry.status !== 'queued') continue;
        entry.status = 'downloading';
        entry.received = 0;
        update();
        let reserved;
        let response;
        try {
          response = await fetchFile(entry.url, signal);
          signal.throwIfAborted();
          if (response.headers.get('cf-mitigated') === 'challenge') {
            entry.status = 'queued';
            paused = 'verification';
            verify(response.url || entry.url);
            break;
          }
          if (response.status === 429) {
            const retry = response.headers.get('retry-after');
            const delay = /^\d+$/.test(retry || '') ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
            retryAt = Date.now() + (Number.isFinite(delay) ? Math.max(1000, delay) : 60_000);
            entry.status = 'queued';
            paused = 'rate-limit';
            break;
          }
          if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status}).`);
          const disposition = response.headers.get('content-disposition') || '';
          if (/^text\/html\b/i.test(response.headers.get('content-type') || '') && !/^attachment\b/i.test(disposition)) {
            throw new Error('This link opened a web page. Use a direct file link.');
          }
          signal.throwIfAborted();
          reserved = await reserveFile(folder, filenameFor(response, response.url || entry.url));
          entry.name = reserved.name;
          entry.total = Number(response.headers.get('content-length')) || 0;
          let lastUpdate = 0;
          const progress = new Transform({ transform(chunk, _encoding, callback) {
            entry.received += chunk.length;
            if (Date.now() - lastUpdate > 250) { lastUpdate = Date.now(); update(); }
            callback(null, chunk);
          } });
          await pipeline(Readable.fromWeb(response.body), progress, reserved.handle.createWriteStream(), { signal });
          entry.status = 'completed';
        } catch (error) {
          if (reserved) {
            await reserved.handle.close().catch(() => {});
            await fs.unlink(reserved.target).catch(() => {});
          }
          entry.status = signal.aborted ? 'cancelled' : 'failed';
          entry.error = signal.aborted ? '' : (error.code ? `Download failed (${error.code}).` : error.message);
        } finally {
          if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
        }
        update();
      }
    } finally {
      running = false;
      controller = undefined;
      update();
    }
  }

  return {
    state,
    start(urls, destination) {
      if (running || paused) return;
      folder = destination;
      entries = urls.map(url => ({ url, status: 'queued', received: 0 }));
      automaticRetries.clear();
      void run();
    },
    resume() {
      if (paused === 'rate-limit' && Date.now() < retryAt) throw new Error(`The site asked you to wait. Try again in ${Math.ceil((retryAt - Date.now()) / 1000)} seconds.`);
      if (paused) void run();
    },
    resumeAfterVerification() {
      if (running || paused !== 'verification') return;
      const entry = entries.find(item => item.status === 'queued');
      if (!entry || automaticRetries.has(entry.url)) return;
      automaticRetries.add(entry.url);
      void run();
    },
    cancel() {
      controller?.abort();
      paused = null;
      for (const entry of entries) if (entry.status === 'queued') entry.status = 'cancelled';
      update();
    }
  };
}

module.exports = { createDownloadQueue };
