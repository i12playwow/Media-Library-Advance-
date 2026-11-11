'use strict';
const toolbar = window.browserToolbar;
const address = document.getElementById('address');
const status = document.getElementById('status');
const reload = document.getElementById('reload');
const back = document.getElementById('back');
const forward = document.getElementById('forward');
const downloads = document.getElementById('downloads');
const panel = document.getElementById('download-panel');
const links = document.getElementById('download-links');
const start = document.getElementById('start-downloads');
const resume = document.getElementById('resume-downloads');
const cancel = document.getElementById('cancel-downloads');
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

function updateSelection() {
  addLinks.disabled = !choices.querySelector('input:checked');
  selectLinks.textContent = choices.querySelector('input:not(:checked)') ? 'Select all' : 'Clear selection';
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
start.addEventListener('click', () => command('startDownloads', links.value));
resume.addEventListener('click', () => command('resumeDownloads'));
cancel.addEventListener('click', () => command('cancelDownloads'));

toolbar.onState(state => {
  if (lastAddress !== state.address) {
    address.value = state.address;
    pickerRevision++;
    picker.hidden = true;
    pickerStatus.textContent = '';
    choices.replaceChildren();
  }
  lastAddress = state.address;
  back.disabled = !state.back;
  forward.disabled = !state.forward;
  reload.disabled = !state.address;
  reload.textContent = state.loading ? '×' : '↻';
  reload.title = state.loading ? 'Stop loading' : 'Reload';
  reload.setAttribute('aria-label', reload.title);
  const queue = state.downloads;
  const pauseMessage = queue.paused === 'verification'
    ? 'Waiting for website verification. Downloads resume when the site confirms it.'
    : queue.paused === 'rate-limit' ? 'The website asked for fewer requests. Downloads are paused.' : '';
  status.textContent = state.notice || (state.loading ? 'Loading…' : pauseMessage);
  panel.hidden = !state.showingDownloads;
  document.querySelector('main').hidden = state.showingDownloads;
  downloads.setAttribute('aria-expanded', String(state.showingDownloads));
  start.disabled = queue.running || queue.paused;
  resume.hidden = !queue.paused;
  resume.textContent = queue.paused === 'verification' ? 'Resume after verification' : 'Resume downloads';
  cancel.disabled = !queue.running && !queue.paused;
  if (panel.hidden) return;
  const completed = queue.entries.filter(entry => entry.status === 'completed').length;
  summary.textContent = pauseMessage || (queue.folder ? `${completed} of ${queue.entries.length} saved to ${queue.folder}` : '');
  list.replaceChildren(...queue.entries.map(entry => {
    const row = document.createElement('li');
    const amount = entry.total ? ` ${Math.min(100, Math.floor(entry.received / entry.total * 100))}%` : '';
    row.textContent = `${entry.name || entry.url} · ${entry.status}${entry.status === 'downloading' ? amount : ''}${entry.error ? ` · ${entry.error}` : ''}`;
    return row;
  }));
});

toolbar.onFocusAddress(() => { address.focus(); address.select(); });
command('ready');
