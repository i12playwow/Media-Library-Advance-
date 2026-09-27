import type { AppShellState, AppPage, LibraryMode } from "../../../shared/contracts";
import { useEffect, useState } from "react";

interface UseKeyboardShortcutsOptions {
  onToggleGentle?: () => void;
  desktopApi?: typeof window.desktopApi;
  appState?: AppShellState | null;
  isScanning?: boolean;
  activePageRef?: React.RefObject<AppPage>;
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  playerContainerRef?: React.RefObject<HTMLDivElement | null>;
  setActivePage?: (page: AppPage) => void;
  setContextMenu?: (v: null) => void;
  setShowScanOptionsPrompt?: (v: boolean) => void;
  setPlayerShowSubPanel?: (v: boolean) => void;
  setPlayerShowMovieList?: (v: boolean) => void;
  setPlayerPlaying?: (v: boolean) => void;
  setPlayerMuted?: (v: boolean) => void;
  setPlayerVolume?: (v: number) => void;
  setPlayerRate?: (v: number) => void;
  setPlayerCurrentTime?: (v: number) => void;
  navigatePlaylist?: (dir: 1 | -1) => void;
  handleScanSaved?: () => void;
  openScanOptions?: (mode: LibraryMode) => void;
}

export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions): void {
  const {
    onToggleGentle,
    desktopApi,
    appState,
    isScanning,
    activePageRef,
    videoRef,
    playerContainerRef,
    setActivePage,
    setContextMenu,
    setShowScanOptionsPrompt,
    setPlayerShowSubPanel,
    setPlayerShowMovieList,
    setPlayerPlaying,
    setPlayerMuted,
    setPlayerVolume,
    setPlayerRate,
    setPlayerCurrentTime,
    navigatePlaylist,
    handleScanSaved,
    openScanOptions,
  } = options;
  const [gentleShortcut, setGentleShortcut] = useState("Ctrl+Alt+D");

  useEffect(() => {
    if (!desktopApi) {
      return;
    }

    void desktopApi.getGentleShortcut()
      .then((value) => {
        const trimmed = value.trim();
        setGentleShortcut(trimmed || "Ctrl+Alt+D");
      })
      .catch(() => {
        setGentleShortcut("Ctrl+Alt+D");
      });
  }, [desktopApi]);

  useEffect(() => {
    function handleGentleShortcutChanged(event: Event): void {
      const nextShortcut = (event as CustomEvent<string>).detail?.trim();
      setGentleShortcut(nextShortcut || "Ctrl+Alt+D");
    }

    window.addEventListener("mla:gentleShortcutChanged", handleGentleShortcutChanged as EventListener);
    return () => {
      window.removeEventListener("mla:gentleShortcutChanged", handleGentleShortcutChanged as EventListener);
    };
  }, []);

  useEffect(() => {
    function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
      const normalized = shortcut.trim();
      if (!normalized) {
        return false;
      }

      const parts = normalized
        .split("+")
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean);
      if (parts.length === 0) {
        return false;
      }

      const keyPart = parts[parts.length - 1];
      const requiresCtrl = parts.includes("ctrl") || parts.includes("control") || parts.includes("cmdorctrl") || parts.includes("commandorcontrol");
      const requiresAlt = parts.includes("alt") || parts.includes("option");
      const requiresShift = parts.includes("shift");

      const ctrlPressed = e.ctrlKey || e.metaKey;
      if (ctrlPressed !== requiresCtrl) {
        return false;
      }
      if (e.altKey !== requiresAlt) {
        return false;
      }
      if (e.shiftKey !== requiresShift) {
        return false;
      }

      return e.key.toLowerCase() === keyPart;
    }

    function handleKeyDown(e: KeyboardEvent): void {
      const tag = (e.target as HTMLElement).tagName;
      const isFormField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

      // Configured in-app shortcut → toggle Gentle mode on/off
      if (matchesShortcut(e, gentleShortcut)) {
        e.preventDefault();
        onToggleGentle?.();
        return;
      }
      // Ctrl+Shift+N → scan new Normal folder
      if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === "N") {
        e.preventDefault();
        openScanOptions?.("normal");
        return;
      }
      // Ctrl+Shift+G → scan new Gentle folder
      if (e.ctrlKey && e.shiftKey && e.key.toUpperCase() === "G") {
        e.preventDefault();
        openScanOptions?.("gentle");
        return;
      }
      if (isFormField) return;
      // Escape → close modals / context menu
      if (e.key === "Escape") {
        setContextMenu?.(null);
        setShowScanOptionsPrompt?.(false);
        setPlayerShowSubPanel?.(false);
        setPlayerShowMovieList?.(false);
        return;
      }
      // Number keys 1–6 → switch pages
      if (!e.ctrlKey && !e.altKey && !e.shiftKey) {
        const pageMap: Record<string, AppPage> = {
          "1": "home", "2": "library", "3": "search",
          "4": "actresses", "5": "player", "6": "settings",
        };
        if (pageMap[e.key]) {
          setActivePage?.(pageMap[e.key]);
          return;
        }
      }

      // ── Player shortcuts (VLC-style) ───────────────────────────────
      if (activePageRef?.current === "player" && videoRef?.current) {
        const video = videoRef?.current;

        // Space → play/pause
        if (e.key === " ") {
          e.preventDefault();
          if (video.paused) { void video.play(); setPlayerPlaying?.(true); }
          else { video.pause(); setPlayerPlaying?.(false); }
          return;
        }
        // M → mute toggle
        if (e.key === "m" || e.key === "M") {
          e.preventDefault();
          const next = !video.muted;
          video.muted = next;
          setPlayerMuted?.(next);
          return;
        }
        // F / F11 → fullscreen toggle
        if (e.key === "f" || e.key === "F" || e.key === "F11") {
          e.preventDefault();
          if (document.fullscreenElement) void document.exitFullscreen();
          else void (playerContainerRef?.current ?? video).requestFullscreen?.();
          return;
        }
        // Escape → exit fullscreen (if in fullscreen)
        if (e.key === "Escape" && document.fullscreenElement) {
          e.preventDefault();
          void document.exitFullscreen();
          return;
        }
        // Left/Right → seek (Ctrl: ±60s, Shift: ±3s, plain: ±10s)
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const dir = e.key === "ArrowRight" ? 1 : -1;
          const step = e.ctrlKey ? 60 : e.shiftKey ? 3 : 10;
          video.currentTime = Math.max(0, Math.min(video.duration || 0, video.currentTime + dir * step));
          setPlayerCurrentTime?.(video.currentTime);
          return;
        }
        // Up/Down → volume ±5%
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const next = Math.max(0, Math.min(1, Math.round((video.volume + (e.key === "ArrowUp" ? 0.05 : -0.05)) * 100) / 100));
          video.volume = next;
          video.muted = next === 0;
          setPlayerVolume?.(next);
          setPlayerMuted?.(next === 0);
          return;
        }
        // [ → slower, ] → faster, = → normal speed
        if (e.key === "[") {
          e.preventDefault();
          const next = Math.max(0.25, Math.round((video.playbackRate - 0.25) * 100) / 100);
          video.playbackRate = next;
          setPlayerRate?.(next);
          return;
        }
        if (e.key === "]") {
          e.preventDefault();
          const next = Math.min(4, Math.round((video.playbackRate + 0.25) * 100) / 100);
          video.playbackRate = next;
          setPlayerRate?.(next);
          return;
        }
        if (e.key === "=") {
          e.preventDefault();
          video.playbackRate = 1;
          setPlayerRate?.(1);
          return;
        }
        // S → stop (go to start + pause)
        if (e.key === "s" || e.key === "S") {
          e.preventDefault();
          video.pause();
          video.currentTime = 0;
          setPlayerPlaying?.(false);
          setPlayerCurrentTime?.(0);
          return;
        }
        // E → step one frame forward (~1/25s)
        if (e.key === "e" || e.key === "E") {
          e.preventDefault();
          video.pause();
          setPlayerPlaying?.(false);
          video.currentTime = Math.min(video.duration || 0, video.currentTime + 1 / 25);
          setPlayerCurrentTime?.(video.currentTime);
          return;
        }
        // N → next movie, P → previous movie
        if (e.key === "n" || e.key === "N") {
          e.preventDefault();
          navigatePlaylist?.(1);
          return;
        }
        if (e.key === "p" || e.key === "P") {
          e.preventDefault();
          navigatePlaylist?.(-1);
          return;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [gentleShortcut, onToggleGentle, openScanOptions, setContextMenu, setShowScanOptionsPrompt, setPlayerShowSubPanel, setPlayerShowMovieList, setActivePage, activePageRef, videoRef, playerContainerRef, setPlayerPlaying, setPlayerMuted, setPlayerVolume, setPlayerRate, setPlayerCurrentTime, navigatePlaylist]);
}
