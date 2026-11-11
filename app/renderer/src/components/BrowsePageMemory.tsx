import React, { useRef } from 'react';
export function BrowsePageMemory({active, children}: {active: boolean; children: React.ReactNode}) {
  const visited = useRef(false);
  if (active) visited.current = true;
  return visited.current ? <div className="browse-page-memory" style={{display: active ? 'contents' : 'none'}} aria-hidden={!active}>{children}</div> : null;
}
