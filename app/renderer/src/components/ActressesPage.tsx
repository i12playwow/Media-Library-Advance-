import React, { useEffect, useMemo, useState } from "react";
import type { ActressMetadataRescanSummary, AppPage, LibraryMode, MovieRecord } from "../../../shared/contracts";
import { MovieTile } from "./MovieTile";

interface ActressEntry {
  name: string;
  count: number;
  posterUrl: string | null;
  movieIds: string[];
  modes: LibraryMode[];
  studio: string;
  tag: string;
  region: string;
}

interface ActressesPageProps {
  onRescanMetadata?: () => Promise<ActressMetadataRescanSummary>;
  onAssignMovies?: (name: string, ids: string[]) => Promise<void>;
  onPlayMovie?: (movie: MovieRecord) => void;
  actressDirectory: ActressEntry[];
  selectedActress: string | null;
  setSelectedActress: (name: string | null) => void;
  actressGridCols: number;
  changeActressGridCols: (cols: number) => void;
  actressModeFilter: "all" | LibraryMode;
  setActressModeFilter: (mode: "all" | LibraryMode) => void;
  gentleUnlocked: boolean;
  actressSortMode: "count" | "studio" | "tag";
  setActressSortMode: (mode: "count" | "studio" | "tag") => void;
  isRefreshingActressPhotos: boolean;
  setIsRefreshingActressPhotos: (v: boolean) => void;
  actressPhotos: Record<string, string>;
  setActressPhotos: (photos: Record<string, string>) => void;
  allMoviesPool: MovieRecord[];
  movies: MovieRecord[];
  selectedMovieId: string | null;
  setSelectedMovieId: (id: string) => void;
  setActivePage: (page: AppPage) => void;
  setContextMenu: (menu: { movie: MovieRecord; x: number; y: number } | null) => void;
  setActressContextMenu: (menu: { name: string; x: number; y: number } | null) => void;
  selectedActressPhotos: string[];
  selectedActressRegion: string;
  setSelectedActressRegion: (value: string) => void;
  onAddActressPhoto: (name: string) => Promise<void>;
  onRemoveActressPhoto: (name: string, photoUrl?: string) => Promise<void>;
  onSetPrimaryActressPhoto: (name: string, photoUrl: string) => Promise<void>;
  onSaveActressRegion: (name: string, region: string) => Promise<void>;
  onRefreshActressPhotos: () => Promise<void>;
}

const ACTRESS_REGIONS = ['Japan','Chinese','America','Spain','Korea','France','Germany','Italy','Unknown'];

