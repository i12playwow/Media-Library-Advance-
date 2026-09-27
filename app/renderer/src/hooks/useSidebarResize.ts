import { useRef, useState, type Dispatch, type SetStateAction } from "react";

interface UseSidebarResizeReturn {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: Dispatch<SetStateAction<boolean>>;
  sidebarWidth: number;
  handleSidebarDragStart: (event: React.MouseEvent) => void;
}

export function useSidebarResize(): UseSidebarResizeReturn {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const sidebarDragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  function handleSidebarDragStart(event: React.MouseEvent) {
    if (sidebarCollapsed) return;
    sidebarDragRef.current = { startX: event.clientX, startWidth: sidebarWidth };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    function onMove(e: MouseEvent) {
      if (!sidebarDragRef.current) return;
      const delta = e.clientX - sidebarDragRef.current.startX;
      const next = Math.max(180, Math.min(560, sidebarDragRef.current.startWidth + delta));
      setSidebarWidth(next);
    }

    function onUp() {
      sidebarDragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return {
    sidebarCollapsed,
    setSidebarCollapsed,
    sidebarWidth,
    handleSidebarDragStart,
  };
}
