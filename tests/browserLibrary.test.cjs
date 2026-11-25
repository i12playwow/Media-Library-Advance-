'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const {
  createBrowserLibrary, normalizeHistory, normalizeBookmarks, HISTORY_LIMIT, BOOKMARK_LIMIT
} = require('../app/services/browserLibrary.cjs');

function scratchApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mla-browser-lib-'));
  return { dir, app: { getPath: () => dir } };
}

test('recordVisit adds, de-duplicates and bumps to the top', () => {
  const { dir, app } = scratchApp();
  try {
    const library = createBrowserLibrary({ app });
    library.recordVisit('https://a.example/one', 'One');
    library.recordVisit('https://b.example/two', 'Two');
    assert.deepEqual(library.history().map(entry => entry.title), ['Two', 'One']);

    // Revisiting bumps to the top and counts the visit.
    library.recordVisit('https://a.example/one', 'One again');
    const history = library.history();
    assert.equal(history.length, 2);
    assert.equal(history[0].url, 'https://a.example/one');
    assert.equal(history[0].title, 'One again');
    assert.equal(history[0].visits, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the URL hash is ignored so anchors do not stack up', () => {
  const { dir, app } = scratchApp();
  try {
    const library = createBrowserLibrary({ app });
    library.recordVisit('https://a.example/page#top', 'Page');
    library.recordVisit('https://a.example/page#comments', 'Page');
    assert.equal(library.history().length, 1);
    assert.equal(library.history()[0].visits, 2);
    assert.equal(library.isBookmarked('https://a.example/page#anything'), false);
    library.addBookmark('https://a.example/page#top', 'Page');
    assert.equal(library.isBookmarked('https://a.example/page#comments'), true);
    assert.equal(library.bookmarks().length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('non-http URLs and junk are never recorded', () => {
  const { dir, app } = scratchApp();
  try {
    const library = createBrowserLibrary({ app });
    for (const url of ['', 'about:blank', 'mla-media://movie/1', 'data:text/html,x', 'not a url', null, undefined]) {
      library.recordVisit(url, 'nope');
      library.addBookmark(url, 'nope');
    }
    assert.equal(library.history().length, 0);
    assert.equal(library.bookmarks().length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('history is capped and de-duplicated when read', () => {
  const overflow = Array.from({ length: HISTORY_LIMIT + 25 }, (_, index) => ({
    url: `https://example.com/${index}`, title: `Page ${index}`, visits: 1
  }));
  // A duplicate URL later in the list must not appear twice.
  overflow.push({ url: 'https://example.com/0', title: 'Again', visits: 3 });
  const history = normalizeHistory(overflow);
  assert.equal(history.length, HISTORY_LIMIT);
  assert.equal(new Set(history.map(entry => entry.url)).size, HISTORY_LIMIT);
  assert.equal(history[0].url, 'https://example.com/0', 'later duplicate is collapsed onto the first slot');
});

test('bookmarks are capped and survive a restart', () => {
  const { dir, app } = scratchApp();
  try {
    const library = createBrowserLibrary({ app });
    for (let index = 0; index < BOOKMARK_LIMIT + 10; index += 1) {
      library.addBookmark(`https://example.com/${index}`, `Site ${index}`);
    }
    assert.equal(library.bookmarks().length, BOOKMARK_LIMIT);

    const reopened = createBrowserLibrary({ app });
    assert.equal(reopened.bookmarks().length, BOOKMARK_LIMIT);
    assert.equal(reopened.bookmarks()[0].url, `https://example.com/${BOOKMARK_LIMIT + 9}`, 'newest first');

    reopened.removeBookmark(reopened.bookmarks()[0].url);
    assert.equal(reopened.bookmarks().length, BOOKMARK_LIMIT - 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('clearAll wipes history and bookmarks together', () => {
  const { dir, app } = scratchApp();
  try {
    const library = createBrowserLibrary({ app });
    library.recordVisit('https://a.example/', 'A');
    library.addBookmark('https://a.example/', 'A');
    library.clearAll();
    assert.equal(library.history().length, 0);
    assert.equal(library.bookmarks().length, 0);
    const reopened = createBrowserLibrary({ app });
    assert.equal(reopened.history().length, 0);
    assert.equal(reopened.bookmarks().length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('normalizeHistory tolerates malformed entries', () => {
  const history = normalizeHistory([null, 5, 'x', { url: 'https://ok.example/' }, { url: 'https://ok.example/', visits: 'many' }]);
  assert.equal(history.length, 1);
  assert.equal(history[0].title, 'https://ok.example/', 'title falls back to the URL');
  assert.equal(history[0].visits, 1, 'a junk visit count falls back to 1');
  assert.deepEqual(normalizeHistory('nope'), []);
  assert.deepEqual(normalizeBookmarks({}), []);
});
