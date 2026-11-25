// Smoke test for the Brave-style browser chrome.
//
// Launches the built app against a scratch profile, opens the browser window,
// and drives the new toolbar controls through the real IPC surface. Every step
// is bounded so a stall reports instead of hanging.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { _electron } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function withTimeout(label, promise, ms = 20000) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
}

async function main() {
  const profile = path.join(os.tmpdir(), `mla-browser-smoke-${Date.now()}`);
  fs.mkdirSync(profile, { recursive: true });
  const settingsFile = path.join(profile, 'browser-settings.json');
  const dataFile = path.join(profile, 'browser-data.json');

  const env = { ...process.env, MLA_USER_DATA_DIR: profile };
  // The host shell forces plain-Node mode; Electron cannot boot with these set.
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;

  const app = await _electron.launch({ args: [ROOT], env });
  const problems = [];
  const failures = [];
  app.process().stderr?.on('data', chunk => {
    const text = String(chunk);
    if (/Error occurred in handler|Unhandled|TypeError|ReferenceError/.test(text)) problems.push(text.trim());
  });

  const step = async (label, fn) => {
    try {
      const result = await withTimeout(label, fn());
      console.log(`ok   ${label}${result === undefined ? '' : ' → ' + JSON.stringify(result)}`);
      return result;
    } catch (error) {
      failures.push(`${label}: ${error.message}`);
      console.log(`FAIL ${label}: ${error.message}`);
      return undefined;
    }
  };

  try {
    let main = null;
    for (let attempt = 0; attempt < 60 && !main; attempt += 1) {
      main = app.windows()[0] ?? null;
      if (!main) await sleep(250);
    }
    if (!main) throw new Error('the app never opened a window');
    main.on('console', message => { if (message.type() === 'error') problems.push(`[main] ${message.text()}`); });
    await main.waitForLoadState('domcontentloaded');
    await step('shell state loads', () => main.evaluate(async () => {
      const state = await window.desktopApi.getAppState();
      return { movies: state.movies?.length ?? 0, labelFields: state.movieLabelFields?.length ?? 0 };
    }));

    await step('browser window opens', async () => {
      await main.evaluate(() => window.desktopApi.openBrowser());
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const found = app.windows().find(win => win.url().includes('in-app-browser'));
        if (found) return found.url().split('/').slice(-2).join('/');
        await sleep(250);
      }
      throw new Error('no in-app-browser window appeared');
    });

    const chrome = app.windows().find(win => win.url().includes('in-app-browser'));
    if (!chrome) throw new Error('browser window missing');
    chrome.on('console', message => { if (message.type() === 'error') problems.push(`[chrome] ${message.text()}`); });
    await chrome.waitForLoadState('domcontentloaded');

    const state = () => chrome.evaluate(() => ({
      zoom: document.getElementById('zoom-label').textContent,
      shield: document.getElementById('shield').dataset.level,
      pressed: document.getElementById('shield').getAttribute('aria-pressed'),
      override: document.getElementById('shield').dataset.override,
      bookmark: document.getElementById('bookmark').textContent,
      bookmarked: document.getElementById('bookmark').getAttribute('aria-pressed'),
      find: document.getElementById('find-bar').hidden,
      tabs: document.querySelectorAll('#tabs .tab').length,
      menu: document.getElementById('menu').hidden,
      reader: document.getElementById('reader').getAttribute('aria-pressed'),
      status: document.getElementById('status').textContent
    }));
    const send = (action, value) => chrome.evaluate(([a, v]) => window.browserToolbar.command(a, v), [action, value]);
    const waitFor = (label, fn, arg) => step(label, () => chrome.waitForFunction(fn, arg, { timeout: 12000 }));

    await waitFor('toolbar renders initial state', () => document.getElementById('zoom-label').textContent.includes('%'));
    console.log('     initial:', JSON.stringify(await state()));

    // Navigate somewhere real but offline-safe so page-dependent features work.
    await step('navigate to a data: document', () => send('navigate', 'data:text/html,<title>Smoke</title><h1>Smoke page</h1>'));
    await sleep(500);

    // ── Zoom ────────────────────────────────────────────────────────────────
    await step('zoom in twice', async () => { await send('zoomIn'); await send('zoomIn'); });
    await waitFor('zoom reaches 120%', () => document.getElementById('zoom-label').textContent === '120%');
    await step('zoom out once', () => send('zoomOut'));
    await waitFor('zoom settles at 110%', () => document.getElementById('zoom-label').textContent === '110%');
    await step('zoom reset', () => send('zoomReset'));
    await waitFor('zoom back to 100%', () => document.getElementById('zoom-label').textContent === '100%');

    // ── Shields ─────────────────────────────────────────────────────────────
    await step('shields to strict', () => send('shieldLevel', 'strict'));
    await waitFor('strict is reflected', () => document.getElementById('shield').dataset.level === 'strict');
    await step('shields off', () => send('shieldLevel', 'off'));
    await waitFor('shields register as off', () => document.getElementById('shield').getAttribute('aria-pressed') === 'false');
    await waitFor('off level shown', () => document.getElementById('shield').dataset.level === 'off');
    await step('clear site override', () => send('clearSiteShield'));
    await step('reset counters', () => send('resetShieldCounters'));

    // ── Find ────────────────────────────────────────────────────────────────
    await step('find opens', () => send('find', 'media'));
    await waitFor('find bar visible', () => !document.getElementById('find-bar').hidden);
    console.log('     find:', JSON.stringify(await chrome.evaluate(() => ({
      query: document.getElementById('find-input').value,
      count: document.getElementById('find-count').textContent
    }))));
    await step('find closes', () => send('closeFind'));
    await waitFor('find bar hidden', () => document.getElementById('find-bar').hidden);

    // ── Navigation + history ────────────────────────────────────────────────
    // A typed word becomes a search; a typed address navigates. History must
    // hold the search but never the chrome's own data: URL.
    await step('a typed word searches', async () => {
      await send('navigate', 'mla smoke test');
      await sleep(1200);
      const data = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : { history: [] };
      const search = data.history.find(entry => entry.url.startsWith('https://search.brave.com/search?q=mla'));
      if (!search) throw new Error(`search not recorded: ${JSON.stringify(data.history.map(e => e.url))}`);
      return search.url;
    });
    await step('history holds no data: URLs', async () => {
      const data = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : { history: [] };
      const nonWeb = data.history.filter(entry => !/^https?:/.test(entry.url));
      if (nonWeb.length) throw new Error(`non-web entries: ${JSON.stringify(nonWeb.map(e => e.url))}`);
      return { visits: data.history.length };
    });

    // ── Menu + preferences ──────────────────────────────────────────────────
    await step('menu opens', async () => { await chrome.click('#menu-button'); });
    await waitFor('menu visible', () => !document.getElementById('menu').hidden);
    const prefs = await step('preferences round-trip', () => chrome.evaluate(async () => {
      await window.browserToolbar.command('setSettings', { searchEngine: 'duckduckgo', clearOnExit: true, defaultZoom: 110, blockFingerprinting: false });
      const saved = await window.browserToolbar.command('getSettings');
      return { engine: saved.searchEngine, clearOnExit: saved.clearOnExit, zoom: saved.defaultZoom, fp: saved.blockFingerprinting };
    }));
    await step('menu closes with Escape', () => chrome.keyboard.press('Escape'));
    await waitFor('menu hidden again', () => document.getElementById('menu').hidden);

    // ── Tabs ────────────────────────────────────────────────────────────────
    await step('new tab', () => send('newTab'));
    await waitFor('two tabs open', () => document.querySelectorAll('#tabs .tab').length === 2);
    await step('duplicate tab', () => send('duplicateTab'));
    await waitFor('three tabs open', () => document.querySelectorAll('#tabs .tab').length === 3);
    await step('private tab', () => send('newPrivateTab'));
    await waitFor('four tabs open', () => document.querySelectorAll('#tabs .tab').length === 4);
    await step('close private tabs', () => send('closePrivateTabs'));
    await waitFor('three tabs remain', () => document.querySelectorAll('#tabs .tab').length === 3);
    await step('close others', () => send('closeOthers'));
    await waitFor('one tab remains', () => document.querySelectorAll('#tabs .tab').length === 1);

    // ── Keyboard shortcut path ──────────────────────────────────────────────
    await step('Ctrl+T opens a tab', async () => { await chrome.keyboard.press('Control+t'); });
    await waitFor('shortcut added a tab', () => document.querySelectorAll('#tabs .tab').length === 2);
    await step('Ctrl+F opens find', async () => { await chrome.keyboard.press('Control+f'); });
    await waitFor('find bar from keyboard', () => !document.getElementById('find-bar').hidden);

    // ── Persistence ─────────────────────────────────────────────────────────
    await step('settings file written', async () => {
      const onDisk = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      if (onDisk.searchEngine !== 'duckduckgo') throw new Error('search engine was not persisted');
      return { engine: onDisk.searchEngine, clearOnExit: onDisk.clearOnExit, zoom: onDisk.defaultZoom };
    });

    console.log('     final:', JSON.stringify(await state()));
  } finally {
    // Report before teardown: closing Electron can reject when a private
    // partition is still settling, and the verdict matters more than that.
    const noise = problems.filter(line => !/DevTools|Autofill/.test(line));
    console.log(noise.length ? `\nconsole/process problems:\n  ${noise.join('\n  ')}` : '\nno console errors');
    if (failures.length) console.log(`\n${failures.length} step(s) failed`);
    process.exitCode = failures.length ? 1 : 0;
    await app.close().catch(error => console.log(`(teardown note: ${error.message.split('\n')[0]})`));
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch(error => { console.error('SMOKE FAILED:', error.message); process.exit(1); });
