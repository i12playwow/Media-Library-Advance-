'use strict';
const path = require('node:path');
const { createDownloadQueue } = require('./browserDownloads.cjs');
const { createShields, upgradeConnection } = require('./adBlocker.cjs');
const { createBrowserSettings } = require('./browserSettings.cjs');
const { createBrowserLibrary } = require('./browserLibrary.cjs');

const TOOLBAR_HEIGHT = 70;
const TABBAR_HEIGHT = 34;
const CONTENT_TOP = TOOLBAR_HEIGHT + TABBAR_HEIGHT;
const MAX_TABS = 12;

const SEARCH_URLS = {
  brave: 'https://search.brave.com/search?q=',
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  startpage: 'https://www.startpage.com/sp/search?query='
};

// Chrome UA with the Electron/brave tokens stripped: sites that sniff for
// Chromium serve their normal layout instead of a "browser not supported"
// page, and the app's own branding never leaks into requests.
function browserUserAgent(app) {
  const chrome = (process.versions.chrome || '120.0.0.0').replace(/\.0\.0\.0$/, '');
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}

function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

/** A toolbar entry with no dot and no scheme is a search, not an address. */
function looksLikeSearch(value) {
  const address = value.trim();
  if (!address) return false;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(address)) return false;
  const bare = address.split(/[/?#]/)[0];
  if (bare === 'localhost') return false;
  if (/^[\d.]+(?::\d+)?$/.test(bare)) return false;
  return !bare.includes('.');
}

function mediaCollector() {
  // Runs in the page's isolated world: collects playable video/audio
  // sources (src + blob-relative network sources we can re-request).
  const results = new Map();
  const limit = (url) => {
    if (results.size >= 50) return true;
    let parsed;
    try { parsed = new URL(url); } catch { return true; }
    if (!['http:', 'https:', 'blob:'].includes(parsed.protocol)) return true;
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (parsed.username || parsed.password) return true;
      if (parsed.href.length > 8192) return true;
    }
    parsed.hash = '';
    const key = parsed.href;
    if (!results.has(key)) results.set(key, key);
    return false;
  };
  for (const video of document.querySelectorAll('video')) {
    if (video.src) limit(video.src);
    for (const source of video.querySelectorAll('source')) if (source.src) limit(source.src);
  }
  for (const audio of document.querySelectorAll('audio')) if (audio.src) limit(audio.src);
  for (const source of document.querySelectorAll('source')) if (source.src) limit(source.src);
  return [...results.values()];
}

