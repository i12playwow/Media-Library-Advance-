import type React from "react";
import { useRef, useState } from "react";

interface PlayerPopupProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Floating popup wrapper for the built-in player.
 *
 * The PlayerPage itself is rendered by App and passed as children, so the
 * <video> element and all player state stay mounted exactly once — whether
 * the player is shown as the full page or inside this popup. The header is
 * the drag handle; closing pauses playback and unmounts the popup.
 */
export function PlayerPopup({ title, onClose, children }: PlayerPopupProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const dragStateRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const frame = frameRef.current;
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    dragStateRef.current = {
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragStateRef.current;
    const frame = frameRef.current;
    if (!drag || !frame) return;
    const x = event.clientX - drag.offsetX;
    const y = event.clientY - drag.offsetY;
    setPosition({
      x: Math.min(Math.max(x, 0), Math.max(0, window.innerWidth - frame.offsetWidth)),
      y: Math.min(Math.max(y, 0), Math.max(0, window.innerHeight - 36))
    });
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div
      className="player-popup"
      ref={frameRef}
      style={position ? { left: position.x, top: position.y, transform: "none" } : undefined}
    >
      <div
        className="player-popup-header"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        title="Drag to move"
      >
        <span className="player-popup-title">{title || "Built-in player"}</span>
        <div className="player-popup-actions">
          <button
            aria-label="Close player"
            className="player-popup-close"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </div>
      </div>
      <div className="player-popup-body">{children}</div>
    </div>
  );
}
