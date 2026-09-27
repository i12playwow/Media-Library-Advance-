import { useEffect, useRef, useState } from "react";
import type {
  MovieRecord,
  OnlineSubtitleResult,
  PlayerSettings,
} from "../../../shared/contracts";
import { srtToVtt } from "../utils";

type DesktopApi = NonNullable<typeof window.desktopApi>;

interface UsePlayerOptions {
  desktopApi: DesktopApi | undefined;
  /** Current paged movie list — used as playlist fallback */
  movies: MovieRecord[];
  /** Full movie pool for actress directory — preferred playlist source */
  allMoviesPool: MovieRecord[];
  onSubtitleInstalled?: () => Promise<void> | void;
}

export function usePlayer({ desktopApi, movies, allMoviesPool, onSubtitleInstalled }: UsePlayerOptions) {
  // ── Refs ──────────────────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const playerConfigRef = useRef<HTMLDivElement>(null);
  const positionMemoryRef = useRef<Map<string, number>>(new Map());
  const pendingRestorePositionRef = useRef<number | null>(null);
  const lastCheckpointSaveRef = useRef<{ movieId: string | null; positionSeconds: number }>({
    movieId: null,
    positionSeconds: 0,
  });

  // Stable refs to latest values — used inside event-listener closures
  const playerMovieIdRef = useRef<string | null>(null);
  const playerSettingsRef = useRef<PlayerSettings>({
    defaultVolume: 1,
    subtitleFontSize: 20,
    subtitleColor: "#ffffff",
    autoPlayNext: false,
    rememberPosition: true,
    seekDuration: 10,
    videoFilterPreset: "none",
    videoFilterStrength: 50,
  });
  const moviesRef = useRef<MovieRecord[]>(movies);
  moviesRef.current = movies;
  const allMoviesPoolRef = useRef<MovieRecord[]>(allMoviesPool);
  allMoviesPoolRef.current = allMoviesPool;
  const libraryRootsRef = useRef<string[]>([]);

  // Fetch app state to learn configured library roots (used to identify "imported" files)
  useEffect(() => {
    if (!desktopApi) return;
    void desktopApi.getAppState().then((state) => {
      const roots: string[] = [];
      if (state?.roots) {
        for (const mode of ["normal", "gentle"] as const) {
          const arr = state.roots[mode] ?? [];
          for (const r of arr) roots.push(r.replace(/\\/g, "/").toLowerCase());
        }
      }
      libraryRootsRef.current = roots.map((r) => (r.endsWith("/") ? r : r + "/"));
    }).catch(() => {
      libraryRootsRef.current = [];
    });
  }, [desktopApi]);

  // ── State ─────────────────────────────────────────────────────────────────
  const [playerMovieId, setPlayerMovieId] = useState<string | null>(null);
  const [playerFileUrl, setPlayerFileUrl] = useState<string | null>(null);
  const [playerPlaying, setPlayerPlaying] = useState(false);
  const [playerVolume, setPlayerVolume] = useState(1);
  const [playerMuted, setPlayerMuted] = useState(false);
  const [playerCurrentTime, setPlayerCurrentTime] = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [playerPlaybackError, setPlayerPlaybackError] = useState<string | null>(null);
  const [playerSubtitles, setPlayerSubtitles] = useState<OnlineSubtitleResult[]>([]);
  const [playerSubTrackUrl, setPlayerSubTrackUrl] = useState<string | null>(null);
  const [playerSubTrackLang, setPlayerSubTrackLang] = useState<string>("und");
  const [playerSubLoading, setPlayerSubLoading] = useState(false);
  const [playerSubSearching, setPlayerSubSearching] = useState(false);
  const [playerShowSubPanel, setPlayerShowSubPanel] = useState(false);
  const [playerSubLangFilter, setPlayerSubLangFilter] = useState<string>("all");
  const [playerSubTargetLang, setPlayerSubTargetLang] = useState<string>("en");
  const [playerSubDownloadingId, setPlayerSubDownloadingId] = useState<string | null>(null);
  const [playerSubHasSearched, setPlayerSubHasSearched] = useState(false);
  const [playerSettings, setPlayerSettings] = useState<PlayerSettings>({
    defaultVolume: 1,
    subtitleFontSize: 20,
    subtitleColor: "#ffffff",
    autoPlayNext: false,
    rememberPosition: true,
    seekDuration: 10,
    videoFilterPreset: "none",
    videoFilterStrength: 50,
  });
  const [playerShowMovieList, setPlayerShowMovieList] = useState(false);
  const [playerHoveredMovieId, setPlayerHoveredMovieId] = useState<string | null>(null);
  const [playerRate, setPlayerRate] = useState(1);
  const [playerShowConfig, setPlayerShowConfig] = useState(false);
  const [playerIsFullscreen, setPlayerIsFullscreen] = useState(false);

  // Keep stable refs in sync with latest state
  playerMovieIdRef.current = playerMovieId;
  playerSettingsRef.current = playerSettings;

  // ── Effects ───────────────────────────────────────────────────────────────

  // Enable subtitle track programmatically — `default` attr is unreliable for dynamically-added tracks
  useEffect(() => {
    if (!playerSubTrackUrl || !videoRef.current) return;
    const video = videoRef.current;
    const enable = () => {
      for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].mode = "showing";
      }
    };
    enable();
    const t = setTimeout(enable, 300);
    return () => clearTimeout(t);
  }, [playerSubTrackUrl]);

  // Revoke previous blob URL when subtitle track changes to avoid memory leaks
  useEffect(() => {
    return () => {
      if (playerSubTrackUrl) URL.revokeObjectURL(playerSubTrackUrl);
    };
  }, [playerSubTrackUrl]);

  // Sync volume & mute to video imperatively (React doesn't support `volume` as a prop)
  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.volume = playerVolume;
    videoRef.current.muted = playerMuted;
  }, [playerVolume, playerMuted]);

  useEffect(() => {
    if (!videoRef.current || !playerFileUrl) return;
    videoRef.current.load();
  }, [playerFileUrl]);

  // Sync playback rate to video element
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playerRate;
  }, [playerRate]);

  // Track OS-level fullscreen changes (e.g. Esc key)
  useEffect(() => {
    const handler = () => setPlayerIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Close player config panel when clicking outside both the panel and ⚙ button
  useEffect(() => {
    if (!playerShowConfig) return;
    function handleClickOutside(e: MouseEvent): void {
      const target = e.target as Node;
      const insideBtn = playerConfigRef.current?.contains(target);
      const insidePanel = (target as Element).closest?.(".player-config-panel");
      if (!insideBtn && !insidePanel) {
        setPlayerShowConfig(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [playerShowConfig]);

  // ── Functions ─────────────────────────────────────────────────────────────

  function applySubtitle(srtContent: string, lang = "und"): void {
    const vtt = srtToVtt(srtContent);
    const blob = new Blob([vtt], { type: "text/vtt" });
    const url = URL.createObjectURL(blob);
    setPlayerSubTrackLang(lang);
    setPlayerSubTrackUrl(url);
  }

  async function persistPlaybackCheckpoint(movieId: string, positionSeconds: number): Promise<void> {
    if (!desktopApi) return;

    if (!playerSettingsRef.current.rememberPosition || positionSeconds <= 5) {
      positionMemoryRef.current.delete(movieId);
      pendingRestorePositionRef.current = null;
      lastCheckpointSaveRef.current = { movieId, positionSeconds: 0 };
      try {
        await desktopApi.playerClearPlaybackCheckpoint(movieId);
      } catch { /* ignore */ }
      return;
    }

    positionMemoryRef.current.set(movieId, positionSeconds);
    lastCheckpointSaveRef.current = { movieId, positionSeconds };
    try {
      await desktopApi.playerSavePlaybackCheckpoint(movieId, positionSeconds);
    } catch { /* ignore */ }
  }

  async function handlePlaybackTimeUpdate(positionSeconds: number): Promise<void> {
    const movieId = playerMovieIdRef.current;
    if (!movieId || !playerSettingsRef.current.rememberPosition) {
      return;
    }

    const roundedPosition = Math.floor(positionSeconds);
    const lastSaved = lastCheckpointSaveRef.current;
    if (lastSaved.movieId === movieId && Math.abs(roundedPosition - lastSaved.positionSeconds) < 5) {
      return;
    }

    await persistPlaybackCheckpoint(movieId, roundedPosition);
  }

  async function handlePlaybackEnded(): Promise<void> {
    const movieId = playerMovieIdRef.current;
    if (!movieId || !desktopApi) {
      return;
    }

    positionMemoryRef.current.delete(movieId);
    pendingRestorePositionRef.current = null;
    lastCheckpointSaveRef.current = { movieId, positionSeconds: 0 };
    try {
      await desktopApi.playerClearPlaybackCheckpoint(movieId);
    } catch { /* ignore */ }
  }

  async function loadMovieIntoPlayer(movie: MovieRecord): Promise<void> {
    if (!desktopApi) return;
    // Save current position before switching movies
    if (playerMovieIdRef.current && playerSettingsRef.current.rememberPosition && videoRef.current) {
      const t = videoRef.current.currentTime;
      await persistPlaybackCheckpoint(playerMovieIdRef.current, t);
    }
    setPlayerMovieId(movie.id);
    setPlayerSubTrackUrl(null);
    setPlayerSubTrackLang("und");
    setPlayerSubLangFilter("all");
    setPlayerSubTargetLang("en");
    setPlayerSubDownloadingId(null);
    setPlayerSubHasSearched(false);
    setPlayerPlaybackError(null);
    setPlayerCurrentTime(0);
    setPlayerDuration(0);
    setPlayerPlaying(false);
    lastCheckpointSaveRef.current = { movieId: movie.id, positionSeconds: 0 };
    const inMemoryPosition = positionMemoryRef.current.get(movie.id);
    if (playerSettingsRef.current.rememberPosition && typeof inMemoryPosition === "number" && inMemoryPosition > 5) {
      pendingRestorePositionRef.current = inMemoryPosition;
    } else if (playerSettingsRef.current.rememberPosition) {
      try {
        const checkpoint = await desktopApi.playerGetPlaybackCheckpoint(movie.id);
        pendingRestorePositionRef.current = checkpoint && checkpoint.positionSeconds > 5
          ? checkpoint.positionSeconds
          : null;
      } catch {
        pendingRestorePositionRef.current = null;
      }
    } else {
      pendingRestorePositionRef.current = null;
    }
    const fileUrl = await desktopApi.playerGetFileUrl(movie.sourcePath, movie.folderPath);
    setPlayerFileUrl(fileUrl);
    // Auto-load first local subtitle if available
    if (movie.subtitles.length > 0) {
      const localSub = movie.subtitles[0];
      try {
        const content = await desktopApi.playerDownloadSubtitle(
          `file:///${localSub.path.replace(/\\/g, "/")}`
        );
        if (content) applySubtitle(content, localSub.language || "und");
      } catch { /* ignore */ }
    }
  }

  async function handleDownloadSubtitle(sub: OnlineSubtitleResult): Promise<void> {
    if (!desktopApi) return;
    setPlayerSubDownloadingId(sub.id);
    setPlayerSubLoading(true);
    try {
      const content = await desktopApi.playerDownloadSubtitle(sub.downloadUrl);
      if (content) {
        const currentMovie =
          allMoviesPoolRef.current.find((movie) => movie.id === playerMovieIdRef.current) ??
          moviesRef.current.find((movie) => movie.id === playerMovieIdRef.current) ??
          null;
        const installedPath = currentMovie
          ? await desktopApi.playerInstallSubtitle(currentMovie.id, sub.languageCode || "und", content)
          : null;
        applySubtitle(content, sub.languageCode || "und");
        if (installedPath && currentMovie) {
          await onSubtitleInstalled?.();
        }
        setPlayerShowSubPanel(false);
      }
    } catch { /* ignore */ }
    setPlayerSubDownloadingId(null);
    setPlayerSubLoading(false);
  }

  async function handleSearchSubtitles(videoId: string): Promise<void> {
    if (!desktopApi) return;
    setPlayerSubSearching(true);
    setPlayerSubtitles([]);
    setPlayerSubHasSearched(false);
    try {
      const all = await desktopApi.playerFetchSubtitles(videoId);
      const filtered =
        playerSubTargetLang === "all"
          ? all
          : all.filter((s) => matchesTargetLanguage(s, playerSubTargetLang));
      setPlayerSubtitles(filtered.sort((left, right) => right.downloads - left.downloads || left.title.localeCompare(right.title)));
    } catch { /* ignore */ }
    setPlayerSubHasSearched(true);
    setPlayerSubSearching(false);
  }

  async function convertMovieToMp4(movie: MovieRecord): Promise<boolean> {
    if (!desktopApi) return false;
    setPlayerPlaybackError(null);
    setPlayerPlaying(false);
    try {
      const result = await desktopApi.playerConvertToMp4(movie.sourcePath);
      if (result?.ok && result.url) {
        setPlayerFileUrl(result.url);
        return true;
      }
      if (result && !result.ok && result.error) {
        setPlayerPlaybackError(`Conversion failed: ${result.error}`);
        return false;
      }
    } catch { /* ignore */ }
    setPlayerPlaybackError("Conversion failed. The video could not be transcoded.");
    return false;
  }

  function matchesTargetLanguage(subtitle: OnlineSubtitleResult, targetLang: string): boolean {
    const code = subtitle.languageCode.toLowerCase();
    const language = subtitle.language.toLowerCase();
    const target = targetLang.toLowerCase();

    if (target === "all") {
      return true;
    }

    if (target === "zh-hans") {
      return code === "zh-hans" || code === "zh" || code === "zh-cn" || code === "zh-sg" || language.includes("simplified");
    }

    if (target === "zh-hant") {
      return code === "zh-hant" || code === "zh-tw" || code === "zh-hk" || code === "zh-mo" || language.includes("traditional");
    }

    if (target === "zh") {
      return code.startsWith("zh") || language.includes("chinese");
    }

    return (
      code === target ||
      code.startsWith(`${target}-`) ||
      language === target ||
      language.startsWith(`${target} `)
    );
  }

  /** Navigate to next/previous movie in the playlist */
  function navigatePlaylist(direction: 1 | -1): void {
    // Prefer explicit all-movies pool when provided. Otherwise, only include movies that
    // are imported into configured library roots (moved/renamed into library folders).
    const fallbackPool = ((): MovieRecord[] => {
      const roots = libraryRootsRef.current;
      if (roots.length === 0) return moviesRef.current;
      return moviesRef.current.filter((m) => {
        try {
          const sp = (m.sourcePath ?? "").replace(/\\/g, "/").toLowerCase();
          return roots.some((root) => sp.startsWith(root));
        } catch {
          return false;
        }
      });
    })();
    const pool = allMoviesPoolRef.current.length > 0 ? allMoviesPoolRef.current : fallbackPool;
    const idx = pool.findIndex((m) => m.id === playerMovieIdRef.current);
    if (direction === 1 && idx >= 0 && idx < pool.length - 1) {
      void loadMovieIntoPlayer(pool[idx + 1]);
    } else if (direction === -1 && idx > 0) {
      void loadMovieIntoPlayer(pool[idx - 1]);
    }
  }

  return {
    // Refs
    videoRef,
    playerContainerRef,
    playerConfigRef,
    playerMovieIdRef,
    positionMemoryRef,
    pendingRestorePositionRef,
    // State
    playerMovieId, setPlayerMovieId,
    playerFileUrl, setPlayerFileUrl,
    playerPlaying, setPlayerPlaying,
    playerVolume, setPlayerVolume,
    playerMuted, setPlayerMuted,
    playerCurrentTime, setPlayerCurrentTime,
    playerDuration, setPlayerDuration,
    playerPlaybackError, setPlayerPlaybackError,
    playerSubtitles, setPlayerSubtitles,
    playerSubTrackUrl, setPlayerSubTrackUrl,
    playerSubTrackLang, setPlayerSubTrackLang,
    playerSubLoading,
    playerSubSearching, setPlayerSubSearching,
    playerShowSubPanel, setPlayerShowSubPanel,
    playerSubLangFilter, setPlayerSubLangFilter,
    playerSubTargetLang, setPlayerSubTargetLang,
    playerSubDownloadingId,
    playerSubHasSearched, setPlayerSubHasSearched,
    playerSettings, setPlayerSettings,
    playerShowMovieList, setPlayerShowMovieList,
    playerHoveredMovieId, setPlayerHoveredMovieId,
    playerRate, setPlayerRate,
    playerShowConfig, setPlayerShowConfig,
    playerIsFullscreen,
    // Functions
    loadMovieIntoPlayer,
    convertMovieToMp4,
    handlePlaybackTimeUpdate,
    handlePlaybackEnded,
    applySubtitle,
    handleDownloadSubtitle,
    handleSearchSubtitles,
    navigatePlaylist,
  };
}
