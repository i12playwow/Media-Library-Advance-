'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const serviceSource = path.join(root, 'app', 'services');
const serviceTarget = path.join(root, 'dist', 'services');
fs.mkdirSync(serviceTarget, { recursive: true });
let copied = 0;
for (const entry of fs.readdirSync(serviceSource, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.cjs')) {
    fs.copyFileSync(path.join(serviceSource, entry.name), path.join(serviceTarget, entry.name));
    copied++;
  }
}
for (const folder of ['device-share', 'subtitle-workspace', 'panel-layout', 'browse-memory', 'browse-toolbar', 'in-app-browser']) {
  fs.cpSync(path.join(root, 'app', 'renderer', folder), path.join(root, 'dist', 'renderer', folder), { recursive: true });
}
console.log(`Copied ${copied} runtime services and renderer support assets.`);
