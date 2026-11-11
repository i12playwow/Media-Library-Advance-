import React from 'react';
import { useLibraryCounts } from './LibraryCounts';
export function LibraryModeSwitch({gentleUnlocked}: {gentleUnlocked:boolean}) {
 const api=window.desktopApi;
 const read=()=>api?.getLibraryViewMode?.()==='gentle'&&gentleUnlocked?'gentle':'normal';
 const [mode,setMode]=React.useState(read);
 const totals=useLibraryCounts(gentleUnlocked,mode);
 React.useEffect(()=>{const update=()=>setMode(read());window.addEventListener('mla-library-mode',update);update();return()=>window.removeEventListener('mla-library-mode',update);},[gentleUnlocked,api]);
 const change=(next:'normal'|'gentle')=>{if(next===mode||next==='gentle'&&!gentleUnlocked)return;api?.setLibraryViewMode?.(next);setMode(next);window.dispatchEvent(new CustomEvent('mla-library-mode',{detail:next}));const content=document.querySelector('main.content');if(content)content.scrollTop=0;};
 return <div className="library-mode-switch" role="group" aria-label="Library switch"><button type="button" aria-label="Normal library" aria-pressed={mode==='normal'} onClick={()=>change('normal')}><span className="mode-icon mode-icon-normal" aria-hidden="true"/>Normal <small>{totals?.byMode?.normal.available?.toLocaleString()??'—'} movies</small></button><button type="button" aria-label={gentleUnlocked?'Gentle library':'Gentle library (locked)'} aria-pressed={mode==='gentle'} disabled={!gentleUnlocked} title={gentleUnlocked?'Browse Gentle videos':'Unlock Gentle mode first (Ctrl+Alt+D)'} onClick={()=>change('gentle')}><span className="mode-icon mode-icon-gentle" aria-hidden="true"/>Gentle <small>{gentleUnlocked?(totals?.byMode?.gentle?.available?.toLocaleString()??'—')+' movies':'Locked'}</small></button></div>;
}
