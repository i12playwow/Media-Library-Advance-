'use strict';
// Persisted preferences for the in-app browser. These mirror the Brave-style
// controls an operator expects (shields, history, bookmarks, zoom, per-site
// permissions, clear-on-exit) without any wallet/VPN surface: every option
// here is one the Electron session can actually honour.
//
// The store is a plain JSON file in userData so it survives upgrades, and
// every read is defensive: a hand-edited or truncated file falls back to the
// defaults instead of breaking the browser.

const fs = require('node:fs');
const path = require('node:path');

const SHIELD_LEVELS = ['strict', 'standard', 'off'];
const SEARCH_ENGINES = ['brave', 'google', 'bing', 'duckduckgo', 'startpage'];

const DEFAULT_SETTINGS = {
  // ── Shields ──────────────────────────────────────────────────────────────
  // Levels map to Brave's three modes: strict blocks aggressively, standard
  // is the everyday default, off disables the filter list for everything.
  shieldLevel: 'standard',
  blockAds: true,
  blockTrackers: true,
  // Script blocking is opt-in and per-site: turning it on globally breaks
  // most sites, which is exactly the trap Brave's strict mode falls into.
  blockScripts: false,
  blockFingerprinting: true,
  upgradeToHttps: true,
  // ── Privacy ──────────────────────────────────────────────────────────────
  blockThirdPartyCookies: true,
  privateWindow: false,
  // Clears cookies/cache/history on quit.
  clearOnExit: false,
  // Do Not Track header.
  sendDoNotTrack: true,
  // ── Browsing ─────────────────────────────────────────────────────────────
  searchEngine: 'brave',
  // Percent, matching Brave's 25–500 % range.
  defaultZoom: 100,
  restoreTabsOnStartup: true,
  openDownloadsInPanel: true,
  // ── Per-site overrides ───────────────────────────────────────────────────
  // { "example.com": { shieldLevel?: level, blockScripts?: bool, zoom?: number } }
  siteSettings: {}
};

const MAX_SITE_ENTRIES = 500;

function clampZoom(value) {
  const zoom = Math.round(Number(value));
  if (!Number.isFinite(zoom)) return DEFAULT_SETTINGS.defaultZoom;
  return Math.min(500, Math.max(25, zoom));
}

function normalizeSiteSettings(raw) {
  const result = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return result;
  for (const [host, entry] of Object.entries(raw)) {
    const key = String(host).trim().toLowerCase();
    if (!key || key.length > 253 || !entry || typeof entry !== 'object') continue;
    const cleaned = {};
    if (SHIELD_LEVELS.includes(entry.shieldLevel)) cleaned.shieldLevel = entry.shieldLevel;
    if (typeof entry.blockScripts === 'boolean') cleaned.blockScripts = entry.blockScripts;
    if (entry.zoom !== undefined) cleaned.zoom = clampZoom(entry.zoom);
    if (Object.keys(cleaned).length) result[key] = cleaned;
    if (Object.keys(result).length >= MAX_SITE_ENTRIES) break;
  }
  return result;
}

/** Coerces any payload into a complete, valid settings object. */
function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const result = { ...DEFAULT_SETTINGS, siteSettings: normalizeSiteSettings(source.siteSettings) };
  for (const key of ['blockAds', 'blockTrackers', 'blockScripts', 'blockFingerprinting', 'upgradeToHttps',
    'blockThirdPartyCookies', 'privateWindow', 'clearOnExit', 'sendDoNotTrack', 'restoreTabsOnStartup', 'openDownloadsInPanel']) {
    if (typeof source[key] === 'boolean') result[key] = source[key];
  }
  if (SHIELD_LEVELS.includes(source.shieldLevel)) result.shieldLevel = source.shieldLevel;
  if (SEARCH_ENGINES.includes(source.searchEngine)) result.searchEngine = source.searchEngine;
  if (source.defaultZoom !== undefined) result.defaultZoom = clampZoom(source.defaultZoom);
  return result;
}

function createBrowserSettings({ app, fsImpl = fs } = {}) {
  const file = path.join(app.getPath('userData'), 'browser-settings.json');
  let cache = null;

  function read() {
    if (cache) return cache;
    try {
      cache = normalizeSettings(JSON.parse(fsImpl.readFileSync(file, 'utf8')));
    } catch {
      // Missing on first run, or corrupt: start from the shipped defaults.
      cache = normalizeSettings({});
    }
    return cache;
  }

  function write(next) {
    cache = normalizeSettings(next);
    try {
      fsImpl.mkdirSync(path.dirname(file), { recursive: true });
      fsImpl.writeFileSync(file, JSON.stringify(cache, null, 2), 'utf8');
    } catch {
      // A read-only profile must not take the browser down; the in-memory
      // value still applies for this session.
    }
    return cache;
  }

  return {
    get: () => read(),
    update: patch => write({ ...read(), ...(patch && typeof patch === 'object' ? patch : {}) }),
    /** Applies a known set of keys, ignoring anything unrecognised. */
    set: (key, value) => write({ ...read(), [key]: value }),
    setSite: (host, entry) => {
      const key = String(host || '').trim().toLowerCase();
      const current = read();
      if (!key) return current;
      const sites = { ...current.siteSettings };
      if (!entry || Object.keys(entry).length === 0) delete sites[key];
      else sites[key] = entry;
      return write({ ...current, siteSettings: sites });
    },
    clearSites: () => write({ ...read(), siteSettings: {} }),
    file
  };
}

module.exports = {
  createBrowserSettings,
  normalizeSettings,
  clampZoom,
  DEFAULT_SETTINGS,
  SHIELD_LEVELS,
  SEARCH_ENGINES
};
