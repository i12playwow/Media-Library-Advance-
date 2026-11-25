'use strict';
// Toolbar script for the in-app browser window.
//
// Everything the page needs comes from the main process as a `browser:state`
// push and leaves again as a `browser:command` invoke, so this file holds no
// policy of its own: it renders state and forwards intents.
const toolbar = window.browserToolbar;

const el = id => document.getElementById(id);
const address = el('address');
const status = el('status');
const reload = el('reload');
const back = el('back');
const forward = el('forward');
const downloads = el('downloads');
const newTab = el('new-tab');
const tabsEl = el('tabs');
const home = el('home');
const shield = el('shield');
const shieldLevel = el('shield-level');
const bookmark = el('bookmark');
const zoomLabel = el('zoom-label');
const reader = el('reader');
const menuButton = el('menu-button');
const menu = el('menu');
const findBar = el('find-bar');
const findInput = el('find-input');
const findCount = el('find-count');
const findPrevious = el('find-previous');
const findNext = el('find-next');
const findClose = el('find-close');
const privateTabs = el('new-private-tab');

const downloadVideo = el('download-video');
const videoPanel = el('video-panel');
const findVideos = el('find-videos');
const videoStatus = el('video-status');
const videoPicker = el('video-picker');
const videoChoices = el('video-choices');
const selectVideos = el('select-videos');
const addVideos = el('add-videos');
const videoLinks = el('video-links');
const panel = el('download-panel');
const links = el('download-links');
const start = el('start-downloads');
const resume = el('resume-downloads');
const cancel = el('cancel-downloads');
const clearFinishedButton = el('clear-finished-downloads');
const summary = el('download-summary');
const list = el('download-list');
const findLinks = el('find-download-links');
const picker = el('link-picker');
const pickerStatus = el('link-picker-status');
const choices = el('link-choices');
const selectLinks = el('select-download-links');
const addLinks = el('add-download-links');

const SHIELD_TITLES = {
  strict: 'Shields up: strict',
  standard: 'Shields up: standard',
  off: 'Shields down for this site'
};

let lastAddress = '';
let pickerRevision = 0;
let videoRevision = 0;
let adBlockCount = 0;
let menuOpen = false;
let lastState = null;

const stripPrefix = message => message?.replace(/^Error invoking remote method '[^']+': Error: /, '') || '';

// ── Selection helpers for the link/video pickers ─────────────────────────────

function updateSelection() {
  addLinks.disabled = !choices.querySelector('input:checked');
  selectLinks.textContent = choices.querySelector('input:not(:checked)') ? 'Select all' : 'Clear selection';
}

function updateVideoSelection() {
  addVideos.disabled = !videoChoices.querySelector('input:checked');
  selectVideos.textContent = videoChoices.querySelector('input:not(:checked)') ? 'Select all' : 'Clear selection';
}

findLinks.addEventListener('click', async () => {
  const revision = ++pickerRevision;
  picker.hidden = true;
  choices.replaceChildren();
  pickerStatus.textContent = 'Looking for links…';
  try {
    const results = await toolbar.command('findDownloadLinks');
    if (revision !== pickerRevision) return;
    pickerStatus.textContent = results.length ? `${results.length} possible download links found.` : 'No direct download links found on this page.';
    for (const result of results) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = result.url;
      label.title = result.url;
      label.append(checkbox, result.label);
      choices.append(label);
    }
    picker.hidden = !results.length;
    updateSelection();
  } catch (error) {
    if (revision === pickerRevision) pickerStatus.textContent = stripPrefix(error.message) || 'Could not read links from this page.';
  }
});
choices.addEventListener('change', updateSelection);
selectLinks.addEventListener('click', () => {
  const checked = Boolean(choices.querySelector('input:not(:checked)'));
  for (const input of choices.querySelectorAll('input')) input.checked = checked;
  updateSelection();
});
addLinks.addEventListener('click', () => {
  const selected = Array.from(choices.querySelectorAll('input:checked'), input => input.value);
  const combined = [...new Set([...links.value.split(/\r?\n/).map(link => link.trim()).filter(Boolean), ...selected])];
  if (combined.length > 100 || combined.join('\n').length > 200_000) {
    pickerStatus.textContent = 'The queue can hold up to 100 links. Remove some before adding more.';
    return;
  }
  links.value = combined.join('\n');
  pickerStatus.textContent = `${selected.length} selected · ${combined.length} links ready to download.`;
  picker.hidden = true;
});

