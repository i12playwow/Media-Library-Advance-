'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createDownloadQueue, filenameFor, mediaKind } = require('../app/services/browserDownloads.cjs');
const { Readable } = require('node:stream');

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeResponse(body, { total, status = 200, headers = {} } = {}) {
  // Readable.fromWeb on the consuming side expects a WEB ReadableStream.
  const source = body == null ? [] : (typeof body === 'string' ? [Buffer.from(body)] : body);
  const nodeStream = Readable.from(source);
  const stream = Readable.toWeb(nodeStream);
  const map = new Map(Object.entries({ 'content-length': String(total ?? 0), ...headers }));
  return {
    ok: status >= 200 && status < 300,
    status,
    body: stream,
    locked: false,
    cancel: async () => {},
    headers: { get: key => map.get(key) ?? map.get(key.toLowerCase()) ?? null },
    url: 'https://example.com/file.bin'
  };
}

test('classifies HLS/DASH manifests from URL or MIME type and names playlist files', () => {
  const response = { headers: { get: key => key === 'content-type' ? 'application/vnd.apple.mpegurl; charset=utf-8' : null } };
  assert.equal(mediaKind(response, 'https://cdn.example/watch?id=42'), 'hls-manifest');
  assert.equal(filenameFor(response, 'https://cdn.example/watch?id=42', 'hls-manifest'), 'watch.m3u8');
  assert.equal(mediaKind({ headers: { get: key => key === 'content-type' ? 'application/dash+xml' : null } }, 'https://cdn.example/manifest?token=1'), 'dash-manifest');
  assert.equal(filenameFor({ headers: { get: () => 'attachment; filename="stream.txt"' } }, 'https://cdn.example/manifest', 'dash-manifest'), 'stream.txt.mpd');
  assert.equal(mediaKind({ headers: { get: () => 'video/mp4' } }, 'https://cdn.example/clip.m3u8?token=1'), 'hls-manifest');
});

test('downloads complete with per-entry metadata (name, file path, totals)', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mla-dl-'));
  let published = [];
  const queue = createDownloadQueue({
    fetchFile: async () => fakeResponse(Buffer.from('hello download world'), { total: 20 }),
    publish: state => published.push(state),
    verify: () => {}
  });
  const states = [];
  queue.start(['https://example.com/file.bin'], dir);
  await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const s = queue.state();
      if (s.entries[0]?.status === 'completed') { clearInterval(timer); resolve(); }
    }, 25);
    setTimeout(() => reject(new Error('timeout')), 5000);
  });
  const entry = queue.state().entries[0];
  assert.equal(entry.status, 'completed');
  assert.equal(entry.name, 'file.bin');
  assert.equal(entry.received, 20);
  assert.equal(entry.total, 20);
  assert.ok(entry.file.startsWith(dir));
  const saved = await fs.readFile(path.join(dir, 'file.bin'), 'utf8');
  assert.equal(saved, 'hello download world');
  await fs.rm(dir, { recursive: true, force: true });
});

test('authenticated fetch receives the supplied abort signal and stores HLS as a playlist', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mla-dl-'));
  let receivedSignal;
  const queue = createDownloadQueue({
    fetchFile: async (_url, signal) => {
      receivedSignal = signal;
      return { ...fakeResponse(Buffer.from('#EXTM3U\\n#EXT-X-ENDLIST\\n'), { total: 24, headers: { 'content-type': 'application/vnd.apple.mpegurl' } }), url: 'https://example.com/watch?id=9' };
    },
    publish: () => {},
    verify: () => {}
  });
  queue.start(['https://example.com/watch?id=9'], dir);
  await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (queue.state().entries[0]?.status === 'completed') { clearInterval(timer); resolve(); }
    }, 25);
    setTimeout(() => reject(new Error('timeout')), 5000);
  });
  const entry = queue.state().entries[0];
  assert.equal(entry.kind, 'hls-manifest');
  assert.equal(entry.name, 'watch.m3u8');
  assert.ok(receivedSignal instanceof AbortSignal);
  assert.equal(await fs.readFile(entry.file, 'utf8'), '#EXTM3U\\n#EXT-X-ENDLIST\\n');
  await fs.rm(dir, { recursive: true, force: true });
});

test('manager: pauseEntry between chunks marks paused; resumeEntry finishes the job', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mla-dl-'));
  // Slow 100-chunk body; pause after the first chunk.
  const chunks = Array.from({ length: 100 }, (_, i) => Buffer.from([i]));
  let first = true;
  const gate = deferred();
  const queue = createDownloadQueue({
    fetchFile: async () => fakeResponse((async function* () {
      for (const chunk of chunks) {
        if (first) { first = false; gate.resolve(); }
        await new Promise(r => setTimeout(r, 15));
        yield chunk;
      }
    })(), { total: 100 }),
    publish: () => {},
    verify: () => {}
  });
  queue.start(['https://example.com/big.bin'], dir);
  await gate.promise;
  await new Promise(r => setTimeout(r, 30));
  queue.pauseEntry(queue.state().entries[0].id);
  await new Promise(r => setTimeout(r, 200));
  const paused = queue.state().entries[0];
  assert.equal(paused.status, 'paused');
  assert.ok(paused.received > 0 && paused.received < 100);
  assert.ok(paused.file, 'file path known while paused');
  queue.resumeEntry(paused.id);
  await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (queue.state().entries[0].status === 'completed') { clearInterval(timer); resolve(); }
    }, 25);
    setTimeout(() => reject(new Error('timeout: ' + JSON.stringify(queue.state().entries[0]))), 10000);
  });
  const done = queue.state().entries[0];
  assert.equal(done.received, 100);
  await fs.rm(dir, { recursive: true, force: true });
});