function videoLinks() {
  const matches = new Map();
  const file = /\.(?:mp4|mkv|webm|mov|avi|m4v)(?:\?|$)/i;
  for (const link of document.querySelectorAll('a[href]')) {
    if (matches.size >= 50) break;
    let url;
    try { url = new URL(link.href); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
    const label = (link.textContent || link.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (!file.test(url.pathname) && !/^download video/i.test(label)) continue;
    url.hash = '';
    if (url.href.length > 8192 || matches.has(url.href)) continue;
    matches.set(url.href, { url: url.href, label: (label || url.pathname).slice(0, 160) });
  }
  return [...matches.values()];
}

function pageDownloadLinks() {
  const matches = new Map();
  const file = /\.(?:mp4|mkv|webm|mov|avi|m4v|wmv|mpeg|mpg|mp3|flac|wav|m4a|ogg|srt|vtt|ass|ssa|zip|rar|7z|gz|pdf|epub|jpg|jpeg|png|webp|gif|iso)$/i;
  for (const link of document.querySelectorAll('a[href]')) {
    if (matches.size >= 100) break;
    let url;
    try { url = new URL(link.href); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;
    const label = (link.textContent || link.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
    if (!link.hasAttribute('download') && !file.test(url.pathname) && !/^download\b/i.test(label)) continue;
    url.hash = '';
    if (url.href.length > 8192 || matches.has(url.href)) continue;
    matches.set(url.href, { url: url.href, label: (label || link.getAttribute('download') || url.pathname).slice(0, 160) });
  }
  return [...matches.values()];
}

// Reader mode: keeps the article body and drops the furniture around it, then
// re-renders it as plain prose in a neutral style. Returns null when the page
// has no identifiable article, so the toolbar can say so instead of blanking.
function readerExtract() {
  const candidateSelectors = [
    'article', '[role="article"]', '.article-body', '.article__body', '.post-content',
    '.entry-content', '.content-article', '#article-body', 'main article', 'main'
  ];
  let best = null;
  let bestScore = 0;
  for (const selector of candidateSelectors) {
    for (const node of document.querySelectorAll(selector)) {
      const text = (node.innerText || '').trim();
      const score = text.length + node.querySelectorAll('p').length * 120;
      if (score > bestScore && text.length > 400) { best = node; bestScore = score; }
    }
  }
  if (!best) return null;
  const title = (document.querySelector('h1')?.innerText || document.title || '').trim();
  const paragraphs = [...best.querySelectorAll('p, h2, h3, li, blockquote')]
    .map(node => ({ tag: node.tagName.toLowerCase(), text: (node.innerText || '').trim() }))
    .filter(entry => entry.text.length > 20)
    .slice(0, 400);
  if (!paragraphs.length) return null;
  return { title, url: location.href, paragraphs };
}

function webUrl(value) {
  if (typeof value !== 'string' || value.length > 8192) return null;
  const address = value.trim();
  if (!address || /\s/.test(address)) return null;
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(address) && !/^[^/:]+:\d+(?:[/?#]|$)/.test(address);
  try {
    const url = new URL(hasScheme ? address : `https://${address}`);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function createInAppBrowser({ app, BrowserWindow, WebContentsView, ipcMain, session, shell }) {
  let browser;
  let tabs = [];
  let activeId = 0;
  let nextTabId = 1;
  let address = '';
  let notice = '';
  let downloads;
  let showingDownloads = false;
  let choosingFolder = false;
  let shields;
  let settings;
  let library;
  let activeView;
  let panel = null;
  let findQuery = '';
  let findResult = null;
  let readerOpen = false;

  function activeTab() { return tabs.find(tab => tab.id === activeId) ?? null; }

  function settingsFor(origin) {
    const current = settings.get();
    const host = hostOf(origin);
    const site = host ? current.siteSettings[host] : undefined;
    const level = site?.shieldLevel ?? current.shieldLevel;
    return {
      level,
      blockAds: level === 'off' ? false : current.blockAds,
      blockTrackers: level === 'off' ? false : current.blockTrackers,
      // Level gates script blocking: strict forces it on for third-party
      // scripts, standard only honours an explicit per-site opt-in.
      blockScripts: site?.blockScripts ?? (level === 'strict' ? true : current.blockScripts),
      blockFingerprinting: level === 'off' ? false : current.blockFingerprinting
    };
  }

  function zoomFor(origin) {
    const host = hostOf(origin);
    return settings.get().siteSettings[host]?.zoom ?? settings.get().defaultZoom;
  }

  function showDownloads(show) {
    showingDownloads = show;
    if (show) closePanel();
    const current = activeTab();
    if (current?.view) current.view.setVisible(!show && Boolean(current.page.getURL()) && !notice);
    publish();
  }

  function closePanel() {
    if (!panel) return;
    panel.hidden = false;
    panel = null;
    const current = activeTab();
    if (current?.view) current.view.setVisible(Boolean(current.page.getURL()) && !notice && !showingDownloads);
  }

  function publish() {
    if (!browser || browser.isDestroyed()) return;
    const current = activeTab();
    const page = current?.page;
    const currentUrl = page?.getURL?.() ?? address;
    const host = hostOf(currentUrl);
    const counts = shields?.counts() ?? { ad: 0, tracker: 0, fingerprint: 0, script: 0, total: 0 };
    const prefs = settings.get();
    const site = host ? prefs.siteSettings[host] : undefined;
    browser.webContents.send('browser:state', {
      address,
      notice,
      loading: page ? page.isLoadingMainFrame() : false,
      back: page ? page.navigationHistory.canGoBack() : false,
      forward: page ? page.navigationHistory.canGoForward() : false,
      showingDownloads,
      downloads: downloads.state(),
      // Shields
      adBlockCount: counts.total,
      shieldCounts: counts,
      shieldLevel: site?.shieldLevel ?? prefs.shieldLevel,
      shieldsEnabled: (site?.shieldLevel ?? prefs.shieldLevel) !== 'off',
      siteHost: host,
      siteHasOverride: Boolean(site),
      zoom: zoomFor(currentUrl),
      canGoHome: true,
      bookmarked: library.isBookmarked(currentUrl),
      findActive: Boolean(findQuery),
      findQuery,
      findResult,
      readerOpen,
      tabs: tabs.map(tab => {
        const tabHost = hostOf(tab.address);
        return {
          id: tab.id,
          title: tab.title || tab.address || 'New tab',
          address: tab.address,
          host: tabHost,
          loading: tab.page.isLoadingMainFrame(),
          active: tab.id === activeId,
          canClose: tabs.length > 1,
          muted: tab.page.isAudioMuted?.() ?? false
        };
      })
    });
  }

  function applyZoom(tab) {
    if (!tab?.page || tab.page.isDestroyed()) return;
    const factor = zoomFor(tab.address) / 100;
    try { tab.page.setZoomFactor(Math.min(5, Math.max(0.25, factor))); } catch { /* page closing */ }
  }

  function bindPageEvents(tab) {
    const { page, view } = tab;
    const navigated = (_event, url) => {
      if (!/^https?:\/\//i.test(url)) return;
      tab.address = url;
      tab.title = page.getTitle?.() || tab.title;
      if (tab.id === activeId) { address = url; notice = ''; }
      view.setVisible(tab.id === activeId && !showingDownloads);
      applyZoom(tab);
      if (tab.id === activeId) {
        // Private tabs never enter history — that is the whole point of them.
        if (!tab.private) library.recordVisit(url, tab.title);
        publish();
      }
    };
    page.on('did-navigate', navigated);
    page.on('did-navigate-in-page', (event, url, isMainFrame) => { if (isMainFrame) navigated(event, url); });
    page.on('page-title-updated', (_event, title) => {
      tab.title = title;
      if (tab.id === activeId) {
        // Re-record so the history entry picks up the real <title> instead of
        // the hostname it had at navigation time.
        if (!tab.private) library.recordVisit(tab.address, title);
        publish();
      }
    });
    page.on('did-start-loading', () => { if (tab.id === activeId) publish(); });
    page.on('did-stop-loading', () => { if (tab.id === activeId) publish(); });
    page.on('did-fail-load', (_event, code, _description, failedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      tab.address = failedUrl;
      if (tab.id === activeId) {
        address = failedUrl;
        notice = 'This page could not be loaded. Check the address or try again.';
        view.setVisible(false);
      }
      publish();
    });
    page.on('render-process-gone', () => {
      if (tab.id === activeId) {
        notice = 'The page stopped responding. Reload to try again.';
        view.setVisible(false);
      }
      publish();
    });
    page.on('found-in-page', (_event, result) => {
      if (tab.id !== activeId) return;
      findResult = {
        matches: result.matches ?? 0,
        activeMatch: result.activeMatchOrdinal ?? 0,
        final: Boolean(result.finalUpdate)
      };
      publish();
    });
  }

  function createTab(url, options = {}) {
    const browserSession = options.session ?? session.fromPartition('persist:mla-web-browser');
    const view = new WebContentsView({ webPreferences: {
      sandbox: true, nodeIntegration: false, contextIsolation: true, session: browserSession
    } });
    const tab = {
      id: nextTabId++,
      view,
      page: view.webContents,
      address: url ?? '',
      title: url ? new URL(url).hostname : 'New tab',
      private: Boolean(options.private)
    };
    try { view.webContents.setUserAgent(browserUserAgent(app)); } catch { /* older Electron */ }
    // A private tab uses its own partition, so the shared session's shields and
    // privacy headers do not reach it. Attach both freshly; createShields
    // de-duplicates and applyPrivacyHeaders is registered once per partition.
    if (options.session) {
      applyPrivacyHeaders(browserSession);
      shields?.attach(browserSession);
    }
    tabs.push(tab);
    browser.contentView.addChildView(view);
    const resize = () => {
      const [width, height] = browser.getContentSize();
      view.setBounds({ x: 0, y: CONTENT_TOP, width, height: Math.max(0, height - CONTENT_TOP) });
    };
    resize();
    // A freshly created tab has no resize listener yet, and removeListener
    // throws on undefined — only remove one we actually installed.
    if (tab.resize) browser.removeListener('resize', tab.resize);
    browser.on('resize', resize);
    tab.resize = resize;
    bindPageEvents(tab);
    if (url) void tab.page.loadURL(settings.get().upgradeToHttps ? upgradeConnection(url) : url).catch(() => {});
    else view.setVisible(false);
    activateTab(tab.id);
    return tab;
  }

  function activateTab(id) {
    const target = tabs.find(tab => tab.id === id);
    if (!target) return;
    activeId = id;
    address = target.address;
    notice = '';
    findResult = null;
    findQuery = '';
    readerOpen = false;
    for (const tab of tabs) tab.view.setVisible(tab.id === id && !showingDownloads && Boolean(target.address));
    activeView = target.view;
    target.page.focus();
    applyZoom(target);
    publish();
  }

  function closeTab(id) {
    const index = tabs.findIndex(tab => tab.id === id);
    if (index === -1 || tabs.length <= 1) return;
    const [tab] = tabs.splice(index, 1);
    browser.contentView.removeChildView(tab.view);
    browser.removeListener('resize', tab.resize);
    if (!tab.page.isDestroyed()) tab.page.close();
    if (activeId === id) {
      const next = tabs[Math.max(0, index - 1)] ?? tabs[0];
      activateTab(next.id);
    } else publish();
  }

  function navigate(url, tab = activeTab()) {
    if (!tab) return;
    // The HTTPS upgrade is a preference, not a law: a site an operator
    // deliberately opened over plain HTTP keeps working when it is switched off.
    const target = settings.get().upgradeToHttps ? upgradeConnection(url) : url;
    tab.address = target;
    address = target;
    notice = '';
    readerOpen = false;
    showDownloads(false);
    tab.view.setVisible(true);
    applyZoom(tab);
    void tab.page.loadURL(target).catch(() => {}); // did-fail-load publishes navigation errors.
  }

  function navigateInput(value, tab = activeTab()) {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) return;
    if (looksLikeSearch(text)) {
      const engine = settings.get().searchEngine;
      const base = SEARCH_URLS[engine] ?? SEARCH_URLS.brave;
      return navigate(`${base}${encodeURIComponent(text)}`);
    }
    const url = webUrl(text);
    if (!url) {
      notice = 'Enter a valid HTTP or HTTPS website address.';
      publish();
      return;
    }
    return navigate(url, tab);
  }

  function homeAddress() {
    const engine = settings.get().searchEngine;
    return {
      brave: 'https://search.brave.com/',
      google: 'https://www.google.com/',
      bing: 'https://www.bing.com/',
      duckduckgo: 'https://duckduckgo.com/',
      startpage: 'https://www.startpage.com/'
    }[engine] ?? 'https://search.brave.com/';
  }

  // Registered exactly once: the callback reads the live preferences, so a
  // later settings change applies to the very next request without the
  // handler having to be re-installed (onBeforeSendHeaders only fires once
  // registered, so re-registering is both pointless and racy).
  function applyPrivacyHeaders(browserSession) {
    try {
      browserSession.webRequest.onBeforeSendHeaders({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
        const prefs = settings.get();
        const headers = details.requestHeaders;
        if (prefs.sendDoNotTrack) headers.DNT = '1';
        if (prefs.blockThirdPartyCookies) headers['Sec-GPC'] = '1';
        callback({ requestHeaders: headers });
      });
    } catch { /* session torn down */ }
  }

  async function clearBrowsingData() {
    const browserSession = session.fromPartition('persist:mla-web-browser');
    await browserSession.clearStorageData({}).catch(() => {});
    await browserSession.clearCache().catch(() => {});
    library.clearAll();
    publish();
    return true;
  }

  function applyShields() {
    const browserSession = session.fromPartition('persist:mla-web-browser');
    shields = createShields(
      browserSession,
      origin => settingsFor(origin),
      () => publish()
    );
  }

  /** Applies a shield/privacy change to every live tab immediately. */
  function refreshSecurity() {
    for (const tab of tabs) {
      if (!tab.page.isDestroyed()) applyZoom(tab);
    }
    publish();
  }

  function setShieldLevel(level) {
    const host = hostOf(activeTab()?.address ?? '');
    if (host) {
      const current = settings.get().siteSettings[host] ?? {};
      settings.setSite(host, { ...current, shieldLevel: level });
    } else {
      settings.set('shieldLevel', level);
    }
    refreshSecurity();
    // Reload so the new level applies to the current document.
    const page = activeTab()?.page;
    if (page && !page.isDestroyed() && page.getURL()) page.reload();
  }

  function clearSiteOverride() {
    const host = hostOf(activeTab()?.address ?? '');
    if (host) settings.setSite(host, null);
    refreshSecurity();
  }

  function setZoom(percent) {
    const host = hostOf(activeTab()?.address ?? '');
    if (host) {
      const current = settings.get().siteSettings[host] ?? {};
      settings.setSite(host, { ...current, zoom: percent });
    } else settings.set('defaultZoom', percent);
    applyZoom(activeTab());
    publish();
  }

  function findInPage(text, options = {}) {
    const page = activeTab()?.page;
    if (!page || page.isDestroyed()) return;
    findQuery = typeof text === 'string' ? text.slice(0, 200) : '';
    if (!findQuery) {
      page.stopFindInPage('clearSelection');
      findResult = null;
      publish();
      return;
    }
    page.findInPage(findQuery, {
      forward: options.backward !== true,
      findNext: Boolean(options.findNext)
    });
    publish();
  }

  async function toggleReader() {
    const page = activeTab()?.page;
    if (!page || page.isDestroyed()) return;
    const url = page.getURL();
    if (!/^https?:\/\//i.test(url) || page.isLoadingMainFrame()) throw new Error('Open a website and wait for it to load first.');
    if (readerOpen) {
      // Leaving reader re-loads the real page.
      readerOpen = false;
      void page.loadURL(url).catch(() => {});
      publish();
      return;
    }
    const article = await page.executeJavaScriptInIsolatedWorld(1010, [{ code: `(${readerExtract.toString()})()` }]);
    if (page.isDestroyed() || page.getURL() !== url) throw new Error('The page changed. Try reader mode again.');
    if (!article) throw new Error('No readable article was found on this page.');
    const html = readerHtml(article);
    readerOpen = true;
    await page.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {});
    publish();
  }

  function readerHtml(article) {
    const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const body = article.paragraphs.map(entry => {
      const text = escape(entry.text);
      if (entry.tag === 'h2') return `<h2>${text}</h2>`;
      if (entry.tag === 'h3') return `<h3>${text}</h3>`;
      if (entry.tag === 'li') return `<li>${text}</li>`;
      if (entry.tag === 'blockquote') return `<blockquote>${text}</blockquote>`;
      return `<p>${text}</p>`;
    }).join('\n');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(article.title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; background: #fbfaf7; color: #1c1b19; font: 19px/1.7 Georgia, "Times New Roman", serif; }
  main { max-width: 44rem; margin: 0 auto; padding: 48px 24px 96px; }
  h1 { font-size: 2rem; line-height: 1.25; margin: 0 0 .35em; }
  .source { font: 13px/1.4 system-ui, sans-serif; color: #6b665e; margin-bottom: 2.5em; word-break: break-all; }
  h2 { font-size: 1.35rem; margin: 2.2em 0 .6em; }
  h3 { font-size: 1.12rem; margin: 1.8em 0 .5em; }
  p, li { margin: 0 0 1.15em; }
  blockquote { margin: 1.4em 0; padding-left: 1em; border-left: 3px solid #d8d2c6; color: #4a453d; }
  @media (prefers-color-scheme: dark) {
    body { background: #14151a; color: #e6e3dc; }
    .source { color: #9a958c; }
    blockquote { border-left-color: #3a3c44; color: #b6b1a8; }
  }
</style></head><body><main>
<h1>${escape(article.title)}</h1>
<p class="source">${escape(article.url)}</p>
${body}
</main></body></html>`;
  }

  function openPanel(html) {
    if (!browser || browser.isDestroyed()) return;
    if (!panel) {
      panel = new BrowserWindow({
        parent: browser,
        modal: false,
        width: 720,
        height: 640,
        minWidth: 420,
        minHeight: 320,
        autoHideMenuBar: true,
        backgroundColor: '#10151d',
        title: 'Browser tools',
        webPreferences: {
          sandbox: true, nodeIntegration: false, contextIsolation: true,
          preload: path.join(app.getAppPath(), 'dist/services/inAppBrowserPreload.cjs')
        }
      });
      panel.on('closed', () => { panel = null; });
      panel.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {});
    } else {
      panel.focus();
    }
  }

  ipcMain.handle('browser:command', async (event, action, value) => {
    if (event.sender !== browser?.webContents || event.senderFrame !== browser.webContents.mainFrame) return;
    const current = activeTab();
    const page = current?.page;
    const prefs = settings.get();

    switch (action) {
      case 'navigate': return navigateInput(value);
      case 'home': return navigate(homeAddress());
      case 'newTab': {
        if (tabs.length >= MAX_TABS) { notice = `Up to ${MAX_TABS} tabs can be open.`; publish(); return; }
        const url = typeof value === 'string' ? webUrl(value) : null;
        createTab(url);
        showDownloads(false);
        return;
      }
      case 'newPrivateTab': {
        if (tabs.length >= MAX_TABS) { notice = `Up to ${MAX_TABS} tabs can be open.`; publish(); return; }
        // A private tab gets its own in-memory partition, so its cookies and
        // cache vanish with the tab. The partition has to be chosen when the
        // view is constructed — page.session cannot be reassigned afterwards.
        const privateSession = session.fromPartition(`private-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, { cache: false });
        privateSession.setPermissionCheckHandler(() => false);
        privateSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
        const tab = createTab(null, { private: true, session: privateSession });
        notice = 'Private tab: cookies and history for this tab are discarded when it closes.';
        activateTab(tab.id);
        return;
      }
      case 'closePrivateTabs': {
        for (const tab of tabs.filter(item => item.private)) closeTab(tab.id);
        return;
      }
      case 'activateTab': return activateTab(Number(value));
      case 'closeTab': return closeTab(Number(value) || activeId);
      case 'duplicateTab': {
        if (tabs.length >= MAX_TABS) { notice = `Up to ${MAX_TABS} tabs can be open.`; publish(); return; }
        createTab(current?.address || null);
        return;
      }
      case 'closeOthers': {
        for (const tab of [...tabs]) if (tab.id !== activeId) closeTab(tab.id);
        return;
      }
      case 'back': if (page.navigationHistory.canGoBack()) page.navigationHistory.goBack(); return;
      case 'forward': if (page.navigationHistory.canGoForward()) page.navigationHistory.goForward(); return;
      case 'reload':
        if (address) {
          if (page.isLoadingMainFrame()) page.stop();
          else if (notice) void page.loadURL(address).catch(() => {});
          else page.reload();
        }
        return;
      case 'stop': page.stop(); return;
      case 'downloads': return showDownloads(!showingDownloads);

      // ── Shields ──────────────────────────────────────────────────────────
      case 'shieldLevel': return setShieldLevel(['strict', 'standard', 'off'].includes(value) ? value : 'standard');
      case 'clearSiteShield': return clearSiteOverride();
      case 'toggleShieldScripts': {
        const host = hostOf(current?.address ?? '');
        if (!host) return undefined;
        const site = settings.get().siteSettings[host] ?? {};
        settings.setSite(host, { ...site, blockScripts: !(site.blockScripts ?? prefs.blockScripts) });
        refreshSecurity();
        if (page.getURL()) page.reload();
        return;
      }
      case 'resetShieldCounters': shields?.reset(); return publish();

      // ── Zoom ─────────────────────────────────────────────────────────────
      case 'zoomIn': return setZoom(Math.min(500, zoomFor(current?.address ?? '') + 10));
      case 'zoomOut': return setZoom(Math.max(25, zoomFor(current?.address ?? '') - 10));
      case 'zoomReset': return setZoom(100);

      // ── Find in page ─────────────────────────────────────────────────────
      case 'find': return findInPage(value, { findNext: false });
      case 'findNext': return findInPage(findQuery, { findNext: true });
      case 'findPrevious': return findInPage(findQuery, { findNext: true, backward: true });
      case 'closeFind': return findInPage('', {});

      // ── Reader ───────────────────────────────────────────────────────────
      case 'reader': return toggleReader();

      // ── Bookmarks & history ──────────────────────────────────────────────
      case 'bookmark': {
        // A blank tab has no URL yet; the toolbar disables the star, and the
        // command has to agree rather than throw on an empty key.
        const url = current?.address || page?.getURL?.() || '';
        if (!/^https?:\/\//i.test(url)) { notice = 'Open a website first to bookmark it.'; publish(); return undefined; }
        const saved = library.isBookmarked(url)
          ? library.removeBookmark(url)
          : library.addBookmark(url, current?.title || url);
        publish();
        return saved;
      }
      case 'listHistory': return library.history();
      case 'removeHistory': return library.removeHistory(String(value));
      case 'clearHistory': return library.clearHistory();
      case 'listBookmarks': return library.bookmarks();
      case 'removeBookmark': return library.removeBookmark(String(value));

      // ── Preferences ──────────────────────────────────────────────────────
      case 'getSettings': return settings.get();
      case 'setSettings': {
        const patch = value && typeof value === 'object' ? value : {};
        settings.update(patch);
        refreshSecurity();
        return settings.get();
      }
      case 'clearBrowsingData': return clearBrowsingData();
      case 'openSettings': {
        openPanel(settingsHtml());
        return true;
      }

      // ── Downloads (unchanged surface) ─────────────────────────────────────
      case 'findDownloadLinks': {
        const owner = page;
        const url = owner.getURL();
        if (!/^https?:\/\//i.test(url) || owner.isLoadingMainFrame()) throw new Error('Open a website and wait for it to load first.');
        const links = await owner.executeJavaScriptInIsolatedWorld(1001, [{ code: `(${pageDownloadLinks.toString()})()` }]);
        if (page !== owner || owner.isDestroyed() || owner.getURL() !== url) throw new Error('The page changed. Try finding links again.');
        return links;
      }
      case 'findVideos': {
        const owner = page;
        const url = owner.getURL();
        if (!/^https?:\/\//i.test(url) || owner.isLoadingMainFrame()) throw new Error('Open a website and wait for it to load first.');
        const collected = await owner.executeJavaScriptInIsolatedWorld(1002, [{ code: `(${mediaCollector.toString()})()` }]);
        const anchors = await owner.executeJavaScriptInIsolatedWorld(1003, [{ code: `(${videoLinks.toString()})()` }]);
        if (page !== owner || owner.isDestroyed() || owner.getURL() !== url) throw new Error('The page changed. Try finding videos again.');
        const seen = new Set();
        const combined = [];
        for (const item of [...collected.map(src => ({ url: src, label: src.slice(0, 160) })), ...anchors]) {
          if (seen.has(item.url)) continue;
          seen.add(item.url);
          combined.push(item);
        }
        return combined;
      }
      case 'startDownloads':
        if (!choosingFolder && !downloads.state().running && !downloads.state().paused) {
          const lines = typeof value === 'string' && value.length <= 200_000 ? value.split(/\r?\n/).map(line => line.trim()).filter(Boolean) : [];
          const urls = lines.map(line => /^https?:\/\//i.test(line) ? webUrl(line) : null);
          if (!urls.length || urls.length > 100 || urls.includes(null)) {
            throw new Error('Paste up to 100 direct HTTP or HTTPS links, one per line.');
          }
          const owner = browser;
          choosingFolder = true;
          try {
            const selection = await require('electron').dialog.showOpenDialog(owner, {
              title: 'Choose a download folder', defaultPath: app.getPath('downloads'), properties: ['openDirectory', 'createDirectory']
            });
            if (browser === owner && !owner.isDestroyed() && !selection.canceled && selection.filePaths[0]) {
              downloads.start([...new Set(urls)], selection.filePaths[0]);
            }
          } finally { choosingFolder = false; }
        }
        return;
      case 'resumeDownloads': return downloads.resume();
      case 'cancelDownloads': return downloads.cancel();
      case 'pauseEntry': return downloads.pauseEntry(String(value));
      case 'resumeEntry': return downloads.resumeEntry(String(value));
      case 'cancelEntry': return downloads.cancelEntry(String(value));
      case 'retryEntry': return downloads.retryEntry(String(value));
      case 'removeEntry': return downloads.removeEntry(String(value));
      case 'clearFinished': return downloads.clearFinished();
      case 'openEntryFile': return downloads.openFile(String(value), shell);
      case 'showEntryInFolder': return downloads.showInFolder(String(value), shell);
      case 'ready':
        // Restore the previous session's tab URLs when the operator asked for it.
        if (prefs.restoreTabsOnStartup) {
          const last = library.history().slice(0, 3);
          if (last.length > 1 && tabs.length === 1 && !activeTab()?.address) {
            for (const entry of last.slice(1)) createTab(entry.url);
            activateTab(tabs[0].id);
            navigate(last[0].url, tabs[0]);
          }
        }
        return publish();
      default:
        return undefined;
    }
  });

  function settingsHtml() {
    const prefs = settings.get();
    return `<!doctype html><html><head><meta charset="utf-8"><title>Browser settings</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 24px; background: #10151d; color: #e8eef7; font: 14px/1.6 system-ui, sans-serif; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.lead { color: #9fb3d1; margin: 0 0 20px; }
  section { border: 1px solid #2c3a50; border-radius: 8px; padding: 14px 16px; margin-bottom: 14px; background: #121923; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: #8ea6c6; margin: 0 0 10px; }
  label { display: flex; gap: 10px; align-items: baseline; padding: 5px 0; }
  label span.hint { display: block; color: #8698b3; font-size: 12px; }
  input[type=checkbox] { flex: 0 0 auto; }
  dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; font-size: 13px; }
  dt { color: #9fb3d1; }
</style></head><body>
<h1>Browser settings</h1>
<p class="lead">These settings are stored in your profile. Change them from the 🌐 toolbar menu in the browser window.</p>
<section><h2>Shields</h2><dl>
  <dt>Default level</dt><dd>${prefs.shieldLevel}</dd>
  <dt>Block ads</dt><dd>${prefs.blockAds ? 'On' : 'Off'}</dd>
  <dt>Block trackers</dt><dd>${prefs.blockTrackers ? 'On' : 'Off'}</dd>
  <dt>Block fingerprinting</dt><dd>${prefs.blockFingerprinting ? 'On' : 'Off'}</dd>
  <dt>Upgrade to HTTPS</dt><dd>${prefs.upgradeToHttps ? 'On' : 'Off'}</dd>
  <dt>Site overrides</dt><dd>${Object.keys(prefs.siteSettings).length}</dd>
</dl></section>
<section><h2>Privacy</h2><dl>
  <dt>Block third-party cookies</dt><dd>${prefs.blockThirdPartyCookies ? 'On' : 'Off'}</dd>
  <dt>Send Do Not Track</dt><dd>${prefs.sendDoNotTrack ? 'On' : 'Off'}</dd>
  <dt>Clear data on exit</dt><dd>${prefs.clearOnExit ? 'On' : 'Off'}</dd>
</dl></section>
<section><h2>Browsing</h2><dl>
  <dt>Search engine</dt><dd>${prefs.searchEngine}</dd>
  <dt>Default zoom</dt><dd>${prefs.defaultZoom}%</dd>
  <dt>Restore tabs on startup</dt><dd>${prefs.restoreTabsOnStartup ? 'On' : 'Off'}</dd>
</dl></section>
</body></html>`;
  }

  function open() {
    if (browser && !browser.isDestroyed()) {
      if (browser.isMinimized()) browser.restore();
      browser.focus();
      return;
    }

    const root = app.getAppPath();
    settings = createBrowserSettings({ app });
    library = createBrowserLibrary({ app });
    const browserSession = session.fromPartition('persist:mla-web-browser');
    browserSession.setPermissionCheckHandler(() => false);
    browserSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    const preferences = { sandbox: true, nodeIntegration: false, contextIsolation: true };
    browser = new BrowserWindow({
      title: 'MediaLibrary Plus Browser', width: 1180, height: 800, minWidth: 560, minHeight: 360,
      autoHideMenuBar: true, backgroundColor: '#10151d', show: false,
      webPreferences: { ...preferences, preload: path.join(root, 'dist/services/inAppBrowserPreload.cjs') }
    });
    const owner = browser;
    // Cookie policy + privacy headers must be in place before the first page
    // load, otherwise the initial request goes out unprotected.
    applyPrivacyHeaders(browserSession);
    applyShields();
    downloads = createDownloadQueue({
      fetchFile: (url, signal) => browserSession.fetch(url, { credentials: 'include', signal }),
      publish,
      shell,
      verify: url => {
        const valid = webUrl(url);
        if (valid) {
          navigate(valid);
        }
      }
    });
    const queue = downloads;
    async function clearanceChanged(_event, cookie, _cause, removed) {
      if (removed || cookie.name !== 'cf_clearance' || !queue.state().paused) return;
      // Resume when a new clearance cookie lands for any challenged origin.
      const pending = tabs.map(tab => tab.address).filter(address => address);
      for (const base of pending) {
        const applicable = await browserSession.cookies.get({ url: base, name: cookie.name }).catch(() => []);
        if (applicable.some(item => item.domain === cookie.domain && item.path === cookie.path && item.value === cookie.value)) {
          queue.resumeAfterVerification();
          break;
        }
      }
    }
    function suppressVerificationDownload(event, item, source) {
      if (!tabs.some(tab => tab.page === source) || !queue.state().paused) return;
      // After verification the site may redirect straight to the attachment.
      // The queue owns that download and its destination folder.
      event.preventDefault();
    }
    browserSession.cookies.on('changed', clearanceChanged);
    browserSession.on('will-download', suppressVerificationDownload);

    const focusAddress = (event, input) => {
      if (input.type !== 'keyDown' || !(input.control || input.meta)) return;
      const key = input.key.toLowerCase();
      if (key === 'l') {
        event.preventDefault();
        owner.webContents.focus();
        owner.webContents.send('browser:focusAddress');
      } else if (key === 'f') {
        // Find lives in the chrome window, so focus has to move there before
        // the operator can type a query.
        event.preventDefault();
        owner.webContents.focus();
        owner.webContents.send('browser:focusFind');
      }
    };
    owner.webContents.on('before-input-event', focusAddress);

    owner.webContents.on('will-navigate', event => event.preventDefault());
    owner.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    owner.on('close', () => {
      const prefs = settings.get();
      if (prefs.clearOnExit) void clearBrowsingData();
    });
    owner.on('closed', () => {
      browserSession.cookies.removeListener('changed', clearanceChanged);
      browserSession.removeListener('will-download', suppressVerificationDownload);
      shields?.dispose();
      queue.cancel();
      if (panel && !panel.isDestroyed()) panel.close();
      panel = null;
      for (const tab of tabs) {
        browser.contentView.removeChildView(tab.view);
        if (!tab.page.isDestroyed()) tab.page.close();
      }
      tabs = [];
      activeId = 0;
      browser = undefined;
    });
    owner.once('ready-to-show', () => owner.show());
    void owner.loadFile(path.join(root, 'dist/renderer/in-app-browser/index.html')).then(() => {
      createTab();
    }).catch(() => owner.close());
  }

  return { open, _internals: { createTab, closeTab, activateTab, settingsFor, zoomFor, looksLikeSearch, findInPage } };
}

module.exports = { createInAppBrowser, browserUserAgent, looksLikeSearch };
