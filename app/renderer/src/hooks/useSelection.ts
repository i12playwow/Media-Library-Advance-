import { useEffect, useRef, useState } from "react";
import type { MovieRecord } from "../../../shared/contracts";

const MIN_DRAG_THRESHOLD = 5;

interface UseSelectionOptions {
  moviesRef: React.MutableRefObject<MovieRecord[]>;
  activePageRef: React.MutableRefObject<string>;
}

export function useSelection({ moviesRef, activePageRef }: UseSelectionOptions) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectionBox, setSelectionBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{
    clientX: number;
    clientY: number;
    hasModifier: boolean;
  } | null>(null);
  const hasDraggedRef = useRef(false);
  const lastClickedIdRef = useRef<string | null>(null);

  // Drag-selection window listeners
  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      if (!dragStartRef.current) return;

      const start = dragStartRef.current;
      const minX = Math.min(start.clientX, event.clientX);
      const minY = Math.min(start.clientY, event.clientY);
      const maxX = Math.max(start.clientX, event.clientX);
      const maxY = Math.max(start.clientY, event.clientY);

      if (maxX - minX < MIN_DRAG_THRESHOLD && maxY - minY < MIN_DRAG_THRESHOLD) return;

      hasDraggedRef.current = true;
      setSelectionBox({ left: minX, top: minY, width: maxX - minX, height: maxY - minY });

      if (!gridRef.current) return;
      const tiles = gridRef.current.querySelectorAll<HTMLElement>("[data-movie-id]");
      const nextIds: string[] = [];
      tiles.forEach((tile) => {
        const rect = tile.getBoundingClientRect();
        if (rect.left < maxX && rect.right > minX && rect.top < maxY && rect.bottom > minY) {
          const movieId = tile.dataset.movieId;
          if (movieId) nextIds.push(movieId);
        }
      });
      setSelectedIds(nextIds);
    }

    function onMouseUp() {
      if (dragStartRef.current && !hasDraggedRef.current && !dragStartRef.current.hasModifier) {
        setSelectedIds([]);
      }
      dragStartRef.current = null;
      hasDraggedRef.current = false;
      setSelectionBox(null);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  // Selection keyboard shortcuts (Ctrl+A, Escape, ArrowUp/Down on library page)
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const focused = document.activeElement;
      const isTyping =
        focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement;
      if (isTyping) return;

      const onLibrary = activePageRef.current === "library";

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        if (onLibrary && moviesRef.current.length > 0) {
          event.preventDefault();
          setSelectedIds(moviesRef.current.map((m) => m.id));
        }
        return;
      }

      if (event.key === "Escape" && onLibrary) {
        event.preventDefault();
        setSelectedIds([]);
        return;
      }

      if (onLibrary && ["ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activePageRef, moviesRef]);

  function handleGridMouseDown(event: React.MouseEvent<HTMLDivElement>): void {
    const target = event.target as HTMLElement;
    if (
      target.closest("button") ||
      target.closest("label") ||
      target.closest("input")
    )
      return;
    event.preventDefault();
    hasDraggedRef.current = false;
    dragStartRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      hasModifier: event.shiftKey || event.ctrlKey || event.metaKey,
    };
  }

  function handleTileClick(movie: MovieRecord, event: React.MouseEvent): void {
    if (event.ctrlKey || event.metaKey) {
      toggleSelected(movie.id);
      lastClickedIdRef.current = movie.id;
    } else if (event.shiftKey && lastClickedIdRef.current) {
      const lastIdx = moviesRef.current.findIndex(
        (m) => m.id === lastClickedIdRef.current
      );
      const thisIdx = moviesRef.current.findIndex((m) => m.id === movie.id);
      if (lastIdx !== -1 && thisIdx !== -1) {
        const [start, end] =
          lastIdx < thisIdx ? [lastIdx, thisIdx] : [thisIdx, lastIdx];
        const rangeIds = moviesRef.current.slice(start, end + 1).map((m) => m.id);
        setSelectedIds((prev) => Array.from(new Set([...prev, ...rangeIds])));
      }
    } else {
      setSelectedIds([movie.id]);
      lastClickedIdRef.current = movie.id;
    }
  }

  function toggleSelected(movieId: string): void {
    setSelectedIds((current) =>
      current.includes(movieId)
        ? current.filter((id) => id !== movieId)
        : [...current, movieId]
    );
  }

  return {
    selectedIds,
    setSelectedIds,
    selectionBox,
    gridRef,
    handleGridMouseDown,
    handleTileClick,
    toggleSelected,
  };
}