test('manager: cancelEntry marks cancelled; retryEntry restarts; removeEntry drops it', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mla-dl-'));
  let calls = 0;
  let release;
  const gate = new Promise(r => { release = r; });
  const queue = createDownloadQueue({
    fetchFile: async () => {
      calls++;
      if (calls === 1) {
        // hang until cancelled
        await gate;
        return fakeResponse(Buffer.from('x'), { total: 1 });
      }
      return fakeResponse(Buffer.from('done!'), { total: 5 });
    },
    publish: () => {},
    verify: () => {}
  });
  queue.start(['https://example.com/a.bin'], dir);
  await new Promise(r => setTimeout(r, 50));
  const id = queue.state().entries[0].id;
  queue.cancelEntry(id);
  // The in-flight fetch ignores the abort signal in this fake; unblock it so
  // the aborted throw lands and the outer catch marks the entry cancelled.
  release();
  await new Promise(r => setTimeout(r, 150));
  assert.equal(queue.state().entries[0].status, 'cancelled');
  queue.retryEntry(id);
  await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (queue.state().entries[0].status === 'completed') { clearInterval(timer); resolve(); }
    }, 25);
    setTimeout(() => reject(new Error('timeout')), 5000);
  });
  assert.equal(queue.state().entries[0].status, 'completed');
  queue.removeEntry(id);
  assert.equal(queue.state().entries.length, 0);
  await fs.rm(dir, { recursive: true, force: true });
});

test('manager: enqueue adds more links without wiping history; clearFinished trims', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mla-dl-'));
  const queue = createDownloadQueue({
    fetchFile: async url => fakeResponse(Buffer.from('data-of-' + url.slice(-4)), { total: 10 }),
    publish: () => {},
    verify: () => {}
  });
  queue.start(['https://example.com/one.bin'], dir);
  await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (queue.state().entries.every(e => e.status === 'completed')) { clearInterval(timer); resolve(); }
    }, 25);
    setTimeout(() => reject(new Error('timeout')), 5000);
  });
  queue.enqueue(['https://example.com/two.bin']);
  await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (queue.state().entries.length === 2 && queue.state().entries.every(e => e.status === 'completed')) { clearInterval(timer); resolve(); }
    }, 25);
    setTimeout(() => reject(new Error('timeout')), 5000);
  });
  assert.equal(queue.state().entries.length, 2);
  assert.equal(queue.state().summary.completed, 2);
  queue.clearFinished();
  assert.equal(queue.state().entries.length, 0);
  await fs.rm(dir, { recursive: true, force: true });
});

test('manager: openFile/showInFolder only work on completed entries', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mla-dl-'));
  const opened = [];
  const fakeShell = { openPath: async file => { opened.push(['open', file]); }, showItemInFolder: file => { opened.push(['folder', file]); } };
  const queue = createDownloadQueue({
    fetchFile: async () => fakeResponse(Buffer.from('abc'), { total: 3 }),
    publish: () => {},
    verify: () => {}
  });
  queue.start(['https://example.com/f.bin'], dir);
  await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (queue.state().entries[0].status === 'completed') { clearInterval(timer); resolve(); }
    }, 25);
    setTimeout(() => reject(new Error('timeout')), 5000);
  });
  const id = queue.state().entries[0].id;
  await queue.openFile(id, fakeShell);
  await queue.showInFolder(id, fakeShell);
  assert.deepEqual(opened.map(([kind]) => kind), ['open', 'folder']);
  await assert.rejects(queue.openFile('missing-id', fakeShell));
  await fs.rm(dir, { recursive: true, force: true });
});

test('manager: failures keep status failed with an error message, summary counts them', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mla-dl-'));
  const queue = createDownloadQueue({
    fetchFile: async () => fakeResponse(null, { status: 404 }),
    publish: () => {},
    verify: () => {}
  });
  queue.start(['https://example.com/missing.bin'], dir);
  await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (queue.state().entries[0].status === 'failed') { clearInterval(timer); resolve(); }
    }, 25);
    setTimeout(() => reject(new Error('timeout')), 5000);
  });
  const entry = queue.state().entries[0];
  assert.match(entry.error, /HTTP 404/);
  assert.equal(queue.state().summary.failed, 1);
  await fs.rm(dir, { recursive: true, force: true });
});
