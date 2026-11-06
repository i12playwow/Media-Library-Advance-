import { useLibraryCounts } from "./LibraryCounts";
import React, { memo } from "react";
import styles from './AppSidebar.module.css';
import type { AppPage, MovieRecord } from "../../../shared/contracts";

interface PageEntry {
  id: AppPage;
  label: string;
}

interface AppSidebarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onResizeStart: (e: React.MouseEvent) => void;
  pages: PageEntry[];
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
  movies: MovieRecord[];
  /** Full library total for the current filter — computed over the whole DB, not the loaded page. */
  totalMovies: number;
  gentleUnlocked?: boolean;
  normalCount: number;
  gentleCount: number;
  statusMessage: string;
}

export const AppSidebar = memo(function AppSidebar({
  collapsed,
  onToggleCollapse,
  width,
  onResizeStart,
  pages,
  activePage,
  onNavigate,
  movies,
  totalMovies,
  gentleUnlocked = false,
  normalCount,
  gentleCount,
  statusMessage,
}: AppSidebarProps) {
  const libraryTotals=useLibraryCounts(gentleUnlocked,movies.length);
  return (
    <>
      <aside
        className={`${collapsed ? "sidebar collapsed" : "sidebar"} ${styles.dynamicWidth}`}
        style={{ '--sidebarWidth': `${width}px` } as React.CSSProperties}

      >
        <button
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="sidebar-toggle"
          onClick={onToggleCollapse}
          type="button"
        >
          {collapsed ? "›" : "‹"}
        </button>
        <div className="sidebar-inner">
          <div>
            <p className="eyebrow">Electron Desktop</p>
            <h1>MLA+</h1>
            <p className="sidebar-copy">
              Local-first media management with Electron main process logic, React
              renderer pages, SQLite storage, and room for FFmpeg automation.
            </p>
          </div>

          <nav className="nav">
            {pages.map((page) => {
              const requiresLibrary = page.id === "library" || page.id === "search";
              const isDisabled = requiresLibrary && movies.length === 0;
              return (
                <button
                  key={page.id}
                  className={page.id === activePage ? "nav-link active" : "nav-link"}
                  onClick={() => { if (!isDisabled) onNavigate(page.id); }}
                  disabled={isDisabled}
                  title={isDisabled ? "Scan your library first to access this page" : undefined}
                  type="button"
                >
                  {page.label}
                </button>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            <p className="status-note">{statusMessage}</p>
            <div className="sidebar-showcase">
              <div className="sidebar-showcase-header">
                <span>Library totals</span>
                <span>{libraryTotals?.cataloged.toLocaleString() ?? "—"} cataloged</span>
              </div>
              <div className="sidebar-summary-grid">
                <div className="sidebar-summary-card">
                  <strong>{libraryTotals?.cataloged.toLocaleString() ?? "—"}</strong>
                  <span>Cataloged movies</span>
                </div>
                <div className="sidebar-summary-card">
                  <strong>{libraryTotals?.normal.toLocaleString() ?? "—"}</strong>
                  <span>Normal mode</span>
                </div>
                <div className="sidebar-summary-card">
                  <strong>{gentleUnlocked ? libraryTotals?.gentle?.toLocaleString() ?? "—" : "Locked"}</strong>
                  <span>Gentle mode</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div
        className={`sidebar-resize-handle${collapsed ? " hidden" : ""}`}
        onMouseDown={onResizeStart}
        title="Drag to resize sidebar"
      />
    </>
  );
});