export function ActressesPage({ actressDirectory, selectedActress, setSelectedActress, actressGridCols, changeActressGridCols, actressModeFilter, setActressModeFilter, gentleUnlocked, actressSortMode, setActressSortMode, isRefreshingActressPhotos, allMoviesPool, movies, selectedMovieId, setSelectedMovieId, setActivePage, setContextMenu, setActressContextMenu, selectedActressPhotos, selectedActressRegion, setSelectedActressRegion, onAddActressPhoto, onRemoveActressPhoto, onSetPrimaryActressPhoto, onSaveActressRegion, onRefreshActressPhotos, onAssignMovies, onPlayMovie, onRescanMetadata }: ActressesPageProps) {
  const [rescanning, setRescanning] = useState(false);
  const [rescanNotice, setRescanNotice] = useState("");
  async function rescanMetadata() {
    if (!onRescanMetadata || rescanning) return;
    setRescanning(true);
    setRescanNotice("");
    try {
      const result = await onRescanMetadata();
      setRescanNotice("Checked " + result.checked + " movies · Updated " + result.updated + " · Still unknown " + result.unknown + (result.unreadable ? " · Unreadable " + result.unreadable : ""));
    } catch (error) {
      setRescanNotice(error instanceof Error ? error.message : "Could not rescan actress metadata.");
    } finally { setRescanning(false); }
  }
  const rescanButton = onRescanMetadata && <button className="ghost-button" type="button" disabled={rescanning} onClick={() => void rescanMetadata()}>{rescanning ? "Checking metadata…" : "Rescan actress metadata"}</button>;
  const [query, setQuery] = useState('');
  const [region, setRegion] = useState('all');
  const [order, setOrder] = useState('count');
  const [browserLimit, setBrowserLimit] = useState(80);
  const [movieQuery, setMovieQuery] = useState('');
  const [movieLimit, setMovieLimit] = useState(60);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkName, setLinkName] = useState('');
  const [linkQuery, setLinkQuery] = useState('');
  const [linkIds, setLinkIds] = useState<Set<string>>(new Set());
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState('');
  useEffect(() => { setMovieQuery(''); setMovieLimit(60); }, [selectedActress]);
  const visiblePool = useMemo(() => (allMoviesPool.length ? allMoviesPool : movies).filter(movie => (gentleUnlocked || movie.libraryMode !== 'gentle') && (actressModeFilter === 'all' || movie.libraryMode === actressModeFilter)), [allMoviesPool, movies, gentleUnlocked, actressModeFilter]);
  const active = selectedActress ? actressDirectory.find(entry => entry.name === selectedActress) : undefined;
  const regions = useMemo(() => [...new Set(actressDirectory.map(entry => entry.region || 'Unknown'))].sort(), [actressDirectory]);
  const directory = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const result = actressDirectory.filter(entry => (!needle || [entry.name,entry.studio,entry.tag].some(value => value.toLocaleLowerCase().includes(needle))) && (region === 'all' || entry.region === region));
    if (order === 'name') result.sort((a,b) => a.name.localeCompare(b.name));
    if (order === 'count') result.sort((a,b) => b.count-a.count || a.name.localeCompare(b.name));
    return result;
  }, [actressDirectory, query, region, order]);
  const actressMovies = useMemo(() => {
    const ids = new Set(active?.movieIds || []), needle = movieQuery.trim().toLocaleLowerCase();
    return visiblePool.filter(movie => ids.has(movie.id) && (!needle || [movie.title,movie.videoId || ''].some(value => value.toLocaleLowerCase().includes(needle))));
  }, [active, visiblePool, movieQuery]);
  const linkMovies = useMemo(() => {
    const needle = linkQuery.trim().toLocaleLowerCase();
    return visiblePool.filter(movie => !needle || [movie.title,movie.videoId || '',movie.sourcePath].some(value => value.toLocaleLowerCase().includes(needle)));
  }, [visiblePool, linkQuery]);
  const linked = (movie: MovieRecord) => movie.actresses.some(name => name.toLocaleLowerCase() === linkName.trim().toLocaleLowerCase());
  function openLinker(name: string) { setLinkName(name); setLinkQuery(''); setLinkIds(new Set()); setLinkError(''); setLinkOpen(true); }
  function play(movie: MovieRecord) { if (onPlayMovie) onPlayMovie(movie); else { setSelectedMovieId(movie.id); setActivePage('library'); } }
  async function saveLinks() {
    if (!onAssignMovies) { setLinkError('Movie linking is unavailable. Reopen the updated app.'); return; }
    setLinkBusy(true); setLinkError('');
    try {
      const canonical = actressDirectory.find(entry => entry.name.toLocaleLowerCase() === linkName.trim().toLocaleLowerCase())?.name || linkName.trim();
      await onAssignMovies(canonical, [...linkIds]);
      setLinkOpen(false);
    } catch (error) { setLinkError(error instanceof Error ? error.message : 'Could not link these movies.'); }
    finally { setLinkBusy(false); }
  }
  const linker = linkOpen && <div className="modal-backdrop actress-link-backdrop" onClick={event => { if (event.target === event.currentTarget && !linkBusy) setLinkOpen(false); }}>
    <section className="modal-card actress-link-dialog" role="dialog" aria-modal="true" aria-labelledby="actress-link-title" onKeyDown={event => {
      if (event.key === 'Escape' && !linkBusy) setLinkOpen(false);
      if (event.key === 'Tab') {
        const items = event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled])');
        const first=items[0],last=items[items.length-1];
        if (event.shiftKey && document.activeElement===first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement===last) { event.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="panel-header"><div><h3 id="actress-link-title">Link movies to actress</h3><p className="subtle">Choose a name and library movies. Existing cast names and files stay unchanged.</p></div><button className="ghost-button" type="button" disabled={linkBusy} onClick={() => setLinkOpen(false)}>Cancel linking</button></div>
      <label className="form-field"><span>Actress name</span><input className="search-input" autoFocus maxLength={120} list="actress-known-names" value={linkName} disabled={linkBusy} onChange={event => setLinkName(event.target.value)} /><datalist id="actress-known-names">{actressDirectory.map(entry => <option key={entry.name} value={entry.name} />)}</datalist></label>
      <label className="form-field"><span>Find library movies</span><input className="search-input" value={linkQuery} disabled={linkBusy} placeholder="Search a title, movie code, or filename" onChange={event => setLinkQuery(event.target.value)} /></label>
      <div className="inline-actions actress-link-selection"><span aria-live="polite">{linkIds.size} selected · {linkMovies.length} matching movies</span><button className="ghost-button" type="button" disabled={linkBusy} onClick={() => setLinkIds(current => new Set([...current,...linkMovies.slice(0,60).filter(movie => !linked(movie)).map(movie => movie.id)]))}>Select shown movies</button><button className="ghost-button" type="button" disabled={linkBusy || !linkIds.size} onClick={() => setLinkIds(new Set())}>Clear selection</button></div>
      <div className="actress-link-list">{linkMovies.slice(0,60).map(movie => <label className="actress-link-row" key={movie.id}><input type="checkbox" checked={linked(movie)||linkIds.has(movie.id)} disabled={linkBusy||linked(movie)} onChange={() => setLinkIds(current => { const next=new Set(current); next.has(movie.id)?next.delete(movie.id):next.add(movie.id); return next; })} /><span><strong>{movie.title}</strong><small>{movie.videoId || 'No movie code'} · {movie.libraryMode}{linked(movie) ? ' · Already linked' : ''}</small><small className="actress-link-path">{movie.sourcePath}</small></span></label>)}{!linkMovies.length && <p className="subtle">No matching movies. Change the search or scan your library first.</p>}</div>
      {linkMovies.length>60 && <p className="subtle">Showing the first 60 matches. Narrow the search to find more movies.</p>}
      {linkError && <p role="alert" className="actress-flow-error">{linkError}</p>}
      <button className="primary-button" type="button" disabled={linkBusy||!linkName.trim()||!linkIds.size} onClick={() => void saveLinks()}>{linkBusy?'Saving links…':'Save actress and movies'}</button>
    </section>
  </div>;
  return <section className="page actresses-page actress-flow">
    {rescanNotice && <p className="subtle" role="status">{rescanNotice}</p>}
    {active ? <div className="panel actresses-detail-panel">
      <div className="panel-header"><div className="actress-detail-hero"><button className="ghost-button" type="button" onClick={() => setSelectedActress(null)}>← All actresses</button><div className="actress-avatar">{active.posterUrl?<img className="actress-avatar-img" src={active.posterUrl} alt={active.name}/>:<div className="actress-avatar-fallback actress-avatar-fallback-detail">{active.name.slice(0,2).toUpperCase()}</div>}</div><div className="actress-detail-copy"><h3>{active.name}</h3><p className="subtle">{active.count} {active.count === 1 ? "movie" : "movies"} · {active.region} · {active.studio}</p><div className="actress-detail-chips">{active.name === "Unknown" && <span>No actress name in metadata</span>}{active.modes.map(mode=><span key={mode}>{mode}</span>)}</div></div></div><div className="inline-actions">{active.name === "Unknown" && rescanButton}<button className="primary-button" type="button" onClick={() => openLinker(active.name === "Unknown" ? "" : active.name)}>{active.name === "Unknown" ? "Link movies to an actress" : "Link more movies"}</button>{active.name !== "Unknown" && <button className="secondary-button" type="button" onClick={() => void onAddActressPhoto(active.name)}>Add photo</button>}</div></div>
      <div className="actress-profile-tools"><label className="form-field"><span>Region</span><input className="search-input" list="actress-region-options" value={selectedActressRegion} onChange={event=>setSelectedActressRegion(event.target.value)}/><datalist id="actress-region-options">{ACTRESS_REGIONS.map(value=><option key={value} value={value}/>)}</datalist></label><button className="ghost-button" type="button" onClick={()=>void onSaveActressRegion(active.name,selectedActressRegion)}>Save region</button><button className="ghost-button" type="button" disabled={!selectedActressPhotos.length} onClick={()=>void onRemoveActressPhoto(active.name)}>Remove profile photos</button></div>
      {selectedActressPhotos.length>0&&<div className="actress-gallery">{selectedActressPhotos.map((photo,index)=><div className="actress-gallery-card" key={photo}><button className={`actress-gallery-item${index===0?' primary':''}`} type="button" aria-label={`${index===0?'Primary photo of':'Set primary photo of'} ${active.name} ${index+1}`} onClick={()=>void onSetPrimaryActressPhoto(active.name,photo)}><img src={photo} alt={`${active.name} ${index+1}`} loading="lazy"/></button><button className="ghost-button" type="button" onClick={()=>void onRemoveActressPhoto(active.name,photo)}>Remove photo {index+1}</button></div>)}</div>}
      <div className="actress-profile-movies-header"><h4>Movies in your library</h4><label className="form-field"><span>Find movies in this profile</span><input className="search-input" value={movieQuery} placeholder="Title or movie code" onChange={event=>{setMovieQuery(event.target.value);setMovieLimit(60);}}/></label></div>
      <div className="movie-grid actress-title-grid" style={{'--cols':4} as React.CSSProperties}>{actressMovies.slice(0,movieLimit).map(movie=><MovieTile key={movie.id} movie={movie} isActive={movie.id===selectedMovieId} separator="dot" onContextMenu={event=>{event.preventDefault();setContextMenu({movie,x:event.clientX,y:event.clientY});}} onClick={()=>play(movie)} onPlay={()=>play(movie)}/>)}</div>
      {!actressMovies.length&&<p className="subtle">No matching movies. Clear the movie search or link more library movies.</p>}{actressMovies.length>movieLimit&&<button className="ghost-button" type="button" onClick={()=>setMovieLimit(current=>current+60)}>Show more movies</button>}
    </div> : <div className="panel actresses-overview-panel">
      <div className="panel-header"><div><h3>Actresses</h3><p className="subtle">{actressDirectory.length} profiles from {visiblePool.length} accessible library movies</p></div><div className="inline-actions">{rescanButton}<button className="primary-button" type="button" onClick={()=>openLinker('')}>Add actress to movies</button><button className="ghost-button" type="button" disabled={isRefreshingActressPhotos} onClick={()=>void onRefreshActressPhotos()}>{isRefreshingActressPhotos?'Fetching photos…':'Refresh photos'}</button></div></div>
      <div className="actress-flow-toolbar"><label className="form-field"><span>Find actress</span><input className="search-input" value={query} placeholder="Name, studio, or tag" onChange={event=>{setQuery(event.target.value);setBrowserLimit(80);}}/></label><label className="form-field"><span>Region filter</span><select className="filter-select" value={region} onChange={event=>{setRegion(event.target.value);setBrowserLimit(80);}}><option value="all">All regions</option>{regions.map(value=><option key={value} value={value}>{value}</option>)}</select></label><label className="form-field"><span>Browse order</span><select className="filter-select" value={order} onChange={event=>{setOrder(event.target.value);if(event.target.value!=="name")setActressSortMode(event.target.value as "count"|"studio"|"tag");}}><option value="count">Most movies</option><option value="name">Name A–Z</option><option value="studio">Studio</option><option value="tag">Tag</option></select></label></div>
      <div className="actress-mode-tabs">{(['all','normal',...(gentleUnlocked?['gentle']:[])] as const).map(mode=><button className={`actress-mode-tab${actressModeFilter===mode?' active':''}`} type="button" key={mode} onClick={()=>{setActressModeFilter(mode as 'all'|LibraryMode);setBrowserLimit(80);}}>{mode==='all'?'All accessible movies':mode==='normal'?'Normal':'Gentle'}</button>)}<div className="actress-zoom-bar"><button className="actress-zoom-btn" type="button" aria-label="Larger actress cards" disabled={actressGridCols<=2} onClick={()=>changeActressGridCols(actressGridCols-1)}>+</button><button className="actress-zoom-btn" type="button" aria-label="Smaller actress cards" disabled={actressGridCols>=9} onClick={()=>changeActressGridCols(actressGridCols+1)}>−</button></div></div>
      <p className="subtle" aria-live="polite">{directory.length} matching profiles</p><div className="actress-grid" style={{'--actress-cols':actressGridCols} as React.CSSProperties}>{directory.slice(0,browserLimit).map(entry=><button className="actress-card" type="button" key={entry.name} onClick={()=>setSelectedActress(entry.name)} onContextMenu={event=>{event.preventDefault();setActressContextMenu({name:entry.name,x:event.clientX,y:event.clientY});}} aria-label={`Open actress ${entry.name}`}><div className="actress-photo"><div className="actress-avatar">{entry.posterUrl?<img className="actress-avatar-img" src={entry.posterUrl} alt={entry.name} loading="lazy" decoding="async"/>:<div className="actress-avatar-fallback">{entry.name.split(' ').map(word=>word[0]).slice(0,2).join('').toUpperCase()}</div>}</div><div className="actress-overlay"><strong className="actress-name">{entry.name}</strong><span className="actress-count">{entry.count} library titles</span><span className="actress-count actress-meta-line">{entry.name === "Unknown" ? "No actress name in metadata" : entry.region}</span></div></div></button>)}</div>
      {!directory.length&&<div className="actress-flow-empty"><h4>{query||region!=='all'?'No matching actresses':'Start an actress profile'}</h4><p className="subtle">{query||region!=='all'?'Change the name or region filter to find a profile.':'Use Add actress to movies to connect a name to videos already in your library.'}</p>{(query||region!=='all')&&<button className="ghost-button" type="button" onClick={()=>{setQuery('');setRegion('all');}}>Clear actress filters</button>}</div>}{directory.length>browserLimit&&<button className="ghost-button" type="button" onClick={()=>setBrowserLimit(current=>current+80)}>Show more actresses</button>}
    </div>}
    {linker}
  </section>;
}
