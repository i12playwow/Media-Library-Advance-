import React from 'react';
type Counts = { cataloged: number; available: number | null; missing: number | null; normal: number; gentle: number | null; byMode?: { normal:{available:number|null}; gentle:{available:number|null}|null }; scope: 'all' | 'normal' };
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
  return <section className="library-counts" aria-label="Library counts"><p className="library-counts-display" aria-live="polite">{matched.toLocaleString()} movies</p></section>;
}