// ── Video finder (offline saving) ────────────────────────────────────────────

downloadVideo.addEventListener('click', () => {
  const showing = !videoPanel.hidden;
  videoPanel.hidden = showing;
  panel.hidden = true;
  if (!showing) {
    videoStatus.textContent = 'Scanning the page for videos…';
    void scanVideos();
  }
});
findVideos.addEventListener('click', () => void scanVideos());

async function scanVideos() {
  const revision = ++videoRevision;
  videoPicker.hidden = true;
  videoChoices.replaceChildren();
  videoStatus.textContent = 'Scanning the page for videos…';
  try {
    const results = await toolbar.command('findVideos');
    if (revision !== videoRevision) return;
    videoStatus.textContent = results.length
      ? `${results.length} video source${results.length === 1 ? '' : 's'} found. Select the ones to save offline.`
      : 'No video sources found on this page. Play the video once, then scan again.';
    for (const result of results) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = result.url;
      label.title = result.url;
      label.append(checkbox, result.label);
      videoChoices.append(label);
    }
    videoPicker.hidden = !results.length;
    updateVideoSelection();
  } catch (error) {
    if (revision === videoRevision) videoStatus.textContent = stripPrefix(error.message) || 'Could not scan this page.';
  }
}
videoChoices.addEventListener('change', updateVideoSelection);
selectVideos.addEventListener('click', () => {
  const checked = Boolean(videoChoices.querySelector('input:not(:checked)'));
  for (const input of videoChoices.querySelectorAll('input')) input.checked = checked;
  updateVideoSelection();
});
addVideos.addEventListener('click', () => {
  const selected = Array.from(videoChoices.querySelectorAll('input:checked'), input => input.value);
  const combined = [...new Set([...videoLinks.value.split(/\r?\n/).map(link => link.trim()).filter(Boolean), ...selected])];
  if (combined.length > 100 || combined.join('\n').length > 200_000) {
    videoStatus.textContent = 'The queue can hold up to 100 links. Remove some before adding more.';
    return;
  }
  videoLinks.value = combined.join('\n');
  videoStatus.textContent = `${selected.length} selected · ${combined.length} video links ready. Open Downloads to start saving.`;
  videoPicker.hidden = true;
});

// ── Command plumbing ─────────────────────────────────────────────────────────

function report(error) {
  // Errors surface on the status line unless the download panel is open,
  // where the operator is looking at the queue summary instead.
  const target = panel.hidden ? status : summary;
  target.textContent = stripPrefix(error.message) || 'The browser command failed. Try again.';
}

function command(action, value) {
  return toolbar.command(action, value).catch(error => { report(error); return undefined; });
}

document.querySelector('form').addEventListener('submit', event => {
  event.preventDefault();
  closeMenu();
  void command('navigate', address.value);
});

for (const button of [back, forward, reload, downloads, home]) {
  button.addEventListener('click', () => void command(button.id === 'home' ? 'home' : button.id));
}
newTab.addEventListener('click', () => void command('newTab'));
if (privateTabs) privateTabs.addEventListener('click', () => void command('newPrivateTab'));
start.addEventListener('click', () => void command('startDownloads', links.value));
resume.addEventListener('click', () => void command('resumeDownloads'));
cancel.addEventListener('click', () => void command('cancelDownloads'));
if (clearFinishedButton) clearFinishedButton.addEventListener('click', () => void command('clearFinished'));

// ── Shields ──────────────────────────────────────────────────────────────────

shield.addEventListener('click', () => {
  // Clicking the shield toggles shields down/up for the current site, which is
  // the single most-used Brave gesture; the level picker lives in the menu.
  if (!lastState) return;
  const next = lastState.shieldsEnabled ? 'off' : (lastState.siteHasOverride ? 'standard' : 'standard');
  void command('shieldLevel', next);
});

