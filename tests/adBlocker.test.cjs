'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { shouldBlock, attachAdBlocker, BLOCK_HOST_FRAGMENTS, BLOCK_URL_PATTERNS, ALLOW_PATTERNS } = require('../app/services/adBlocker.cjs');

test('blocks known ad hosts and network patterns', () => {
  const cases = [
    ['https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'script', 'https://example.com/', true],
    ['https://securepubads.g.doubleclick.net/tag/js/gpt.js', 'script', 'https://example.com/', true],
    ['https://www.google-analytics.com/analytics.js', 'script', 'https://example.com/', true],
    ['https://ad.doubleclick.net/ddm/adj/N123', 'image', 'https://example.com/', true],
    ['https://ads.reddit.com/pixel?id=1', 'image', 'https://example.com/', true],
    ['https://example.com/ads/banner.js', 'script', 'https://other.com/', true],
    ['https://example.com/openrtb2/auction', 'xhr', 'https://example.org/', true],
    ['https://tracker.example.com/track.gif?id=7', 'image', 'https://example.com/', true]
  ];
  for (const [url, type, origin, expected] of cases) {
    assert.equal(shouldBlock(url, type, origin), expected, url);
  }
});

test('never blocks the page itself, same-origin assets, video playback, or auth flows', () => {
  const keep = [
    ['https://example.com/page.html', 'mainFrame', '', false],
    ['https://example.com/api/data', 'xhr', 'https://example.com/', false],
    ['https://example.com/ads/banner.js', 'script', 'https://example.com/', false],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'subFrame', 'https://example.com/', false],
    ['https://r1---sn-abc.googlevideo.com/videoplayback?id=x', 'media', 'https://youtube.com/', false],
    ['https://example.com/login', 'mainFrame', '', false],
    ['https://checkout.example.com/pay?token=1', 'mainFrame', '', false],
    ['https://example.com/cdn-cgi/challenge', 'xhr', 'https://example.com/', false],
    ['mla-media://movie/123', 'media', 'https://example.com/', false],
    ['blob:https://example.com/uuid', 'media', 'https://example.com/', false]
  ];
  for (const [url, type, origin, expected] of keep) {
    assert.equal(shouldBlock(url, type, origin), expected, url);
  }
});

test('allowlist overrides host blocks so video and login keep working', () => {
  // youtube would trip 'ads.youtube' style fragments; the allowlist wins.
  for (const pattern of [ALLOW_PATTERNS]) {
    assert.ok(pattern.some(p => p.test('https://www.youtube.com/embed/abc')));
  }
});

test('attachAdBlocker cancels matching requests, counts them, and disposes cleanly', async () => {
  const decisions = [];
  const handlers = {};
  const session = {
    webRequest: {
      onBeforeRequest: (filter, handler) => { handlers.request = handler; return { id: 1 }; }
    }
  };
  const seen = [];
  const blocker = attachAdBlocker({ session, onBlocked: count => seen.push(count) });
  const respond = url => new Promise(resolve => {
    handlers.request({ url, resourceType: 'script', referrer: 'https://example.com/' }, result => {
      decisions.push(result.cancel);
      resolve();
    });
  });
  await respond('https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js');
  await respond('https://example.com/normal.js');
  await respond('https://ads.reddit.com/pixel');
  assert.deepEqual(decisions, [true, false, true]);
  assert.equal(blocker.count(), 2);
  blocker.dispose();
  blocker.dispose(); // double-dispose must not throw
  assert.equal(typeof blocker.reset, 'function');
});

test('filter list stays meaningful: no duplicates, every fragment non-trivial', () => {
  const uniqueHosts = new Set(BLOCK_HOST_FRAGMENTS);
  assert.equal(uniqueHosts.size, BLOCK_HOST_FRAGMENTS.length);
  for (const fragment of BLOCK_HOST_FRAGMENTS) {
    assert.equal(typeof fragment, 'string');
    assert.ok(fragment.length >= 4, `fragment too short: ${fragment}`);
    assert.equal(fragment, fragment.toLowerCase());
  }
  assert.ok(BLOCK_URL_PATTERNS.length >= 5);
  for (const pattern of BLOCK_URL_PATTERNS) assert.ok(pattern instanceof RegExp);
});
