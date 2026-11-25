'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyRequest, shouldBlock, upgradeConnection, createShields,
  BLOCK_HOST_FRAGMENTS, TRACKER_HOST_FRAGMENTS
} = require('../app/services/adBlocker.cjs');

const STANDARD = { level: 'standard', blockAds: true, blockTrackers: true, blockFingerprinting: true };

test('classifyRequest tags each blocked request with a category', () => {
  const cases = [
    ['https://securepubads.g.doubleclick.net/tag/js/gpt.js', 'script', 'ad'],
    ['https://www.google-analytics.com/analytics.js', 'script', 'tracker'],
    ['https://www.googletagmanager.com/gtm.js?id=GTM-1', 'script', 'tracker'],
    ['https://example.com/ads/300x250.png', 'image', 'ad', 'https://shop.example/']
  ];
  for (const [url, type, category, origin = 'https://example.com/'] of cases) {
    const decision = classifyRequest(url, type, origin, STANDARD);
    assert.equal(decision.block, true, url);
    assert.equal(decision.category, category, url);
  }
});

test('a URL matched only by the ad list is reported as an ad, not a tracker', () => {
  // fbevents.js is in the network ad patterns; connect.facebook.net is not a
  // tracker host, so it must stay in the 'ad' bucket.
  const decision = classifyRequest('https://connect.facebook.net/en_US/fbevents.js', 'script', 'https://example.com/', STANDARD);
  assert.equal(decision.block, true);
  assert.equal(decision.category, 'ad');
});

test('shields level gates every category', () => {
  const ad = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';
  assert.equal(classifyRequest(ad, 'script', 'https://example.com/', { ...STANDARD, level: 'off' }).block, false);
  assert.equal(classifyRequest(ad, 'script', 'https://example.com/', { ...STANDARD, level: 'standard' }).block, true);
  assert.equal(classifyRequest(ad, 'script', 'https://example.com/', { ...STANDARD, level: 'strict' }).block, true);
});

test('ads can be allowed while trackers stay blocked, and vice versa', () => {
  const ad = 'https://securepubads.g.doubleclick.net/tag/js/gpt.js';
  // A tracker-only endpoint: the beacon path itself is not on the ad list, so
  // switching trackers off is the only thing that releases it.
  const trackerOnly = 'https://www.google-analytics.com/g/collect?v=2&tid=G-1';
  const analyticsScript = 'https://www.google-analytics.com/analytics.js';

  const adsOff = { ...STANDARD, blockAds: false };
  const trackersOff = { ...STANDARD, blockTrackers: false };

  assert.equal(classifyRequest(trackerOnly, 'xhr', 'https://shop.example/', trackersOff).block, false);
  assert.equal(classifyRequest(trackerOnly, 'xhr', 'https://shop.example/', STANDARD).block, true);
  assert.equal(classifyRequest(trackerOnly, 'xhr', 'https://shop.example/', adsOff).block, true, 'the tracker rule does not depend on the ad switch');

  assert.equal(classifyRequest(ad, 'script', 'https://shop.example/', adsOff).block, false);
  assert.equal(classifyRequest(ad, 'script', 'https://shop.example/', trackersOff).block, true);
  // analytics.js is named in both the ad patterns and the tracker host list,
  // so turning trackers off alone still leaves it blocked as an ad.
  assert.equal(classifyRequest(analyticsScript, 'script', 'https://shop.example/', trackersOff).block, true);
});

test('same-origin and main-frame requests are never blocked', () => {
  for (const url of ['https://example.com/ads/banner.js', 'https://example.com/track.gif']) {
    assert.equal(classifyRequest(url, 'script', 'https://example.com/', STANDARD).block, false, url);
  }
  assert.equal(classifyRequest('https://ads.doubleclick.net/x', 'mainFrame', '', STANDARD).block, false);
});

test('strict level cancels third-party scripts but leaves images alone', () => {
  const strict = { level: 'strict', blockAds: true, blockTrackers: true, blockScripts: true };
  const script = classifyRequest('https://cdn.example.org/widget.js', 'script', 'https://example.com/', strict);
  assert.equal(script.block, true);
  assert.equal(script.category, 'script');
  assert.equal(classifyRequest('https://cdn.example.org/photo.jpg', 'image', 'https://example.com/', strict).block, false);
  // With script blocking switched off, strict still only blocks known bad hosts.
  const lax = { ...strict, blockScripts: false };
  assert.equal(classifyRequest('https://cdn.example.org/widget.js', 'script', 'https://example.com/', lax).block, false);
});

