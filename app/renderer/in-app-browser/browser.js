'use strict';
const toolbar = window.browserToolbar;
const address = document.getElementById('address');
const status = document.getElementById('status');
const reload = document.getElementById('reload');
const back = document.getElementById('back');
const forward = document.getElementById('forward');
const downloads = document.getElementById('downloads');
const newTab = document.getElementById('new-tab');
const tabsEl = document.getElementById('tabs');
const downloadVideo = document.getElementById('download-video');
const videoPanel = document.getElementById('video-panel');
const findVideos = document.getElementById('find-videos');
const videoStatus = document.getElementById('video-status');
const videoPicker = document.getElementById('video-picker');
const videoChoices = document.getElementById('video-choices');
const selectVideos = document.getElementById('select-videos');
const addVideos = document.getElementById('add-videos');
const videoLinks = document.getElementById('video-links');
const panel = document.getElementById('download-panel');
const links = document.getElementById('download-links');
const start = document.getElementById('start-downloads');
const resume = document.getElementById('resume-downloads');
const cancel = document.getElementById('cancel-downloads');
const clearFinishedButton = document.getElementById('clear-finished-downloads');
const summary = document.getElementById('download-summary');
const list = document.getElementById('download-list');
const findLinks = document.getElementById('find-download-links');
const picker = document.getElementById('link-picker');
const pickerStatus = document.getElementById('link-picker-status');
const choices = document.getElementById('link-choices');
const selectLinks = document.getElementById('select-download-links');
const addLinks = document.getElementById('add-download-links');
let lastAddress = '';
let pickerRevision = 0;
let videoRevision = 0;
let adBlockCount = 0;

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
    if (revision === pickerRevision) pickerStatus.textContent = error.message?.replace(/^Error invoking remote method '[^']+': Error: /, '') || 'Could not read links from this page.';
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

// --- Video finder (offline saving) ---
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
    if (revision === videoRevision) videoStatus.textContent = error.message?.replace(/^Error invoking remote method '[^']+': Error: /, '') || 'Could not scan this page.';
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

function command(action, value) {
  void toolbar.command(action, value).catch(error => {
    const target = panel.hidden ? status : summary;
    target.textContent = error.message?.replace(/^Error invoking remote method '[^']+': Error: /, '') || 'The browser command failed. Try again.';
  });
}

document.querySelector('form').addEventListener('submit', event => {
  event.preventDefault();
  command('navigate', address.value);
});
for (const button of [back, forward, reload, downloads]) button.addEventListener('click', () => command(button.id));
newTab.addEventListener('click', () => command('newTab'));
start.addEventListener('click', () => command('startDownloads', links.value));
resume.addEventListener('click', () => command('resumeDownloads'));
cancel.addEventListener('click', () => command('cancelDownloads'));
if (clearFinishedButton) clearFinishedButton.addEventListener('click', () => command('clearFinished'));
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 't') {
    event.preventDefault();
    command('newTab');
  }
});

toolbar.onState(state => {
  if (state.tabs) {
    tabsEl.replaceChildren(...state.tabs.map(tab => {
      const item = document.createElement('div');
      item.className = `tab${tab.active ? ' active' : ''}`;
      item.setAttribute('role', 'tab');
      item.setAttribute('aria-selected', String(tab.active));
      item.dataset.tabId = String(tab.id);
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = `${tab.loading ? '⏳ ' : ''}${tab.title}`;
      item.append(title);
      if (tab.canClose) {
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'close';
        close.setAttribute('aria-label', `Close ${tab.title}`);
        close.textContent = '×';
        close.addEventListener('click', event => {
          event.stopPropagation();
          command('closeTab', tab.id);
        });
        item.append(close);
      }
      item.addEventListener('click', () => command('activateTab', tab.id));
      return item;
    }));
  }
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
  adBlockCount = state.adBlockCount ?? adBlockCount;
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
    status.append(badge);
  }
  panel.hidden = !state.showingDownloads;
  document.querySelector('main').hidden = state.showingDownloads;
  downloads.setAttribute('aria-expanded', String(state.showingDownloads));
  start.disabled = queue.running || queue.paused;
  resume.hidden = !queue.paused;
  resume.textContent = queue.paused === 'verification' ? 'Resume after verification' : 'Resume downloads';
  cancel.disabled = !queue.running && !queue.paused;
  if (panel.hidden) return;
  // --- Download manager panel ---
  const stats = queue.summary ?? {};
  const totalText = stats.total
    ? `${formatBytes(stats.received)} / ${formatBytes(stats.total)}`
    : formatBytes(stats.received);
  const speedText = stats.speed ? ` · ${formatBytes(stats.speed)}/s` : '';
  summary.textContent = pauseMessage
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
    button.addEventListener('click', () => command(action, entry.id));
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

toolbar.onFocusAddress(() => { address.focus(); address.select(); });
command('ready');
