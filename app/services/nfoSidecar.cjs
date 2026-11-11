'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

const videoExtension = /\.(?:mp4|mkv|avi|mov|wmv|m4v|webm|ts|mts|m2ts|mpg|mpeg|flv)$/i;

async function readMatchingNfo(videoPath, readDirectory = dir => fs.readdir(dir, { withFileTypes: true })) {
  const folder = path.dirname(videoPath);
  const filename = path.basename(videoPath).toLowerCase();
  const stem = filename.slice(0, filename.length - path.extname(filename).length);
  const files = (await readDirectory(folder)).filter(entry => entry.isFile());
  if (!files.some(entry => entry.name.toLowerCase() === filename)) return '';
  const matches = [stem + '.nfo', filename + '.nfo'];
  if (files.filter(entry => videoExtension.test(entry.name)).length === 1) {
    matches.push('movie.nfo');
  }
  for (const name of matches) {
    const candidates = files.filter(entry => entry.name.toLowerCase() === name);
    if (candidates.length !== 1) continue;
    const handle = await fs.open(path.join(folder, candidates[0].name), 'r');
    try {
      const { size } = await handle.stat();
      if (size > 1024 * 1024) continue;
      const buffer = Buffer.alloc(size);
      const { bytesRead } = await handle.read(buffer, 0, size, 0);
      return buffer.subarray(0, bytesRead).toString('utf8');
    } finally { await handle.close(); }
  }
  return '';
}

module.exports = { readMatchingNfo };
