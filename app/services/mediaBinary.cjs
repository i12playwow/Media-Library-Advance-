'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const cache=new Map();
function resolveWorkingBinary(candidates, command){
  if(cache.has(command))return cache.get(command);
  const extra=[];
  const packages=path.join(process.env.LOCALAPPDATA||'', 'Microsoft','WinGet','Packages');
  try{for(const entry of fs.readdirSync(packages)){if(!/^Gyan\.FFmpeg_/i.test(entry))continue;const base=path.join(packages,entry);for(const version of fs.readdirSync(base))extra.push(path.join(base,version,'bin',command+'.exe'));}}catch{}
  for(let candidate of [...candidates,...extra,command]){
    if(!candidate)continue;
    if(candidate.includes('app.asar')&&!candidate.includes('app.asar.unpacked'))candidate=candidate.replace('app.asar','app.asar.unpacked');
    try{const result=spawnSync(candidate,['-version'],{windowsHide:true,timeout:5000,stdio:'ignore'});if(result.status===0&&!result.error){cache.set(command,candidate);return candidate;}}catch{}
  }
  throw Error('No working '+command+' executable found. Install FFmpeg and try again.');
}
module.exports={resolveWorkingBinary};
