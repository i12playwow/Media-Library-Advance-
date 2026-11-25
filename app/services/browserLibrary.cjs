'use strict';
// Browsing history and bookmark stores for the in-app browser.
//
// Both live in one JSON file so a single atomic write keeps them consistent.
// History is capped (newest first) and de-duplicated per URL; visiting the
// same page again bumps it to the top and increments the visit count, which
// is what the history panel sorts on.

const fs = require('node:fs');
const path = require('node:path');

const HISTORY_LIMIT = 2000;
const BOOKMARK_LIMIT = 500;

function keyFor(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return null;
  }
}

function safeText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeHistory(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const url = keyFor(safeText(entry.url, 8192));
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      title: safeText(entry.title, 300) || url,
      visitedAt: safeText(entry.visitedAt, 40) || new Date(0).toISOString(),
      visits: Math.max(1, Math.min(100000, Math.round(Number(entry.visits) || 1)))
    });
    if (out.length >= HISTORY_LIMIT) break;
  }
  return out;
}

function normalizeBookmarks(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const url = keyFor(safeText(entry.url, 8192));
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      title: safeText(entry.title, 300) || url,
      addedAt: safeText(entry.addedAt, 40) || new Date().toISOString()
    });
    if (out.length >= BOOKMARK_LIMIT) break;
  }
  return out;
}

function createBrowserLibrary({ app, fsImpl = fs } = {}) {
  const file = path.join(app.getPath('userData'), 'browser-data.json');
  let cache = null;

  function read() {
    if (cache) return cache;
    try {
      const parsed = JSON.parse(fsImpl.readFileSync(file, 'utf8'));
      cache = { history: normalizeHistory(parsed.history), bookmarks: normalizeBookmarks(parsed.bookmarks) };
    } catch {
      cache = { history: [], bookmarks: [] };
    }
    return cache;
  }

  function write(next) {
    cache = { history: normalizeHistory(next.history), bookmarks: normalizeBookmarks(next.bookmarks) };
    try {
      fsImpl.mkdirSync(path.dirname(file), { recursive: true });
      fsImpl.writeFileSync(file, JSON.stringify(cache), 'utf8');
    } catch {
      // Keep the in-memory value when the profile is read-only.
    }
    return cache;
  }

  return {
    history: () => read().history,
    bookmarks: () => read().bookmarks,

    recordVisit(url, title) {
      const key = keyFor(safeText(url, 8192));
      if (!key || !/^https?:/i.test(key)) return read().history;
      const current = read();
      const rest = current.history.filter(entry => entry.url !== key);
      const previous = current.history.find(entry => entry.url === key);
      const next = [{
        url: key,
        title: safeText(title, 300) || previous?.title || key,
        visitedAt: new Date().toISOString(),
        visits: (previous?.visits ?? 0) + 1
      }, ...rest].slice(0, HISTORY_LIMIT);
      return write({ ...current, history: next }).history;
    },

    removeHistory(url) {
      const current = read();
      return write({ ...current, history: current.history.filter(entry => entry.url !== url) }).history;
    },

    clearHistory() {
      const current = read();
      return write({ ...current, history: [] }).history;
    },

    addBookmark(url, title) {
      const key = keyFor(safeText(url, 8192));
      if (!key || !/^https?:/i.test(key)) return read().bookmarks;
      const current = read();
      if (current.bookmarks.some(entry => entry.url === key)) return current.bookmarks;
      const next = [{ url: key, title: safeText(title, 300) || key, addedAt: new Date().toISOString() }, ...current.bookmarks]
        .slice(0, BOOKMARK_LIMIT);
      return write({ ...current, bookmarks: next }).bookmarks;
    },

    removeBookmark(url) {
      const current = read();
      return write({ ...current, bookmarks: current.bookmarks.filter(entry => entry.url !== url) }).bookmarks;
    },

    isBookmarked(url) {
      const key = keyFor(safeText(url, 8192));
      return Boolean(key && read().bookmarks.some(entry => entry.url === key));
    },

    /** Wipes history and bookmarks — used by "clear browsing data". */
    clearAll() {
      return write({ history: [], bookmarks: [] });
    }
  };
}

module.exports = { createBrowserLibrary, normalizeHistory, normalizeBookmarks, HISTORY_LIMIT, BOOKMARK_LIMIT };
