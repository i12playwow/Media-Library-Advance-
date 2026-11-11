const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const {sweepMissingMoviesAsync:sweep}=require('../app/services/libraryMaintenance.cjs');
function fixture(){const rows=[{id:'a',source_path:'a.mp4',updated_at:'1',source_missing:0},{id:'b',source_path:'b.mp4',updated_at:'1',source_missing:0}];const d={constructor:{FILE_EXISTS_CACHE_MAX_ENTRIES:50000,MISSING_SWEEP_LAST_KEY:'last'},fileExistsCache:new Map(),setSetting(){},recordSweepSample(){},ensureFtsIndexIntegrity(){},getSubtitles(){return []},hydrateMovie:r=>r,clearFileExistsCache(){this.fileExistsCache.clear()}};d.db={prepare(sql){return{all:()=>rows.map(r=>({...r})),get:id=>rows.find(r=>r.id===id),run:(missing,id,p,at)=>{const r=rows.find(r=>r.id===id&&r.source_path===p&&r.updated_at===at);if(r){r.source_missing=missing;return{changes:1}}return{changes:0}}}},transaction:fn=>fn};return{d,rows};}
test('maintenance yields, shares overlapping sweeps, and updates missing flags',async()=>{const {d,rows}=fixture();const original=fs.access;let checks=0;fs.access=async p=>{checks++;await new Promise(r=>setTimeout(r,10));if(p==='b.mp4')throw Object.assign(Error(),{code:'ENOENT'})};try{const first=sweep(d);assert.equal(sweep(d),first);let responsive=false;setImmediate(()=>responsive=true);const missing=await first;assert.equal(responsive,true);assert.equal(checks,2);assert.equal(missing.length,1);assert.equal(rows[1].source_missing,1);assert.equal(d.fileExistsCache.get('a.mp4').exists,true);}finally{fs.access=original}});
test('relink while checking and inaccessible drives do not falsely mark movies missing',async()=>{const {d,rows}=fixture();const original=fs.access;fs.access=async p=>{await new Promise(r=>setTimeout(r,10));if(p==='a.mp4'){rows[0].source_path='new.mp4';throw Object.assign(Error(),{code:'ENOENT'})}throw Object.assign(Error(),{code:'EACCES'})};try{const missing=await sweep(d);assert.equal(missing.length,0);assert.equal(rows[0].source_missing,0);assert.equal(rows[1].source_missing,0);assert.equal(d.fileExistsCache.size,0);}finally{fs.access=original}});

test('a stalled drive does not hide missing files on healthy drives or queue more checks', { skip: process.platform !== 'win32' }, async () => {
  const { d, rows } = fixture();
  rows.length = 0;
  for (let i = 0; i < 4; i++) {
    rows.push({ id: 'usb-' + i, source_path: 'X:\\video-' + i + '.mp4', updated_at: '1', source_missing: 0 });
  }
  const healthy = { id: 'healthy', source_path: 'Y:\\missing.mp4', updated_at: '1', source_missing: 0 };
  rows.push(healthy);
  const original = fs.access;
  let stalledReads = 0;
  let release;
  const stalledRead = new Promise(resolve => { release = resolve; });
  fs.access = async file => {
    if (file.startsWith('X:')) {
      stalledReads++;
      return stalledRead;
    }
    throw Object.assign(new Error('Missing'), { code: 'ENOENT' });
  };
  try {
    const missing = await sweep(d, { timeoutMs: 25 });
    assert.deepEqual(missing.map(movie => movie.id), ['healthy']);
    assert.equal(healthy.source_missing, 1);
    assert.equal(rows[0].source_missing, 0);
    await sweep(d, { timeoutMs: 25 });
    assert.equal(stalledReads, 1);
  } finally {
    release();
    fs.access = original;
  }
});
