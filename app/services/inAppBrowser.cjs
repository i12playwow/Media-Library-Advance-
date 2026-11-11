'use strict';
const path = require('node:path');
const { createDownloadQueue } = require('./browserDownloads.cjs');

const TOOLBAR_HEIGHT = 70;

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
  let page;
  let address = '';
  let notice = '';
  let downloads;
  let showingDownloads = false;
  let view;
  let choosingFolder = false;

  function showDownloads(show) {
    showingDownloads = show;
    view.setVisible(!show && Boolean(page.getURL()) && !notice);
    publish();
  }

  function navigate(url) {
    address = url;
    notice = '';
    showDownloads(false);
    void page.loadURL(url).catch(() => {}); // did-fail-load publishes navigation errors.
  }

  function publish() {
    if (!browser || browser.isDestroyed() || !page || page.isDestroyed()) return;
    browser.webContents.send('browser:state', {
      address,
      notice,
      loading: page.isLoadingMainFrame(),
      back: page.navigationHistory.canGoBack(),
      forward: page.navigationHistory.canGoForward(),
      showingDownloads,
      downloads: downloads.state()
    });
  }

  ipcMain.handle('browser:command', async (event, action, value) => {
    if (event.sender !== browser?.webContents || event.senderFrame !== browser.webContents.mainFrame) return;
    if (action === 'navigate') {
      const url = webUrl(value);
      if (!url) {
        notice = 'Enter a valid HTTP or HTTPS website address.';
        publish();
        return;
      }
      navigate(url);
    } else if (action === 'back' && page.navigationHistory.canGoBack()) page.navigationHistory.goBack();
    else if (action === 'forward' && page.navigationHistory.canGoForward()) page.navigationHistory.goForward();
    else if (action === 'reload' && address) {
      if (page.isLoadingMainFrame()) page.stop();
      else if (notice) void page.loadURL(address).catch(() => {});
      else page.reload();
    } else if (action === 'downloads') showDownloads(!showingDownloads);
    else if (action === 'findDownloadLinks') {
      const current = page;
      const url = current.getURL();
      if (!/^https?:\/\//i.test(url) || current.isLoadingMainFrame()) throw new Error('Open a website and wait for it to load first.');
      const links = await current.executeJavaScriptInIsolatedWorld(1001, [{ code: `(${pageDownloadLinks.toString()})()` }]);
      if (page !== current || current.isDestroyed() || current.getURL() !== url) throw new Error('The page changed. Try finding links again.');
      return links;
    }
    else if (action === 'startDownloads' && !choosingFolder && !downloads.state().running && !downloads.state().paused) {
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
    view = new WebContentsView({ webPreferences: { ...preferences, session: browserSession } });
    page = view.webContents;
    const contents = page;
    address = '';
    notice = '';
    showingDownloads = false;
    let challenge;
    downloads = createDownloadQueue({
      fetchFile: (url, signal) => browserSession.fetch(url, { credentials: 'include', signal }),
      publish,
      verify: url => {
        const valid = webUrl(url);
        if (valid) {
          challenge = { url: valid };
          navigate(valid);
        }
      }
    });
    const queue = downloads;
    async function clearanceChanged(_event, cookie, _cause, removed) {
      if (removed || cookie.name !== 'cf_clearance' || !challenge || queue.state().paused !== 'verification') return;
      const pending = challenge;
      // Only a new cookie applicable to the challenged URL can resume this queue.
      const applicable = await browserSession.cookies.get({ url: pending.url, name: cookie.name }).catch(() => []);
      if (browser !== owner || challenge !== pending || !applicable.some(item =>
        item.domain === cookie.domain && item.path === cookie.path && item.value === cookie.value
      )) return;
      queue.resumeAfterVerification();
    }
    function suppressVerificationDownload(event, item, source) {
      if (source !== contents || !challenge || challenge.downloadSuppressed) return;
      if (!item.getURLChain().includes(challenge.url)) return;
      // After verification the site may redirect straight to the attachment.
      // The queue owns that download and its destination folder.
      challenge.downloadSuppressed = true;
      event.preventDefault();
    }
    browserSession.cookies.on('changed', clearanceChanged);
    browserSession.on('will-download', suppressVerificationDownload);
    owner.contentView.addChildView(view);
    const resize = () => {
      const [width, height] = owner.getContentSize();
      view.setBounds({ x: 0, y: TOOLBAR_HEIGHT, width, height: Math.max(0, height - TOOLBAR_HEIGHT) });
    };
    view.setVisible(false);
    resize();
    owner.on('resize', resize);

    owner.webContents.on('will-navigate', event => event.preventDefault());
    owner.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const restrictNavigation = (event, url) => {
      if (!/^https?:\/\//i.test(url) || !webUrl(url)) event.preventDefault();
    };
    contents.on('will-navigate', restrictNavigation);
    contents.on('will-redirect', restrictNavigation);
    contents.on('will-attach-webview', event => event.preventDefault());

    const focusAddress = (event, input) => {
      if (input.type !== 'keyDown' || !(input.control || input.meta) || input.key.toLowerCase() !== 'l') return;
      event.preventDefault();
      owner.webContents.focus();
      owner.webContents.send('browser:focusAddress');
    };
    contents.on('before-input-event', focusAddress);
    owner.webContents.on('before-input-event', focusAddress);

    const navigated = (_event, url) => {
      if (!/^https?:\/\//i.test(url)) return;
      address = url;
      notice = '';
      view.setVisible(!showingDownloads);
      publish();
    };
    contents.on('did-navigate', navigated);
    contents.on('did-navigate-in-page', (event, url, isMainFrame) => { if (isMainFrame) navigated(event, url); });
    contents.on('did-start-loading', publish);
    contents.on('did-stop-loading', publish);
    contents.on('did-fail-load', (_event, code, _description, failedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      address = failedUrl;
      notice = 'This page could not be loaded. Check the address or try again.';
      view.setVisible(false);
      publish();
    });
    contents.on('render-process-gone', () => {
      notice = 'The page stopped responding. Reload to try again.';
      view.setVisible(false);
      publish();
    });

    owner.on('closed', () => {
      browserSession.cookies.removeListener('changed', clearanceChanged);
      browserSession.removeListener('will-download', suppressVerificationDownload);
      queue.cancel();
      if (!contents.isDestroyed()) contents.close();
      browser = undefined;
      page = undefined;
    });
    owner.once('ready-to-show', () => owner.show());
    void owner.loadFile(path.join(root, 'dist/renderer/in-app-browser/index.html')).catch(() => owner.close());
  }

  return { open };
}

module.exports = { createInAppBrowser };
