import React from 'react';
type Counts = { cataloged: number; available: number | null; missing: number | null; normal: number; gentle: number | null; scope: 'all' | 'normal' };
export function useLibraryCounts(gentleUnlocked: boolean, revision: unknown) {
  const [data, setData] = React.useState<Counts | null>(null);
  React.useEffect(() => {
    let active = true;
    setData(null);
    const update = () => { const api=window.desktopApi; if(api?.librarySummary) void api.librarySummary().then(value=>{if(active)setData(value)}).catch(()=>{}); };
    update(); const timer=window.setInterval(update,15000);
    return () => { active=false; window.clearInterval(timer); };
  },[gentleUnlocked,revision]);
  return data && ((data.scope === 'all') === gentleUnlocked) ? data : null;
}
export function LibraryCounts({ gentleUnlocked, loaded, shown, matched, grouped }: { gentleUnlocked: boolean; loaded: number; shown: number; matched: number; grouped: boolean }) {
  const counts=useLibraryCounts(gentleUnlocked,loaded+':'+matched);
  const values: Array<[string,string,number|null|undefined]> = [['cataloged','Cataloged movies',counts?.cataloged],['available','Available movies',counts?.available],['missing','Missing video files',counts?.missing],['normal','Normal mode',counts?.normal],['gentle','Gentle mode',counts?.gentle]];
  return <section className="library-counts" aria-label="Library counts"><div className="library-counts-heading"><h4>Library totals</h4><span>{gentleUnlocked?'Normal and unlocked Gentle libraries':'Normal library · Gentle mode is locked'}</span></div><div className="library-counts-grid">{values.map(([key,label,value])=><div className="library-count" key={key}><strong data-count-key={key}>{key==='gentle'&&!gentleUnlocked?'Locked':value===null||value===undefined?'—':value.toLocaleString()}</strong><span>{label}</span></div>)}</div><p className="library-counts-display" aria-live="polite">{shown.toLocaleString()} poster cards shown · {loaded.toLocaleString()} videos loaded · {matched.toLocaleString()} movies match the current search.</p><p className="library-counts-note">Cataloged totals include missing-file entries. Availability reflects the last file check.{grouped?' Duplicate copies of a movie may share one poster card.':''}</p></section>;
}
