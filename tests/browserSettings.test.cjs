'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { createBrowserSettings, normalizeSettings, clampZoom, DEFAULT_SETTINGS, SHIELD_LEVELS, SEARCH_ENGINES } = require('../app/services/browserSettings.cjs');

function scratchApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mla-browser-settings-'));
  return { dir, app: { getPath: () => dir } };
}

test('defaults are complete and valid', () => {
  assert.ok(SHIELD_LEVELS.includes(DEFAULT_SETTINGS.shieldLevel));
  assert.ok(SEARCH_ENGINES.includes(DEFAULT_SETTINGS.searchEngine));
  assert.equal(DEFAULT_SETTINGS.blockScripts, false, 'script blocking must stay opt-in');
  assert.equal(DEFAULT_SETTINGS.upgradeToHttps, true);
  assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
});

test('clampZoom keeps the range at 25–500 and falls back on junk', () => {
  assert.equal(clampZoom(10), 25);
  assert.equal(clampZoom(900), 500);
  assert.equal(clampZoom('125'), 125);
  assert.equal(clampZoom(124.6), 125);
  assert.equal(clampZoom('wide'), DEFAULT_SETTINGS.defaultZoom);
  assert.equal(clampZoom(undefined), DEFAULT_SETTINGS.defaultZoom);
});

test('normalizeSettings rejects wrong types and unknown values', () => {
  const result = normalizeSettings({
    shieldLevel: 'aggressive', searchEngine: 'altavista',
    blockAds: 'yes', clearOnExit: true, defaultZoom: 1000
  });
  assert.equal(result.shieldLevel, DEFAULT_SETTINGS.shieldLevel);
  assert.equal(result.searchEngine, DEFAULT_SETTINGS.searchEngine);
  assert.equal(result.blockAds, DEFAULT_SETTINGS.blockAds);
  assert.equal(result.clearOnExit, true);
  assert.equal(result.defaultZoom, 500);
});

test('site overrides are keyed by lowercased host and cleaned', () => {
  const result = normalizeSettings({
    siteSettings: {
      'Example.COM': { shieldLevel: 'strict', blockScripts: true, zoom: 140 },
      'junk.example': { shieldLevel: 'nope', zoom: 5000 },
      'empty.example': {},
      '': { zoom: 110 }
    }
  });
  assert.deepEqual(result.siteSettings['example.com'], { shieldLevel: 'strict', blockScripts: true, zoom: 140 });
  assert.deepEqual(result.siteSettings['junk.example'], { zoom: 500 }, 'invalid level dropped, zoom clamped');
  assert.equal(result.siteSettings['empty.example'], undefined, 'empty override is dropped');
  assert.equal(result.siteSettings[''], undefined, 'blank host is dropped');
});

test('settings persist across instances and survive a corrupt file', () => {
  const { dir, app } = scratchApp();
  try {
    const first = createBrowserSettings({ app });
    first.set('shieldLevel', 'strict');
    first.set('defaultZoom', 130);
    first.setSite('News.Example', { zoom: 90 });

    const second = createBrowserSettings({ app });
    assert.equal(second.get().shieldLevel, 'strict');
    assert.equal(second.get().defaultZoom, 130);
    assert.deepEqual(second.get().siteSettings['news.example'], { zoom: 90 });

    // Removing an override works (setSite with null).
    second.setSite('news.example', null);
    assert.equal(second.get().siteSettings['news.example'], undefined);

    fs.writeFileSync(path.join(dir, 'browser-settings.json'), '{ not json', 'utf8');
    const third = createBrowserSettings({ app });
    assert.deepEqual(third.get(), DEFAULT_SETTINGS, 'a corrupt file falls back to defaults');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('update merges patches without dropping untouched keys', () => {
  const { dir, app } = scratchApp();
  try {
    const settings = createBrowserSettings({ app });
    settings.update({ clearOnExit: true, sendDoNotTrack: false });
    settings.update({ searchEngine: 'duckduckgo' });
    const prefs = settings.get();
    assert.equal(prefs.clearOnExit, true);
    assert.equal(prefs.sendDoNotTrack, false);
    assert.equal(prefs.searchEngine, 'duckduckgo');
    assert.equal(prefs.blockAds, true);
    // Junk patches are ignored rather than thrown.
    settings.update(null);
    settings.update('nope');
    assert.equal(settings.get().clearOnExit, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