shieldLevel.addEventListener('change', () => {
  void command('shieldLevel', shieldLevel.value);
});

// Keep the dropdown honest even when the level changed from elsewhere.
function syncShieldSelect(level) {
  for (const option of shieldLevel.options) option.selected = option.value === level;
}

// ── Zoom ─────────────────────────────────────────────────────────────────────

zoomLabel.addEventListener('click', () => void command('zoomReset'));

// ── Bookmark / reader ────────────────────────────────────────────────────────

bookmark.addEventListener('click', () => void command('bookmark'));
reader.addEventListener('click', () => void command('reader'));

// ── Menu ─────────────────────────────────────────────────────────────────────

function openMenu() {
  menuOpen = true;
  menu.hidden = false;
  menuButton.setAttribute('aria-expanded', 'true');
  const first = menu.querySelector('button, select');
  if (first) first.focus();
}

function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false;
  menu.hidden = true;
  menuButton.setAttribute('aria-expanded', 'false');
}

menuButton.addEventListener('click', event => {
  event.stopPropagation();
  if (menuOpen) closeMenu();
  else openMenu();
});

menu.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const { action, value } = button.dataset;
  closeMenu();
  if (action === 'closeMenu') return;
  void command(action, value);
});

// Any click outside the menu dismisses it.
document.addEventListener('click', event => {
  if (menuOpen && !menu.contains(event.target) && event.target !== menuButton && !menuButton.contains(event.target)) closeMenu();
});

// ── Find in page ─────────────────────────────────────────────────────────────

function showFind(select) {
  // Find is an overlay on top of the page view, so it also opens the query
  // from state; select() is only used when the operator asked for it.
  findBar.hidden = false;
  if (select) findInput.select();
  else findInput.focus();
}

function hideFind() {
  findBar.hidden = true;
  findInput.value = '';
  findCount.textContent = '';
  void command('closeFind');
}

findInput.addEventListener('input', () => {
  const query = findInput.value;
  if (!query) { findCount.textContent = ''; void command('closeFind'); return; }
  void command('find', query);
});
findInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    void command(event.shiftKey ? 'findPrevious' : 'findNext');
  } else if (event.key === 'Escape') {
    event.preventDefault();
    hideFind();
  }
});
findNext.addEventListener('click', () => void command('findNext'));
findPrevious.addEventListener('click', () => void command('findPrevious'));
findClose.addEventListener('click', () => hideFind());

// ── Keyboard ─────────────────────────────────────────────────────────────────

document.addEventListener('keydown', event => {
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (key === 'escape' && menuOpen) { closeMenu(); return; }
  if (key === 'escape' && !findBar.hidden) { hideFind(); return; }
  if (!mod) {
    // F9 toggles reader mode, matching the menu accelerator.
    if (event.key === 'F9') { event.preventDefault(); void command('reader'); }
    return;
  }
  if (key === 't') { event.preventDefault(); void command(event.shiftKey ? 'newPrivateTab' : 'newTab'); }
  else if (key === 'w') { event.preventDefault(); void command('closeTab'); }
  else if (key === 'l') { event.preventDefault(); address.focus(); address.select(); }
  else if (key === 'f') { event.preventDefault(); showFind(true); }
  else if (key === 'd') { event.preventDefault(); void command('bookmark'); }
  else if (key === 'r') { event.preventDefault(); void command('reload'); }
  else if (key === '=' || key === '+') { event.preventDefault(); void command('zoomIn'); }
  else if (key === '-') { event.preventDefault(); void command('zoomOut'); }
  else if (key === '0') { event.preventDefault(); void command('zoomReset'); }
});

// ── State rendering ──────────────────────────────────────────────────────────

