import type { MovieRecord } from "../../../shared/contracts";

interface ContextMenuState {
  movie: MovieRecord;
  x: number;
  y: number;
}

interface ContextMenuProps {
  contextMenu: ContextMenuState;
  isSelected: boolean;
  onClose: () => void;
  onOpenInPlayer: () => void;
  onOpenExternal: () => void;
  onShowInFolder: () => void;
  onRefreshPoster: () => void;
  onMove: () => void;
  onToggleSelect: () => void;
  onCopyPath: () => void;
  onRemoveLibrary?: () => void;
  onTrashFile?: () => void;
  onRenameFile?: () => void;
  onAutoRename?: () => void;
  onRenameAndMove?: () => void;
  onTrashSelection?: () => void;
  selectedCount?: number;
  onCopyVideoId?: () => void;
}

export function ContextMenu({
  contextMenu,
  isSelected,
  onClose,
  onOpenInPlayer,
  onOpenExternal,
  onShowInFolder,
  onRefreshPoster,
  onMove,
  onToggleSelect,
  onCopyPath,
  onRemoveLibrary,
  onTrashFile,
  onRenameFile,
  onAutoRename,
  onRenameAndMove,
  onTrashSelection,
  selectedCount,
  onCopyVideoId,
}: ContextMenuProps) {
  const { movie, x, y } = contextMenu;
  return (
    <div
      className="ctx-backdrop"
      onClick={onClose}
      onContextMenu={(e) => { e.preventDefault(); onClose(); }}
    >
      <ul
        className="ctx-menu"
        ref={(menu) => {
          if (!menu) return;
          menu.style.left = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8)) + "px";
          menu.style.top = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8)) + "px";
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <li className="ctx-header">
          <span className="ctx-eyebrow">Movie</span>
          <strong className="ctx-title">{movie.title}</strong>
          <span className="ctx-subtitle">
            {movie.videoId ?? "No DVD ID"} · {movie.libraryMode} · {movie.year ?? "Unknown year"}
          </span>
        </li>
        <li className="ctx-sep" />
        <li>
          <button className="ctx-item" onClick={onOpenInPlayer} type="button">
            Open in built-in player
          </button>
        </li>
        <li>
          <button className="ctx-item" onClick={onOpenExternal} type="button">
            Play with external app
          </button>
        </li>
        <li>
          <button className="ctx-item" onClick={onShowInFolder} type="button">
            Show in File Explorer
          </button>
        </li>
        <li className="ctx-sep" />
        <li>
          <button className="ctx-item" onClick={onRefreshPoster} type="button">
            Regenerate poster
          </button>
        </li>
        <li className="ctx-sep" />
        <li>
          <button className="ctx-item" onClick={onMove} type="button">
            Move to {movie.libraryMode === "normal" ? "Gentle Mode" : "Normal Mode"}…
          </button>
        </li>
        <li className="ctx-sep" />
        <li>
          <button className="ctx-item" onClick={onToggleSelect} type="button">
            {isSelected ? "Deselect" : "Select"}
          </button>
        </li>
        <li className="ctx-sep" />
        <li>
          <button className="ctx-item" onClick={onCopyPath} type="button">
            Copy file path
          </button>
        </li>
        {movie.videoId && onCopyVideoId && (
          <li>
            <button className="ctx-item" onClick={onCopyVideoId} type="button">
              Copy DVD ID
            </button>
          </li>
        )}
        {onAutoRename && <li><button className="ctx-item" type="button" onClick={onAutoRename}>Auto-rename from JAVDatabase…</button></li>}
        {onRenameFile && <li><button className="ctx-item" type="button" onClick={onRenameFile}>Rename video file…</button></li>}
        {onRenameAndMove && <li><button className="ctx-item" type="button" onClick={onRenameAndMove}>Rename and move video…</button></li>}
        {onRemoveLibrary && <li><button className="ctx-item" type="button" onClick={onRemoveLibrary}>Remove from library…</button></li>}
        {onTrashFile && <li><button className="ctx-item" type="button" onClick={onTrashFile}>Delete video file…</button></li>}
        {onTrashSelection && <li><button className="ctx-item" type="button" onClick={onTrashSelection}>Delete {selectedCount} selected video files…</button></li>}
      </ul>
    </div>
  );
}
