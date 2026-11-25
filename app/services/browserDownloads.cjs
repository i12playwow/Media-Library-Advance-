'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

function decode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function mediaKind(response, url) {
  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  let pathname = '';
  try { pathname = new URL(url).pathname.toLowerCase(); } catch { /* invalid URLs are rejected before download */ }
  if (contentType === 'application/vnd.apple.mpegurl' || contentType === 'application/x-mpegurl' || contentType === 'audio/mpegurl' || /\.m3u8$/i.test(pathname)) return 'hls-manifest';
  if (contentType === 'application/dash+xml' || /\.mpd$/i.test(pathname)) return 'dash-manifest';
  return 'file';
}

function filenameFor(response, url, kind = 'file') {
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = disposition.match(/(?:^|;)\s*filename\*=UTF-8'[^']*'([^;]+)/i)?.[1];
  const plain = disposition.match(/(?:^|;)\s*filename=(?:"([^"]*)"|([^;]+))/i);
  const fallback = decode(path.posix.basename(new URL(url).pathname)) || 'download';
  let raw = (encoded ? decode(encoded) : plain?.[1] || plain?.[2]) || fallback;
  if (kind === 'hls-manifest' && !/\.m3u8$/i.test(raw)) raw += '.m3u8';
  if (kind === 'dash-manifest' && !/\.mpd$/i.test(raw)) raw += '.mpd';
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

const MAX_HISTORY = 500;

function createDownloadQueue({ fetchFile, publish, verify, shell }) {
  let entries = [];      // full managed list, newest last
  let folder;            // default destination folder
  let running = false;
  let paused = null;     // 'verification' | 'rate-limit' | null
  let retryAt = 0;
  let controller;
  const automaticRetries = new Set();
  // per-entry pause flags: entry.pauseRequested is honoured between chunks
  const PARALLEL = 3;

  function state() {
    return {
      entries,
      folder,
      running,
      paused,
      summary: summarize()
    };
  }

  function summarize() {
    const completed = entries.filter(e => e.status === 'completed');
    const active = entries.filter(e => e.status === 'downloading');
    const failed = entries.filter(e => e.status === 'failed');
    let received = 0, total = 0;
    for (const e of entries) { received += e.received || 0; total += e.total || 0; }
    // speed: bytes in the last second across active entries
    const now = Date.now();
    let speed = 0;
    for (const e of active) {
      if (e.speedSamples?.length) {
        speed += e.speedSamples[e.speedSamples.length - 1].bytesPerSec || 0;
      }
    }
    void now;
    return { completed: completed.length, active: active.length, failed: failed.length, received, total, speed };
  }

  const update = () => publish(state());

  function noteSpeed(entry) {
    // rolling per-entry speed (bytes/sec over the last ~2s)
    if (!entry.speedSamples) entry.speedSamples = [];
    const now = Date.now();
    const window = 2000;
    entry.speedSamples = entry.speedSamples.filter(s => now - s.at < window);
    const oldest = entry.speedSamples[0];
    const elapsed = oldest ? (now - oldest.at) / 1000 : 0;
    const bytes = entry.received - (oldest ? oldest.received : 0);
    entry.speed = elapsed > 0.3 ? Math.round(bytes / elapsed) : (entry.speed || 0);
    entry.speedSamples.push({ at: now, received: entry.received });
  }

  async function downloadOne(entry, signal) {
    entry.status = 'downloading';
    entry.received = 0;
    entry.error = '';
    entry.pauseRequested = false;
    entry.cancelRequested = false;
    entry.speed = 0;
    entry.controller = new AbortController();
    const entrySignal = AbortSignal.any ? AbortSignal.any([signal, entry.controller.signal]) : signal;
    update();
    let reserved;
    let response;
    try {
      response = await fetchFile(entry.url, entrySignal);
      entrySignal.throwIfAborted();
      if (response.headers.get('cf-mitigated') === 'challenge') {
        entry.status = 'queued';
        paused = 'verification';
        verify(response.url || entry.url);
        update();
        return 'verification';
      }
      if (response.status === 429) {
        const retry = response.headers.get('retry-after');
        const delay = /^\d+$/.test(retry || '') ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
        retryAt = Date.now() + (Number.isFinite(delay) ? Math.max(1000, delay) : 60_000);
        entry.status = 'queued';
        paused = 'rate-limit';
        update();
        return 'rate-limit';
      }
      if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status}).`);
      const kind = mediaKind(response, response.url || entry.url);
      entry.kind = kind;
      const disposition = response.headers.get('content-disposition') || '';
      if (/^text\/html\b/i.test(response.headers.get('content-type') || '') && !/^attachment\b/i.test(disposition)) {
        throw new Error('This link opened a web page. Use a direct file link.');
      }
      signal.throwIfAborted();
      reserved = await reserveFile(folder, filenameFor(response, response.url || entry.url, kind));
      entry.name = reserved.name;
      entry.file = reserved.target;
      entry.total = Number(response.headers.get('content-length')) || 0;
      entry.startedAt = Date.now();
      let lastUpdate = 0;
      const progress = new Transform({ transform(chunk, _encoding, callback) {
        entry.received += chunk.length;
        // honour a per-entry cancel/pause immediately (checked per chunk)
        if (entry.cancelRequested) {
          entry.status = 'cancelled';
          callback(new Error('cancelled'));
          return;
        }
        if (entry.pauseRequested) {
          entry.status = 'paused';
          entry.pauseRequested = false;
          callback(new Error('paused'));
          return;
        }
        if (Date.now() - lastUpdate > 250) {
          lastUpdate = Date.now();
          noteSpeed(entry);
          update();
        }
        callback(null, chunk);
      } });
      try {
        await pipeline(Readable.fromWeb(response.body), progress, reserved.handle.createWriteStream(), { signal });
        entry.status = 'completed';
        entry.finishedAt = Date.now();
        entry.speed = 0;
      } catch (error) {
        if (entry.status === 'paused' && !signal.aborted) {
          // Keep partial file handle open? Simpler: close and mark paused;
          // retry restarts the file (no resume support for arbitrary servers).
          await reserved.handle.close().catch(() => {});
          await fs.unlink(reserved.target).catch(() => {});
          update();
          return 'paused';
        }
        throw error;
      }
    } catch (error) {
      if (reserved) {
        await reserved.handle.close().catch(() => {});
        await fs.unlink(reserved.target).catch(() => {});
      }
      entry.status = signal.aborted || entry.cancelRequested ? 'cancelled' : 'failed';
      entry.error = signal.aborted || entry.cancelRequested ? '' : (error.code ? `Download failed (${error.code}).` : error.message);
      entry.speed = 0;
    } finally {
      if (response?.body && typeof response.body.cancel === 'function' && !response.body.locked) void response.body.cancel().catch(() => {});
      else if (response?.body && typeof response.body.destroy === 'function') response.body.destroy();
    }
    update();
    return entry.status;
  }

  async function run() {
    if (running) return;
    running = true;
    paused = null;
    controller = new AbortController();
    const { signal } = controller;
    update();
    try {
      // Parallel worker pool over queued entries, PARALLEL at a time.
      const workers = Array.from({ length: PARALLEL }, async () => {
        while (!signal.aborted) {
          const entry = entries.find(item => item.status === 'queued' && !item.pauseRequested);
          if (!entry) return;
          const outcome = await downloadOne(entry, signal);
          if (outcome === 'verification' || outcome === 'rate-limit') {
            controller.abort(); // stop other workers; queue-level pause
            return;
          }
        }
      });
      await Promise.all(workers);
    } finally {
      running = false;
      controller = undefined;
      update();
    }
  }

  const api = {
    state,
    start(urls, destination) {
      if (running || paused) return;
      folder = destination;
      entries = urls.map(url => ({ id: `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, url, status: 'queued', received: 0 }));
      automaticRetries.clear();
      void run();
    },
    /** Manager: enqueue more links into the existing list (keeps history). */
    enqueue(urls, destination) {
      if (destination) folder = destination;
      for (const url of urls) {
        if (entries.some(entry => entry.url === url && ['queued', 'downloading', 'paused'].includes(entry.status))) continue;
        entries.push({ id: `dl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, url, status: 'queued', received: 0 });
      }
      if (!running && !paused) void run();
      else update();
    },
    resume() {
      if (paused === 'rate-limit' && Date.now() < retryAt) throw new Error(`The site asked you to wait. Try again in ${Math.ceil((retryAt - Date.now()) / 1000)} seconds.`);
      if (paused) void run();
      else if (!running) {
        // resume individually-paused entries
        const anyPaused = entries.some(entry => entry.status === 'paused');
        if (anyPaused && folder) {
          for (const entry of entries) if (entry.status === 'paused') entry.status = 'queued';
          void run();
        }
      }
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
    },
    /** Pause a single entry (takes effect between chunks). */
    pauseEntry(id) {
      const entry = entries.find(item => item.id === id);
      if (!entry) return;
      if (entry.status === 'downloading') entry.pauseRequested = true;
      else if (entry.status === 'queued') { entry.status = 'paused'; update(); }
    },
    /** Resume one paused entry. */
    resumeEntry(id) {
      const entry = entries.find(item => item.id === id);
      if (!entry || entry.status !== 'paused') return;
      entry.status = 'queued';
      entry.pauseRequested = false;
      if (!running && !paused && folder) void run();
      else update();
    },
    /** Cancel one entry: aborts its in-flight request immediately. */
    cancelEntry(id) {
      const entry = entries.find(item => item.id === id);
      if (!entry) return;
      if (entry.status === 'downloading') {
        entry.cancelRequested = true;
        entry.controller?.abort();
      } else if (['queued', 'paused', 'failed'].includes(entry.status)) {
        entry.status = 'cancelled';
        update();
      }
    },
    /** Retry a failed/cancelled entry. */
    retryEntry(id) {
      const entry = entries.find(item => item.id === id);
      if (!entry || !['failed', 'cancelled'].includes(entry.status)) return;
      entry.status = 'queued';
      entry.error = '';
      entry.cancelRequested = false;
      entry.pauseRequested = false;
      if (!running && !paused && folder) void run();
      else update();
    },
    /** Remove an entry from the list (history hygiene). */
    removeEntry(id) {
      const entry = entries.find(item => item.id === id);
      if (!entry || entry.status === 'downloading') return;
      entries = entries.filter(item => item.id !== id);
      update();
    },
    clearFinished() {
      entries = entries.filter(entry => !['completed', 'cancelled', 'failed'].includes(entry.status));
      update();
    },
    /** Open a completed file with the OS default application. */
    async openFile(id, shellApi) {
      const entry = entries.find(item => item.id === id);
      if (!entry?.file || entry.status !== 'completed') throw new Error('Only completed downloads can be opened.');
      await (shellApi ?? shell()).openPath(entry.file);
    },
    /** Reveal a completed file in Explorer. */
    async showInFolder(id, shellApi) {
      const entry = entries.find(item => item.id === id);
      if (!entry?.file || entry.status !== 'completed') throw new Error('Only completed downloads can be located.');
      await (shellApi ?? shell()).showItemInFolder(entry.file);
    },
    /** Trim history to the last MAX_HISTORY entries. */
    pruneHistory() {
      if (entries.length > MAX_HISTORY) entries = entries.slice(-MAX_HISTORY);
    }
  };
  return api;
}

function shell() {
  // lazy require so tests without electron still work
  return require('electron').shell;
}

module.exports = { createDownloadQueue, filenameFor, mediaKind };