function tabElement(tab) {
  const item = document.createElement('div');
  item.className = `tab${tab.active ? ' active' : ''}`;
  item.setAttribute('role', 'tab');
  item.setAttribute('aria-selected', String(tab.active));
  item.dataset.tabId = String(tab.id);
  item.title = tab.address || tab.title;
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = `${tab.loading ? '⏳ ' : ''}${tab.muted ? '🔇 ' : ''}${tab.title}`;
  item.append(title);
  if (tab.canClose) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.setAttribute('aria-label', `Close ${tab.title}`);
    close.textContent = '×';
    close.addEventListener('click', event => {
      event.stopPropagation();
      void command('closeTab', tab.id);
    });
    item.append(close);
  }
  item.addEventListener('click', () => void command('activateTab', tab.id));
  item.addEventListener('auxclick', event => {
    if (event.button === 1 && tab.canClose) { event.preventDefault(); void command('closeTab', tab.id); }
  });
  return item;
}

function renderStatus(state) {
  const queue = state.downloads;
  const pauseMessage = queue.paused === 'verification'
    ? 'Waiting for website verification. Downloads resume when the site confirms it.'
    : queue.paused === 'rate-limit' ? 'The website asked for fewer requests. Downloads are paused.' : '';
  status.replaceChildren();
  status.append(state.notice || (state.loading ? 'Loading…' : pauseMessage) || '');
  if (adBlockCount > 0) {
    const badge = document.createElement('span');
    badge.className = 'adblock';
    badge.textContent = `🛡 ${adBlockCount} blocked`;
    badge.title = `${state.shieldCounts.ad} ads · ${state.shieldCounts.tracker} trackers · ${state.shieldCounts.fingerprint} fingerprinting · ${state.shieldCounts.script} scripts`;
    status.append(badge);
  }
  if (state.readerOpen) {
    const badge = document.createElement('span');
    badge.className = 'adblock';
    badge.textContent = 'Reader mode';
    status.append(badge);
  }
}

function renderFind(state) {
  const active = Boolean(state.findQuery);
  findBar.hidden = !active;
  if (document.activeElement !== findInput) findInput.value = state.findQuery || '';
  if (!active) { findCount.textContent = ''; return; }
  const result = state.findResult;
  if (!result) { findCount.textContent = '…'; return; }
  findCount.textContent = result.matches ? `${result.activeMatch} / ${result.matches}` : 'No matches';
  findCount.dataset.empty = String(!result.matches);
}

toolbar.onState(state => {
  lastState = state;

  if (state.tabs) tabsEl.replaceChildren(...state.tabs.map(tabElement));

  if (lastAddress !== state.address) {
    address.value = state.address;
    pickerRevision++;
    videoRevision++;
    picker.hidden = true;
    videoPicker.hidden = true;
    pickerStatus.textContent = '';
    videoStatus.textContent = '';
    choices.replaceChildren();
    videoChoices.replaceChildren();
  }
  lastAddress = state.address;

  back.disabled = !state.back;
  forward.disabled = !state.forward;
  reload.disabled = !state.address;
  reload.textContent = state.loading ? '×' : '↻';
  reload.title = state.loading ? 'Stop loading' : 'Reload';
  reload.setAttribute('aria-label', reload.title);
  home.disabled = false;

  // Shields: a pressed shield means protection is on for this page.
  const level = state.shieldLevel || 'standard';
  shield.dataset.level = level;
  shield.setAttribute('aria-pressed', String(Boolean(state.shieldsEnabled)));
  shield.title = `${SHIELD_TITLES[level] || SHIELD_TITLES.standard}${state.siteHost ? ` · ${state.siteHost}` : ''}\nClick to turn shields ${state.shieldsEnabled ? 'off' : 'on'}${state.siteHasOverride ? ' (site override)' : ''}`;
  shield.dataset.override = String(Boolean(state.siteHasOverride));
  syncShieldSelect(level);

  bookmark.setAttribute('aria-pressed', String(Boolean(state.bookmarked)));
  bookmark.textContent = state.bookmarked ? '★' : '☆';
  bookmark.title = state.bookmarked ? 'Remove bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)';
  bookmark.disabled = !state.address;

  zoomLabel.textContent = `${state.zoom ?? 100}%`;
  reader.setAttribute('aria-pressed', String(Boolean(state.readerOpen)));
  reader.disabled = !state.address;

  adBlockCount = state.adBlockCount ?? adBlockCount;
  renderStatus(state);
  renderFind(state);

  panel.hidden = !state.showingDownloads;
  document.querySelector('main').hidden = state.showingDownloads;
  downloads.setAttribute('aria-expanded', String(state.showingDownloads));

  const queue = state.downloads;
  start.disabled = queue.running || queue.paused;
  resume.hidden = !queue.paused;
  resume.textContent = queue.paused === 'verification' ? 'Resume after verification' : 'Resume downloads';
  cancel.disabled = !queue.running && !queue.paused;
  if (panel.hidden) return;

  // ── Download manager panel ────────────────────────────────────────────────
  const stats = queue.summary ?? {};
  const totalText = stats.total ? `${formatBytes(stats.received)} / ${formatBytes(stats.total)}` : formatBytes(stats.received);
  const speedText = stats.speed ? ` · ${formatBytes(stats.speed)}/s` : '';
  summary.textContent = (queue.paused === 'verification'
    ? 'Waiting for website verification. Downloads resume when the site confirms it.'
    : queue.paused === 'rate-limit' ? 'The website asked for fewer requests. Downloads are paused.' : '')
    || (queue.folder
      ? `${stats.completed ?? 0} completed · ${stats.active ?? 0} active · ${stats.failed ?? 0} failed · ${totalText}${speedText}`
      : '');
  clearFinishedButton.hidden = !queue.entries.some(entry => ['completed', 'cancelled', 'failed'].includes(entry.status));
  list.replaceChildren(...queue.entries.map(entry => managerRow(entry)));
});

