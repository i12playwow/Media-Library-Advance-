'use strict';
const path = require('node:path');
const crypto = require('node:crypto');
function generatedFilePath(directory, stem, suffix, resolveLongPath = true) {
  const original = path.join(directory, stem + suffix);
  if (!resolveLongPath || original.length <= 240) return original;
  const available = 240 - directory.length - 1 - suffix.length;
  if (available < 12) throw new Error('Folder path is too long for a new file. Choose a shorter output folder; original files were not renamed.');
  const hash = crypto.createHash('sha256').update(stem).digest('hex').slice(0, 8);
  return path.join(directory, stem.slice(0, available - 9).replace(/[ .]+$/, '') + '-' + hash + suffix);
}
module.exports = { generatedFilePath };
