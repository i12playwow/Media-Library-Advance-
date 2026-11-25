'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { discoverPageMedia, validateMediaResults } = require('../app/services/browserMediaDetection.cjs');

test('finds element sources, publisher metadata, JSON-LD, and loaded media requests', () => {
  const source = { src: 'https://cdn.example/track.m3u8?token=1', type: 'application/x-mpegURL', getAttribute: key => key === 'label' ? 'Adaptive' : null };
  const video = { currentSrc: 'https://cdn.example/video.mp4#play', src: '', getAttribute: () => 'Main video', querySelectorAll: () => [source] };
  const meta = { content: '/social.mp4', getAttribute: key => key === 'property' ? 'og:video' : null };
  const jsonLd = { textContent: JSON.stringify({ '@type': 'VideoObject', contentUrl: 'https://cdn.example/schema.webm' }) };
  const selectors = {
    'video, audio': [video],
    'source[src]': [source],
    'meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"],meta[name="twitter:player:stream"],meta[name="twitter:player:stream:content_type"]': [meta],
    'script[type="application/ld+json"]': [jsonLd]
  };
  global.document = { baseURI: 'https://site.example/watch', querySelectorAll: selector => selectors[selector] || [] };
  global.performance = { getEntriesByType: () => [{ name: 'https://cdn.example/segment.mp4?part=2' }, { name: 'https://cdn.example/page.js' }] };
  try {
    const results = discoverPageMedia();
    assert.deepEqual(results.map(item => item.url), [
      'https://cdn.example/video.mp4', 'https://cdn.example/track.m3u8?token=1',
      'https://site.example/social.mp4', 'https://cdn.example/schema.webm',
      'https://cdn.example/segment.mp4?part=2'
    ]);
    assert.deepEqual(results.find(item => item.url.includes('.m3u8')), {
      url: 'https://cdn.example/track.m3u8?token=1',
      label: 'Adaptive [HLS manifest]', kind: 'manifest', mimeType: 'application/x-mpegurl'
    });
    assert.equal(results.some(item => item.url.endsWith('page.js')), false);
  } finally { delete global.document; delete global.performance; }
});

test('rejects non-web, credential-bearing, overlong, and duplicate results', () => {
  const valid = validateMediaResults([
    { url: 'file:///C:/secret.mp4' },
    { url: 'https://user:pass@example.com/video.mp4' },
    { url: `https://example.com/${'x'.repeat(8200)}.mp4` },
    { url: 'https://cdn.example/clip.mp4#one', label: 'first' },
    { url: 'https://cdn.example/clip.mp4#two', label: 'duplicate' },
    { url: 'https://cdn.example/stream.mpd' }
  ]);
  assert.equal(valid.length, 2);
  assert.deepEqual(valid[0], { url: 'https://cdn.example/clip.mp4', label: 'first', kind: 'file' });
  assert.equal(valid[1].kind, 'manifest');
});

test('caps results at 100 and tolerates malformed JSON-LD', () => {
  global.document = {
    baseURI: 'https://site.example/',
    querySelectorAll: selector => selector === 'script[type="application/ld+json"]' ? [{ textContent: '{bad json' }] : []
  };
  global.performance = { getEntriesByType: () => Array.from({ length: 150 }, (_, i) => ({ name: `https://cdn.example/${i}.mp4` })) };
  try { assert.equal(discoverPageMedia().length, 100); }
  finally { delete global.document; delete global.performance; }
});
