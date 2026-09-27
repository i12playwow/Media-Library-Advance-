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
        onClick={(e) => e.stopPropagation()}
        style={{ left: x, top: y }}
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
            Move to {movie.libraryMode === "normal" ? "Gentle Mode" : "Normal Mode"}
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
      </ul>
    </div>
  );
}