test('fingerprinting endpoints are blocked before the ad lists are consulted', () => {
  const options = { level: 'standard', blockAds: false, blockTrackers: false, blockFingerprinting: true };
  const endpoint = 'https://cdn.example.org/fpjs/script.js';
  const decision = classifyRequest(endpoint, 'xhr', 'https://example.com/', options);
  assert.equal(decision.block, true, 'fingerprint blocking is independent of the ad/tracker switches');
  assert.equal(decision.category, 'fingerprint');
  assert.equal(classifyRequest(endpoint, 'xhr', 'https://example.com/', { ...options, blockFingerprinting: false }).block, false);
  // Fingerprint detection also survives with ads and trackers on.
  assert.equal(classifyRequest(endpoint, 'script', 'https://example.com/', STANDARD).category, 'fingerprint');
  assert.equal(classifyRequest('https://cdn.example.org/app.js', 'script', 'https://example.com/', STANDARD).block, false);
});

test('upgradeConnection rewrites plain HTTP but spares local hosts', () => {
  assert.equal(upgradeConnection('http://example.com/a?b=1'), 'https://example.com/a?b=1');
  for (const url of ['http://localhost:3000/x', 'http://127.0.0.1/x', 'http://nas.local/x', 'https://example.com/x', 'mla-media://movie/1', '']) {
    assert.equal(upgradeConnection(url), url, url);
  }
});

test('createShields counts per category, throttles callbacks, and resets', () => {
  const handlers = [];
  const sessions = [1, 2].map(() => ({
    webRequest: { onBeforeRequest: (_filter, handler) => { handlers.push(handler); } }
  }));
  const shields = createShields(sessions, () => STANDARD, null);
  // One registration per session, and re-attaching the same session is a no-op.
  assert.equal(handlers.length, 2);
  shields.attach(sessions[0]);
  assert.equal(handlers.length, 2);

  const notifications = [];
  const counting = createShields({ webRequest: { onBeforeRequest: (_f, h) => handlers.push(h) } }, () => STANDARD, counts => notifications.push(counts.total));
  const respond = url => new Promise(resolve => {
    handlers.at(-1)({ url, resourceType: 'script', referrer: 'https://example.com/' }, () => resolve());
  });
  return (async () => {
    for (let index = 0; index < 4; index += 1) await respond('https://www.google-analytics.com/collect');
    await respond('https://securepubads.g.doubleclick.net/tag/js/gpt.js');
    assert.deepEqual(counting.counts(), { ad: 1, tracker: 4, fingerprint: 0, script: 0, total: 5 });
    // Notified on the first block and then every fifth.
    assert.deepEqual(notifications, [1, 5]);
    counting.reset();
    assert.equal(counting.counts().total, 0);
    shields.dispose();
    counting.dispose();
  })();
});

test('tracker list is a subset of nothing and stays well-formed', () => {
  assert.ok(TRACKER_HOST_FRAGMENTS.length >= 20);
  assert.equal(new Set(TRACKER_HOST_FRAGMENTS).size, TRACKER_HOST_FRAGMENTS.length);
  for (const fragment of TRACKER_HOST_FRAGMENTS) {
    assert.ok(fragment.length >= 4, `fragment too short: ${fragment}`);
    assert.equal(fragment, fragment.toLowerCase());
  }
  // A tracker fragment that also appears in the ad list must still classify
  // as a tracker, which the ordering of classifyRequest guarantees.
  const shared = TRACKER_HOST_FRAGMENTS.find(fragment => BLOCK_HOST_FRAGMENTS.includes(fragment));
  if (shared) {
    const decision = classifyRequest(`https://${shared}.example.net/x`, 'script', 'https://example.com/', STANDARD);
    assert.equal(decision.category, 'tracker');
  }
});

test('the three-argument helper keeps its old behaviour', () => {
  assert.equal(shouldBlock('https://ads.reddit.com/pixel', 'image', 'https://example.com/'), true);
  assert.equal(shouldBlock('https://example.com/app.js', 'script', 'https://example.com/'), false);
});
