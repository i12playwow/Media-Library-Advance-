'use strict';
// Filename-based identification only; never opens, renames or deletes a video.
const EXCLUDED = new Set(['VIDEO','MOVIE','SAMPLE','TRAILER','PREVIEW','CLIP','FULL','HD','HEVC','H264','H265','X264','X265','AVC','AAC','DTS','DDP','HDR','WEB','BLURAY','REMUX','AMZN','DISC','PART']);
function hasJavCode(value) {
  const text = value.toUpperCase().replace(/[._]+/g, ' ');
  if (/\bFC2[ -]*(?:PPV[ -]*)?\d{5,8}\b/.test(text)) return true;
  if (/(?:^|[^A-Z0-9])\d{6}[- ]\d{2,4}(?:$|[^A-Z0-9])/.test(text)) return true;
  for (const match of text.matchAll(/(?:^|[^A-Z0-9])([A-Z]{2,6})[- ]?(\d{3,7})(?=$|[^A-Z0-9])/g)) {
    if (!EXCLUDED.has(match[1])) return true;
  }
  return false;
}
function isJavMoviePath(file) {
  const segments = String(file).split(/[\\/]/);
  const filename = (segments.pop() || '').replace(/\.[^.]+$/, '');
  // A code on the immediate movie folder can identify an otherwise opaque filename.
  return hasJavCode(filename) || hasJavCode(segments.pop() || '');
}
module.exports = { isJavMoviePath, hasJavCode };
