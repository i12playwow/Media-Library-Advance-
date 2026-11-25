interface ActressContextMenuState {
  name: string;
  x: number;
  y: number;
}

interface ActressContextMenuProps {
  menu: ActressContextMenuState;
  onClose: () => void;
  /** Opens a file picker to set the actress's profile photo. */
  onSetPhoto: () => void;
  onRemovePhoto: () => void;
  onViewTitles: () => void;
}

export function ActressContextMenu({ menu, onClose, onSetPhoto, onRemovePhoto, onViewTitles }: ActressContextMenuProps) {
  const { name, x, y } = menu;
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
          <span className="ctx-eyebrow">Actress</span>
          <strong className="ctx-title">{name}</strong>
          <span className="ctx-subtitle">Profile actions and title shortcuts</span>
        </li>
        <li className="ctx-sep" />
        <li>
          <button className="ctx-item" onClick={onViewTitles} type="button">
            View titles
          </button>
        </li>
        <li className="ctx-sep" />
        <li>
          <button className="ctx-item" onClick={onSetPhoto} type="button">
            Set profile photo…
          </button>
        </li>
        <li>
          <button className="ctx-item" onClick={onRemovePhoto} type="button">
            Remove photo
          </button>
        </li>
      </ul>
    </div>
  );
}
