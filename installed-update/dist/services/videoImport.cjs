'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
function run(binary, args, { timeout = 60000, cancelToken } = {}) {
  return new Promise((resolve, reject) => {
    if (cancelToken?.cancelled) return reject(new Error('Scan cancelled'));
    const child = spawn(binary, args, { windowsHide: true, stdio: ['ignore','ignore','pipe'] });
    let stderr = '', ended = false, failure;
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-8000); });
    const timer = setTimeout(() => { failure = 'Video processing timed out'; child.kill(); }, timeout);
    const poll = setInterval(() => { if (cancelToken?.cancelled) { failure = 'Scan cancelled'; child.kill(); } }, 100);
    const done = error => { if (ended) return; ended = true; clearTimeout(timer); clearInterval(poll); error ? reject(error) : resolve(); };
    child.once('error', done);
    child.once('close', code => done(code === 0 && !failure ? null : new Error(failure || stderr || 'Video processing failed')));
  });
}
async function validateCompleteVideo(file, { cancelToken, stabilityMs = 1000, allowTemporary = false } = {}) {
  try {
    if (!allowTemporary && /\.(?:part|partial|tmp|crdownload|download|!qb)(?:\.|$)|\.mla-converting-/i.test(file)) throw Error('Temporary or incomplete download filename');
    for (const marker of [file+'.aria2',file+'.part',file+'.crdownload',file+'.!qB']) {
      try { await fs.access(marker); throw Error('Download completion marker is still present'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const before = await fs.stat(file);
    if (!before.isFile() || before.size === 0) throw Error('Video file is empty');
    await new Promise(resolve => setTimeout(resolve, stabilityMs));
    const after = await fs.stat(file);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw Error('File is still downloading or changing');
    const media = require('./ffmpegService');
    const probe = await media.probeVideoFile(file);
    if (!probe.valid) throw Error(probe.reason || 'Unreadable video');
    const binary = media.resolveFfmpegPaths().ffmpeg;
    for (const seek of [0, Math.max(0, probe.durationSeconds - 3)]) {
      await run(binary, ['-v','error','-xerror','-ss',String(seek),'-i',file,'-t','3','-map','0:v:0','-map','0:a?','-f','null','-'], { cancelToken });
    }
    const last = await fs.stat(file);
    if (last.size !== after.size || last.mtimeMs !== after.mtimeMs) throw Error('Video changed during validation');
    return { ok: true, durationSeconds: probe.durationSeconds };
  } catch (error) { return { ok: false, status: 'incomplete', reason: error.message }; }
}
async function convertVideoToMp4(source, target, { cancelToken } = {}) {
  const check = await validateCompleteVideo(source, { cancelToken });
  if (!check.ok) throw Error(check.reason);
  const media = require('./ffmpegService');
  const temporary = path.join(path.dirname(target), '.mla-converting-'+randomUUID()+'.mp4');
  const binary = media.resolveFfmpegPaths().ffmpeg;
  try {
    try {
      await run(binary, ['-v','error','-xerror','-n','-i',source,'-map','0:v:0','-map','0:a?','-c','copy','-movflags','+faststart',temporary], { timeout: 3600000, cancelToken });
    } catch (error) {
      await fs.unlink(temporary).catch(()=>{});
      if (cancelToken?.cancelled) throw error;
      await run(binary, ['-v','error','-xerror','-n','-i',source,'-map','0:v:0','-map','0:a?','-c:v','libx264','-preset','fast','-crf','20','-c:a','aac','-movflags','+faststart',temporary], { timeout: 3600000, cancelToken });
    }
    const output = await validateCompleteVideo(temporary, { cancelToken, stabilityMs: 0, allowTemporary: true });
    // Probe the finished output separately: temporary outputs are intentionally excluded from imports.
    const probe = await media.probeVideoFile(temporary);
    if (!output.ok || !probe.valid || probe.durationSeconds < check.durationSeconds - Math.max(1,check.durationSeconds*0.005)) throw Error('Converted MP4 failed verification');
    const { constants } = require('node:fs');
    try { await fs.link(temporary, target); } catch (error) {
      if (!["ENOTSUP","EPERM","EOPNOTSUPP"].includes(error.code)) throw error;
      await fs.copyFile(temporary, target, constants.COPYFILE_EXCL).catch(async error => { if (error.code !== "EEXIST") await fs.unlink(target).catch(()=>{}); throw error; });
    }
    return target;
  } finally { await fs.unlink(temporary).catch(()=>{}); }
}
module.exports = { validateCompleteVideo, convertVideoToMp4 };
