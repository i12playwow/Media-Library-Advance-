import type React from "react";
import { useRef, useState } from "react";

interface PlayerPopupProps {
  title: string;
  onClose: () => void;
  /** Seeks the mounted player video by a signed number of seconds. */
  onSeek: (deltaSeconds: number) => void;
  children: React.ReactNode;
}

/**
 * Floating popup wrapper for the built-in player.
 *
 * The PlayerPage itself is rendered by App and passed as children, so the
 * <video> element and all player state stay mounted exactly once — whether
 * the player is shown as the full page or inside this popup. The header is
 * the drag handle; any edge or corner can be dragged to resize the popup;
 * closing pauses playback and unmounts the popup.
 */
export function PlayerPopup({ title, onClose, onSeek, children }: PlayerPopupProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const dragStateRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const resizeStateRef = useRef<{
    dir: string;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
    startLeft: number;
    startTop: number;
  } | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  const MIN_WIDTH = 720;
  const MIN_HEIGHT = 460;

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

  function handleResizePointerDown(dir: string, event: React.PointerEvent<HTMLDivElement>) {
    const frame = frameRef.current;
    if (!frame) return;
    event.stopPropagation();
    const rect = frame.getBoundingClientRect();
    // Materialize the centered (transform-based) placement into explicit
    // coordinates so resizing from the left/top edges can shift it.
    setPosition((current) => current ?? { x: rect.left, y: rect.top });
    setSize((current) => current ?? { width: rect.width, height: rect.height });
    resizeStateRef.current = {
      dir,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
      startLeft: rect.left,
      startTop: rect.top
    };
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic/untrusted events carry a pointerId with no active pointer;
      // the resize still works without capture.
    }
  }

  function handleResizePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = resizeStateRef.current;
    if (!state) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;

    let width = state.startWidth;
    let height = state.startHeight;
    let left = state.startLeft;
    let top = state.startTop;

    if (state.dir.includes("e")) width = state.startWidth + dx;
    if (state.dir.includes("s")) height = state.startHeight + dy;
    if (state.dir.includes("w")) width = state.startWidth - dx;
    if (state.dir.includes("n")) height = state.startHeight - dy;

    width = Math.max(MIN_WIDTH, width);
    height = Math.max(MIN_HEIGHT, height);
    if (state.dir.includes("w")) left = state.startLeft + (state.startWidth - width);
    if (state.dir.includes("n")) top = state.startTop + (state.startHeight - height);

    // Keep the popup inside the viewport.
    left = Math.min(Math.max(left, 0), Math.max(0, window.innerWidth - MIN_WIDTH));
    top = Math.min(Math.max(top, 0), Math.max(0, window.innerHeight - MIN_HEIGHT));
    width = Math.min(width, window.innerWidth - left);
    height = Math.min(height, window.innerHeight - top);

    setSize({ width, height });
    setPosition({ x: left, y: top });
  }

  function handleResizePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    resizeStateRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  const resizeHandles: Array<"n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"> = [
    "n", "s", "e", "w", "ne", "nw", "se", "sw"
  ];

  return (
    <div
      className="player-popup"
      ref={frameRef}
      style={{
        ...(position ? { left: position.x, top: position.y, transform: "none" } : {}),
        ...(size ? { width: size.width, height: size.height } : {})
      }}
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
            aria-label="Seek backward 10 seconds"
            className="player-popup-seek"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onSeek(-10)}
            title="Seek −10s"
            type="button"
          >
            ⏪
          </button>
          <button
            aria-label="Seek forward 10 seconds"
            className="player-popup-seek"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onSeek(10)}
            title="Seek +10s"
            type="button"
          >
            ⏩
          </button>
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
      {resizeHandles.map((dir) => (
        <div
          key={dir}
          aria-hidden="true"
          className={`player-popup-resize player-popup-resize-${dir}`}
          onPointerDown={(event) => handleResizePointerDown(dir, event)}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerUp}
          onPointerCancel={handleResizePointerUp}
        />
      ))}
    </div>
  );
}