function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(2)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function managerRow(entry) {
  const row = document.createElement('li');
  row.className = `download-row ${entry.status}`;

  const info = document.createElement('div');
  info.className = 'download-info';
  const name = document.createElement('span');
  name.className = 'download-name';
  name.textContent = entry.name || entry.url;
  name.title = entry.url;
  const meta = document.createElement('span');
  meta.className = 'download-meta';
  const percent = entry.total ? Math.min(100, Math.floor(entry.received / entry.total * 100)) : 0;
  const sizeText = entry.total ? `${formatBytes(entry.received)} / ${formatBytes(entry.total)}` : formatBytes(entry.received);
  const speedText = entry.status === 'downloading' && entry.speed ? ` · ${formatBytes(entry.speed)}/s` : '';
  meta.textContent = `${entry.status}${entry.status === 'downloading' ? ` ${percent}% · ${sizeText}${speedText}` : entry.status === 'completed' ? ` · ${formatBytes(entry.received)}` : ''}${entry.error ? ` · ${entry.error}` : ''}`;
  info.append(name, meta);

  const bar = document.createElement('div');
  bar.className = 'download-bar';
  const fill = document.createElement('div');
  fill.className = 'download-bar-fill';
  fill.style.width = `${percent}%`;
  bar.append(fill);

  const actions = document.createElement('div');
  actions.className = 'download-actions-row';
  const buttonFor = (label, action, title, enabled) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.title = title;
    button.setAttribute('aria-label', `${title}: ${entry.name || entry.url}`);
    button.disabled = !enabled;
    button.addEventListener('click', () => void command(action, entry.id));
    return button;
  };
  if (entry.status === 'downloading' || entry.status === 'queued') {
    actions.append(buttonFor('⏸', 'pauseEntry', 'Pause', entry.status === 'downloading'));
    actions.append(buttonFor('✕', 'cancelEntry', 'Cancel', true));
  } else if (entry.status === 'paused') {
    actions.append(buttonFor('▶', 'resumeEntry', 'Resume', true));
    actions.append(buttonFor('✕', 'cancelEntry', 'Cancel', true));
  } else if (entry.status === 'failed' || entry.status === 'cancelled') {
    actions.append(buttonFor('↻', 'retryEntry', 'Retry', true));
    actions.append(buttonFor('🗑', 'removeEntry', 'Remove from list', true));
  } else if (entry.status === 'completed') {
    actions.append(buttonFor('📂', 'openEntryFile', 'Open file', true));
    actions.append(buttonFor('📁', 'showEntryInFolder', 'Show in folder', true));
  }

  row.append(info, bar, actions);
  return row;
}

toolbar.onFocusAddress(() => { closeMenu(); address.focus(); address.select(); });
toolbar.onFocusFind(() => showFind(true));
void command('ready');
