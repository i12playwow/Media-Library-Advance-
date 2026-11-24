'use strict';
const path = require('node:path');
const { createDownloadQueue } = require('./browserDownloads.cjs');
const { attachAdBlocker } = require('./adBlocker.cjs');

const TOOLBAR_HEIGHT = 70;
const TABBAR_HEIGHT = 34;
const CONTENT_TOP = TOOLBAR_HEIGHT + TABBAR_HEIGHT;
const MAX_TABS = 12;

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

function createInAppBrowser({ app, BrowserWindow, WebContentsView, ipcMain, session }) {
  let browser;
  let tabs = [];
  let activeId = 0;
  let nextTabId = 1;
  let address = '';
  let notice = '';
  let downloads;
  let showingDownloads = false;
  let choosingFolder = false;
  let adBlocker;
  let activeView;

  function activeTab() { return tabs.find(tab => tab.id === activeId) ?? null; }

  function showDownloads(show) {
    showingDownloads = show;
    const current = activeTab();
    if (current?.view) current.view.setVisible(!show && Boolean(current.page.getURL()) && !notice);
    publish();
  }

  function publish() {
    if (!browser || browser.isDestroyed()) return;
    const current = activeTab();
    const page = current?.page;
    browser.webContents.send('browser:state', {
      address,
      notice,
      loading: page ? page.isLoadingMainFrame() : false,
      back: page ? page.navigationHistory.canGoBack() : false,
      forward: page ? page.navigationHistory.canGoForward() : false,
      showingDownloads,
      downloads: downloads.state(),
      adBlockCount: adBlocker?.count() ?? 0,
      tabs: tabs.map(tab => ({
        id: tab.id,
        title: tab.title || tab.address || 'New tab',
        address: tab.address,
        loading: tab.page.isLoadingMainFrame(),
        active: tab.id === activeId,
        canClose: tabs.length > 1
      }))
    });
  }

  function bindPageEvents(tab) {
    const { page, view } = tab;
    const navigated = (_event, url) => {
      if (!/^https?:\/\//i.test(url)) return;
      tab.address = url;
      tab.title = page.getTitle?.() || tab.title;
      if (tab.id === activeId) { address = url; notice = ''; }
      view.setVisible(tab.id === activeId && !showingDownloads);
      publish();
    };
    page.on('did-navigate', navigated);
    page.on('did-navigate-in-page', (event, url, isMainFrame) => { if (isMainFrame) navigated(event, url); });
    page.on('page-title-updated', (_event, title) => {
      tab.title = title;
      if (tab.id === activeId) publish();
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
  }

  function createTab(url) {
    const root = app.getAppPath();
    const browserSession = session.fromPartition('persist:mla-web-browser');
    const view = new WebContentsView({ webPreferences: {
      sandbox: true, nodeIntegration: false, contextIsolation: true, session: browserSession
    } });
    const tab = {
      id: nextTabId++,
      view,
      page: view.webContents,
      address: url ?? '',
      title: url ? new URL(url).hostname : 'New tab'
    };
    tabs.push(tab);
    browser.contentView.addChildView(view);
    const resize = () => {
      const [width, height] = browser.getContentSize();
      view.setBounds({ x: 0, y: CONTENT_TOP, width, height: Math.max(0, height - CONTENT_TOP) });
    };
    resize();
    browser.off?.('resize', resize);
    browser.on('resize', resize);
    tab.resize = resize;
    bindPageEvents(tab);
    if (url) void tab.page.loadURL(url).catch(() => {});
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
    for (const tab of tabs) tab.view.setVisible(tab.id === id && !showingDownloads && Boolean(target.address));
    activeView = target.view;
    target.page.focus();
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

  function navigate(url) {
    const current = activeTab();
    if (!current) return;
    current.address = url;
    address = url;
    notice = '';
    showDownloads(false);
    current.view.setVisible(true);
    void current.page.loadURL(url).catch(() => {}); // did-fail-load publishes navigation errors.
  }

  ipcMain.handle('browser:command', async (event, action, value) => {
    if (event.sender !== browser?.webContents || event.senderFrame !== browser.webContents.mainFrame) return;
    const current = activeTab();
    const page = current?.page;
    if (action === 'navigate') {
      const url = webUrl(value);
      if (!url) {
        notice = 'Enter a valid HTTP or HTTPS website address.';
        publish();
        return;
      }
      navigate(url);
    } else if (action === 'newTab') {
      if (tabs.length >= MAX_TABS) { notice = `Up to ${MAX_TABS} tabs can be open.`; publish(); return; }
      const url = typeof value === 'string' ? webUrl(value) : null;
      createTab(url);
      showDownloads(false);
    } else if (action === 'activateTab') activateTab(Number(value));
    else if (action === 'closeTab') closeTab(Number(value));
    else if (action === 'back' && page.navigationHistory.canGoBack()) page.navigationHistory.goBack();
    else if (action === 'forward' && page.navigationHistory.canGoForward()) page.navigationHistory.goForward();
    else if (action === 'reload' && address) {
      if (page.isLoadingMainFrame()) page.stop();
      else if (notice) void page.loadURL(address).catch(() => {});
      else page.reload();
    } else if (action === 'downloads') showDownloads(!showingDownloads);
    else if (action === 'findDownloadLinks') {
      const owner = page;
      const url = owner.getURL();
      if (!/^https?:\/\//i.test(url) || owner.isLoadingMainFrame()) throw new Error('Open a website and wait for it to load first.');
      const links = await owner.executeJavaScriptInIsolatedWorld(1001, [{ code: `(${pageDownloadLinks.toString()})()` }]);
      if (page !== owner || owner.isDestroyed() || owner.getURL() !== url) throw new Error('The page changed. Try finding links again.');
      return links;
    } else if (action === 'findVideos') {
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
    } else if (action === 'startDownloads' && !choosingFolder && !downloads.state().running && !downloads.state().paused) {
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
    } else if (action === 'resumeDownloads') downloads.resume();
    else if (action === 'cancelDownloads') downloads.cancel();
    else if (action === 'pauseEntry') downloads.pauseEntry(String(value));
    else if (action === 'resumeEntry') downloads.resumeEntry(String(value));
    else if (action === 'cancelEntry') downloads.cancelEntry(String(value));
    else if (action === 'retryEntry') downloads.retryEntry(String(value));
    else if (action === 'removeEntry') downloads.removeEntry(String(value));
    else if (action === 'clearFinished') downloads.clearFinished();
    else if (action === 'openEntryFile') await downloads.openFile(String(value), shell);
    else if (action === 'showEntryInFolder') await downloads.showInFolder(String(value), shell);
    else if (action === 'ready') publish();
  });

  function open() {
    if (browser && !browser.isDestroyed()) {
      if (browser.isMinimized()) browser.restore();
      browser.focus();
      return;
    }

    const root = app.getAppPath();
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
    adBlocker = attachAdBlocker({
      session: browserSession,
      onBlocked: () => publish()
    });
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
      if (input.type !== 'keyDown' || !(input.control || input.meta) || input.key.toLowerCase() !== 'l') return;
      event.preventDefault();
      owner.webContents.focus();
      owner.webContents.send('browser:focusAddress');
    };
    owner.webContents.on('before-input-event', focusAddress);

    owner.webContents.on('will-navigate', event => event.preventDefault());
    owner.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    owner.on('closed', () => {
      browserSession.cookies.removeListener('changed', clearanceChanged);
      browserSession.removeListener('will-download', suppressVerificationDownload);
      adBlocker?.dispose();
      queue.cancel();
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

  return { open, _internals: { createTab, closeTab, activateTab } };
}

module.exports = { createInAppBrowser };
