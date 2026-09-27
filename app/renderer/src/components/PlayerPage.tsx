import React, { useState, useEffect, useRef } from "react";
import type { MovieRecord, OnlineSubtitleResult, PlayerSettings } from "../../../shared/contracts";
import type { } from "react";
import { formatTime } from "../utils";
import { extractStrictJavVideoIdCandidates, extractVideoIdCandidates } from "../../../shared/videoId";
import styles from './PlayerPage.module.css';

function buildVideoFilter(settings: PlayerSettings): string {
  const strength = Math.max(0, Math.min(100, settings.videoFilterStrength)) / 100;
  if (settings.videoFilterPreset === "none" || strength === 0) {
    return "none";
  }

  switch (settings.videoFilterPreset) {
    case "vivid":
      return `saturate(${1 + strength * 0.9}) contrast(${1 + strength * 0.3}) brightness(${1 + strength * 0.08})`;
    case "warm":
      return `sepia(${strength * 0.35}) saturate(${1 + strength * 0.25}) hue-rotate(${-10 * strength}deg) contrast(${1 + strength * 0.05})`;
    case "cool":
      return `saturate(${1 + strength * 0.2}) hue-rotate(${10 * strength}deg) brightness(${1 - strength * 0.04})`;
    case "mono":
      return `grayscale(${strength}) contrast(${1 + strength * 0.2})`;
    case "sepia":
      return `sepia(${strength}) saturate(${1 - strength * 0.15}) contrast(${1 + strength * 0.12})`;
    default:
      return "none";
  }
}

interface PlayerPageProps {
  // movie data
  movies: MovieRecord[];
  allMoviesPool: MovieRecord[];
  playerMovieId: string | null;

  // video element refs
  videoRef: React.RefObject<HTMLVideoElement | null>;
  playerContainerRef: React.RefObject<HTMLElement | null>;
  playerConfigRef: React.RefObject<HTMLElement | null>;
  pendingRestorePositionRef: React.RefObject<number | null>;

  // playback state
  playerFileUrl: string | null;
  playerPlaying: boolean;
  playerMuted: boolean;
  playerVolume: number;
  playerRate: number;
  playerCurrentTime: number;
  playerDuration: number;
  playerPlaybackError: string | null;
  playerIsFullscreen: boolean;
  playerSettings: PlayerSettings;

  // UI state
  playerShowConfig: boolean;
  playerShowMovieList: boolean;
  playerHoveredMovieId: string | null;
  playerShowSubPanel: boolean;

  // subtitle state
  playerSubTrackUrl: string | null;
  playerSubTrackLang: string;
  playerSubTargetLang: string;
  playerSubtitles: OnlineSubtitleResult[];
  playerSubSearching: boolean;
  playerSubHasSearched: boolean;
  playerSubDownloadingId: string | null;

  // setters
  setPlayerPlaying: (v: boolean) => void;
  setPlayerMuted: (v: boolean) => void;
  setPlayerVolume: (v: number) => void;
  setPlayerRate: (v: number) => void;
  setPlayerCurrentTime: (v: number) => void;
  setPlayerDuration: (v: number) => void;
  setPlayerPlaybackError: (v: string | null) => void;
  setPlayerSettings: React.Dispatch<React.SetStateAction<PlayerSettings>>;
  setPlayerShowConfig: React.Dispatch<React.SetStateAction<boolean>>;
  setPlayerShowMovieList: React.Dispatch<React.SetStateAction<boolean>>;
  setPlayerHoveredMovieId: (id: string | null) => void;
  setPlayerShowSubPanel: React.Dispatch<React.SetStateAction<boolean>>;
  setPlayerSubTrackUrl: (url: string | null) => void;
  setPlayerSubTargetLang: (lang: string) => void;
  setPlayerSubtitles: React.Dispatch<React.SetStateAction<OnlineSubtitleResult[]>>;
  setPlayerSubHasSearched: (v: boolean) => void;

  // actions
  loadMovieIntoPlayer: (movie: MovieRecord) => Promise<void>;
  navigatePlaylist: (delta: 1 | -1) => void;
  applySubtitle: (content: string, lang: string) => void;
  handleSearchSubtitles: (videoId: string) => Promise<void>;
  handleDownloadSubtitle: (sub: OnlineSubtitleResult) => Promise<void>;
  convertMovieToMp4: (movie: MovieRecord) => Promise<boolean>;
  handlePlaybackTimeUpdate: (positionSeconds: number) => Promise<void>;
  handlePlaybackEnded: () => Promise<void>;

  // desktop api
  playerSaveSettings: (settings: PlayerSettings) => Promise<void>;
  playerDownloadSubtitleFile: (url: string) => Promise<string | null>;
  playerOpenFile: (filePath: string) => Promise<void>;
  playerShowInFolder: (filePath: string) => Promise<void>;
}

export function PlayerPage({
  movies,
  allMoviesPool,
  playerMovieId,
  videoRef,
  playerContainerRef,
  playerConfigRef,
  pendingRestorePositionRef,
  playerFileUrl,
  playerPlaying,
  playerMuted,
  playerVolume,
  playerRate,
  playerCurrentTime,
  playerDuration,
  playerPlaybackError,
  playerIsFullscreen,
  playerSettings,
  playerShowConfig,
  playerShowMovieList,
  playerHoveredMovieId,
  playerShowSubPanel,
  playerSubTrackUrl,
  playerSubTrackLang,
  playerSubTargetLang,
  playerSubtitles,
  playerSubSearching,
  playerSubHasSearched,
  playerSubDownloadingId,
  setPlayerPlaying,
  setPlayerMuted,
  setPlayerVolume,
  setPlayerRate,
  setPlayerCurrentTime,
  setPlayerDuration,
  setPlayerPlaybackError,
  setPlayerSettings,
  setPlayerShowConfig,
  setPlayerShowMovieList,
  setPlayerHoveredMovieId,
  setPlayerShowSubPanel,
  setPlayerSubTrackUrl,
  setPlayerSubTargetLang,
  setPlayerSubtitles,
  setPlayerSubHasSearched,
  loadMovieIntoPlayer,
  navigatePlaylist,
  applySubtitle,
  handleSearchSubtitles,
  handleDownloadSubtitle,
  convertMovieToMp4,
  handlePlaybackTimeUpdate,
  handlePlaybackEnded,
  playerSaveSettings,
  playerDownloadSubtitleFile,
  playerOpenFile,
}: PlayerPageProps) {
  const [isConverting, setIsConverting] = useState(false);
  const playerMovie = movies.find((m) => m.id === playerMovieId) ?? null;
  const allPlayerMovies = allMoviesPool.length > 0 ? allMoviesPool : movies;
  const currentVideoSearchId = (() => {
    if (!playerMovie) return "";
    const stem = (playerMovie.sourcePath ?? "").split(/[\\/]/).pop() ?? "";
    const basename = stem.replace(/\.[^/.]+$/, "");
    return (
      extractStrictJavVideoIdCandidates(basename)[0] ??
      extractVideoIdCandidates(basename)[0] ??
      ""
    );
  })();
  const [videoHidden, setVideoHidden] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [closingDropdown, setClosingDropdown] = useState(false);
  const dropdownTimer = useRef<number | null>(null);
  const videoFilter = buildVideoFilter(playerSettings);
  const nowPlayingDetails = playerMovie
    ? [playerMovie.year ? String(playerMovie.year) : null, playerMovie.resolution, playerMovie.libraryMode]
        .filter(Boolean)
        .join(" · ")
    : "";

  // --- Subtitle search query state (auto-filled with videoId + title) ---
  const [playerSubSearchQuery, setPlayerSubSearchQuery] = useState("");
  const detectedSubtitleId = (() => {
    if (!playerMovie) return "";
    const titleCandidate = extractStrictJavVideoIdCandidates(playerMovie.title)[0] ?? "";
    const stem = (playerMovie.sourcePath ?? "").split(/[\\/]/).pop() ?? "";
    const basename = stem.replace(/\.[^/.]+$/, "");
    return (
      extractStrictJavVideoIdCandidates(playerMovie.videoId ?? "")[0] ??
      titleCandidate ??
      extractStrictJavVideoIdCandidates(basename)[0] ??
      ""
    );
  })();
  useEffect(() => {
    if (playerMovie) {
      setPlayerSubSearchQuery(detectedSubtitleId || playerMovie.title);
    }
  }, [playerMovie, detectedSubtitleId]);

  useEffect(() => {
    if (playerShowMovieList) {
      // open immediately
      if (dropdownTimer.current) { window.clearTimeout(dropdownTimer.current); dropdownTimer.current = null; }
      setClosingDropdown(false);
      setShowDropdown(true);
    } else {
      // trigger exit animation then unmount
      setClosingDropdown(true);
      dropdownTimer.current = window.setTimeout(() => {
        setShowDropdown(false);
        setClosingDropdown(false);
        dropdownTimer.current = null;
      }, 260);
    }
    return () => {
      if (dropdownTimer.current) { window.clearTimeout(dropdownTimer.current); dropdownTimer.current = null; }
    };
  }, [playerShowMovieList]);

  return (
    <section className="page player-page" ref={playerContainerRef}>
      {/* Top bar: now-playing title + actions */}
      <div className="player-topbar">
        <div className="player-now-playing">
          {playerMovie?.posterUrl && (
            <img src={playerMovie.posterUrl} alt="" className="player-pick-thumb" />
          )}
          <div className="player-now-playing-copy">
            <span className="player-pick-title">
              {playerMovie ? playerMovie.title : "No movie selected"}
            </span>
            {playerMovie ? (
              <span className="player-pick-subtitle">
                {nowPlayingDetails || playerMovie.sourcePath}
              </span>
            ) : (
              <span className="player-pick-subtitle">
                Pick a title from the movie list to start playback.
              </span>
            )}
          </div>
        </div>
        <div className="player-topbar-actions">
          <div className={styles.topbarFlex}>
            <button className="ghost-button" type="button" onClick={async () => {
              if (allPlayerMovies.length === 0) return;
              // enable autoplay next and start from first
              setPlayerSettings((s) => ({ ...s, autoPlayNext: true }));
              await loadMovieIntoPlayer(allPlayerMovies[0]);
              if (videoRef.current) { void videoRef.current.play().catch(() => {}); }
            }}>Play all</button>
            <button className="ghost-button" type="button" onClick={() => {
              const next = !playerMuted;
              setPlayerMuted(next);
              if (videoRef.current) videoRef.current.muted = next;
            }}>{playerMuted ? "Unmute all" : "Mute all"}</button>
            <button className="ghost-button" type="button" onClick={() => setVideoHidden((v) => !v)}>{videoHidden ? "Show video" : "Hide video"}</button>
          </div>
          <button
            className={`ghost-button${playerShowSubPanel ? " active" : ""}`}
            onClick={() => setPlayerShowSubPanel((v) => !v)}
            title="Subtitles"
            type="button"
          >
            Subtitles {playerSubSearching ? "…" : playerSubtitles.length > 0 ? `(${playerSubtitles.length})` : ""}
          </button>
          {/* Compact movie picker */}
          <div className="player-movie-selector">
            <button
              className={`ghost-button${playerShowMovieList ? " active" : ""}`}
              onClick={() => setPlayerShowMovieList((v) => !v)}
              type="button"
              title="Pick movie"
            >
              ≡ Movies
            </button>
            {showDropdown && (
              <div className={`player-movie-dropdown ${closingDropdown ? "exit" : "enter"}`}>
                {playerHoveredMovieId && (() => {
                  const hm = allPlayerMovies.find((x) => x.id === playerHoveredMovieId);
                  return hm?.posterUrl ? (
                    <div className="player-poster-preview">
                      <img src={hm.posterUrl} alt={hm.title} />
                    </div>
                  ) : null;
                })()}
                {allPlayerMovies.length === 0 ? (
                  <p className={`subtle ${styles.noMoviesSubtle}`}>No movies in library</p>
                ) : allPlayerMovies.map((m) => (
                  <button
                    key={m.id}
                    className={`player-movie-item${m.id === playerMovieId ? " active" : ""}`}
                    onClick={() => { void loadMovieIntoPlayer(m); setPlayerShowMovieList(false); setPlayerHoveredMovieId(null); }}
                    onMouseEnter={() => setPlayerHoveredMovieId(m.id)}
                    onMouseLeave={() => setPlayerHoveredMovieId(null)}
                    type="button"
                  >
                    <div className="player-dropdown-info">
                      <strong>{m.title}</strong>
                      <small>{m.videoId ?? m.libraryMode} · {m.year ?? "?"}</small>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

        <div className="player-body">
        {/* Video */}
        <div className="player-video-wrap" onClick={() => {
          if (!videoRef.current) return;
          if (playerPlaying) { videoRef.current.pause(); setPlayerPlaying(false); }
          else { void videoRef.current.play(); setPlayerPlaying(true); }
        }}>
          {videoHidden ? (
            <div className="player-empty">
              <div className="player-empty-card">
                <p className="eyebrow">Hidden playback</p>
                <h3>Video is hidden</h3>
                <p className="subtle">
                  The player is still active. Use Show Video to bring the frame back, or keep using the transport controls.
                </p>
                <div className="player-empty-pills">
                  <span>Space</span>
                  <span>Seek wheel</span>
                  <span>CC subtitles</span>
                </div>
              </div>
            </div>
          ) : playerFileUrl ? (
            <video
              ref={videoRef}
              className="player-video"
              src={playerFileUrl}
              controls={Boolean(playerPlaybackError)}
              preload="metadata"
              playsInline
              muted={playerMuted}
              onPlay={() => { setPlayerPlaying(true); setPlayerPlaybackError(null); }}
              onPause={() => setPlayerPlaying(false)}
              onTimeUpdate={() => {
                const nextTime = videoRef.current?.currentTime ?? 0;
                setPlayerCurrentTime(nextTime);
                void handlePlaybackTimeUpdate(nextTime);
              }}
              onDurationChange={() => setPlayerDuration(videoRef.current?.duration ?? 0)}
              onLoadedMetadata={() => {
                setPlayerPlaybackError(null);
                if (!videoRef.current) return;
                const restorePosition = pendingRestorePositionRef.current;
                if (typeof restorePosition === "number" && restorePosition > 0) {
                  videoRef.current.currentTime = Math.min(
                    restorePosition,
                    Math.max((videoRef.current.duration || restorePosition) - 1, 0)
                  );
                  setPlayerCurrentTime(videoRef.current.currentTime);
                  pendingRestorePositionRef.current = null;
                }
                void videoRef.current.play().catch(() => {});
              }}
              onError={() => {
                const mediaError = videoRef.current?.error;
                const message =
                  mediaError?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
                    ? "This video format is not supported by the built-in player."
                    : mediaError?.code === MediaError.MEDIA_ERR_DECODE
                      ? "The video could not be decoded."
                      : "The video failed to load.";
                setPlayerPlaybackError(message);
                setPlayerPlaying(false);
              }}
              onEnded={() => {
                setPlayerPlaying(false);
                void handlePlaybackEnded();
                if (playerSettings.autoPlayNext) {
                  navigatePlaylist(1);
                }
              }}
              onWheel={(e) => {
                if (!videoRef.current) return;
                e.preventDefault();
                const seekAmount = 10; // seconds
                if (e.deltaY < 0) {
                  // Scroll up: seek forward
                  videoRef.current.currentTime = Math.min(
                    videoRef.current.duration || 0,
                    videoRef.current.currentTime + seekAmount
                  );
                } else if (e.deltaY > 0) {
                  // Scroll down: seek backward
                  videoRef.current.currentTime = Math.max(
                    0,
                    videoRef.current.currentTime - seekAmount
                  );
                }
                setPlayerCurrentTime(videoRef.current.currentTime);
              }}
              style={{
                "--sub-size": `${playerSettings.subtitleFontSize}px`,
                "--sub-color": playerSettings.subtitleColor,
                filter: videoFilter,
              } as React.CSSProperties}
            >
              {playerSubTrackUrl && (
                <track
                  key={playerSubTrackUrl}
                  kind="subtitles"
                  src={playerSubTrackUrl}
                  srcLang={playerSubTrackLang}
                  label="Subtitle"
                  default
                />
              )}
            </video>
          ) : (
            <div className="player-empty">
              <div className="player-empty-card">
                <p className="eyebrow">Ready</p>
                <h3>Select a movie to start playing</h3>
                <p className="subtle">
                  Use the movie picker above or open a title from Library to load it here.
                </p>
                <div className="player-empty-pills">
                  <span>Previous / Next</span>
                  <span>Speed</span>
                  <span>Subtitles</span>
                </div>
              </div>
            </div>
          )}
          {playerPlaybackError && (
            <div className="player-error">
              <strong>Playback error</strong>
              <p>{playerPlaybackError}</p>
              <div className="player-error-actions">
                <button className="player-btn" type="button" onClick={() => { if (playerMovie) void loadMovieIntoPlayer(playerMovie); }}>
                  Retry
                </button>
                {playerMovie && (
                  <button
                    className="player-btn"
                    type="button"
                    disabled={isConverting}
                    onClick={async () => {
                      setIsConverting(true);
                      await convertMovieToMp4(playerMovie);
                      setIsConverting(false);
                    }}
                  >
                    {isConverting ? "Converting…" : "Convert to MP4 and play"}
                  </button>
                )}
                {playerMovie && (
                  <button className="player-btn" type="button" onClick={() => void playerOpenFile(playerMovie.sourcePath)}>
                    Open in system player
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="player-controls" onClick={(e) => e.stopPropagation()}>
          {/* Config popover */}
          {playerShowConfig && (
            <div className="player-config-panel">
              <div className="player-config-section">
                <label>Speed</label>
                <div className="player-speed-grid">
                  {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3].map((s) => (
                    <button
                      key={s}
                      className={`player-speed-item${playerRate === s ? " active" : ""}`}
                      onClick={() => { setPlayerRate(s); if (videoRef.current) videoRef.current.playbackRate = s; }}
                      type="button"
                    >{s}×</button>
                  ))}
                </div>
              </div>
              <div className="player-config-section">
                <label>
                  Subtitle size: {playerSettings.subtitleFontSize}px
                  <input id="subtitle-size" type="range" min={12} max={48}
                    value={playerSettings.subtitleFontSize}
                    aria-label="Subtitle font size (12 to 48px)"
                    onChange={(e) => setPlayerSettings((s) => ({ ...s, subtitleFontSize: Number(e.target.value) }))}
                  />
                </label>
              </div>
              <div className="player-config-section">
                <label>
                  Subtitle color
                  <input id="subtitle-color" type="color" value={playerSettings.subtitleColor}
                    aria-label="Subtitle color picker"
                    onChange={(e) => setPlayerSettings((s) => ({ ...s, subtitleColor: e.target.value }))}
                  />
                </label>
              </div>
              <div className="player-config-section player-config-row">
                <label className="player-config-row-label">
                  <input id="player-autoplay-next" type="checkbox" checked={playerSettings.autoPlayNext}
                    onChange={(e) => setPlayerSettings((s) => ({ ...s, autoPlayNext: e.target.checked }))}
                  />
                  Auto-play next
                </label>
              </div>
              <div className="player-config-section player-config-row">
                <label className="player-config-row-label">
                  <input id="player-remember-position" type="checkbox" checked={playerSettings.rememberPosition}
                    onChange={(e) => setPlayerSettings((s) => ({ ...s, rememberPosition: e.target.checked }))}
                  />
                  Remember position
                </label>
              </div>
              <div className="player-config-section">
                <label>
                  Video filter
                  <select
                    className="filter-select"
                    value={playerSettings.videoFilterPreset}
                    onChange={(e) =>
                      setPlayerSettings((s) => ({
                        ...s,
                        videoFilterPreset: e.target.value as PlayerSettings["videoFilterPreset"],
                      }))
                    }
                  >
                    <option value="none">None</option>
                    <option value="vivid">Vivid</option>
                    <option value="warm">Warm</option>
                    <option value="cool">Cool</option>
                    <option value="mono">Mono</option>
                    <option value="sepia">Sepia</option>
                  </select>
                </label>
              </div>
              <div className="player-config-section">
                <label>
                  Filter strength ({playerSettings.videoFilterStrength}%)
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={playerSettings.videoFilterStrength}
                    onChange={(e) =>
                      setPlayerSettings((s) => ({
                        ...s,
                        videoFilterStrength: Number(e.target.value),
                      }))
                    }
                  />
                </label>
              </div>
              <div className="player-config-section">
                <button className={`player-btn ${styles.saveBtnFull}`} type="button" 
                  onClick={async () => {
                    await playerSaveSettings(playerSettings);
                    setPlayerVolume(playerSettings.defaultVolume);
                    setPlayerShowConfig(false);
                  }}>
                  Save settings
                </button>
              </div>
            </div>
          )}

          {/* Seek bar */}
          <input
            className="player-seek"
            type="range"
            min={0}
            max={playerDuration || 100}
            value={playerCurrentTime}
            aria-label="Seek position"
            title="Drag to seek"
            onChange={(e) => {
              const t = Number(e.target.value);
              if (videoRef.current) videoRef.current.currentTime = t;
              setPlayerCurrentTime(t);
              void handlePlaybackTimeUpdate(t);
            }}
            style={{ "--pct": `${(playerCurrentTime / (playerDuration || 1)) * 100}%` } as React.CSSProperties}
          />
          <div className="player-controls-row">
            <div className="player-controls-left">
              <button className="player-btn" title="Previous (P)" type="button" onClick={() => {
                const idx = allPlayerMovies.findIndex((m) => m.id === playerMovieId);
                if (idx > 0) void loadMovieIntoPlayer(allPlayerMovies[idx - 1]);
              }}>⏮</button>
              <button className="player-btn" title="Seek -10s (←)" type="button" onClick={() => {
                if (!videoRef.current) return;
                videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
                setPlayerCurrentTime(videoRef.current.currentTime);
                void handlePlaybackTimeUpdate(videoRef.current.currentTime);
              }}>⏪</button>
              <button className="player-btn player-btn-main" type="button" title="Play / Pause (Space)" onClick={() => {
                if (!videoRef.current) return;
                if (playerPlaying) { videoRef.current.pause(); }
                else { void videoRef.current.play(); }
              }}>
                {playerPlaying ? "⏸" : "▶"}
              </button>
              <button className="player-btn" title="Seek +10s (→)" type="button" onClick={() => {
                if (!videoRef.current) return;
                videoRef.current.currentTime = Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + 10);
                setPlayerCurrentTime(videoRef.current.currentTime);
                void handlePlaybackTimeUpdate(videoRef.current.currentTime);
              }}>⏩</button>
              <button className="player-btn" title="Next (N)" type="button" onClick={() => {
                const idx = allPlayerMovies.findIndex((m) => m.id === playerMovieId);
                if (idx < allPlayerMovies.length - 1) void loadMovieIntoPlayer(allPlayerMovies[idx + 1]);
              }}>⏭</button>
              <span className="player-time">{formatTime(playerCurrentTime)} / {formatTime(playerDuration)}</span>
            </div>
            <div className="player-controls-right">
              <button className="player-btn" title="Mute (M)" onClick={() => {
                const next = !playerMuted;
                setPlayerMuted(next);
                if (videoRef.current) videoRef.current.muted = next;
              }} type="button">
                {playerMuted || playerVolume === 0 ? "🔇" : playerVolume > 0.5 ? "🔊" : "🔉"}
              </button>
              <input
                className="player-volume"
                type="range" min={0} max={1} step={0.05}
                value={playerMuted ? 0 : playerVolume}
                aria-label="Volume level"
                title="Adjust volume"
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setPlayerVolume(v);
                  setPlayerMuted(v === 0);
                  if (videoRef.current) { videoRef.current.volume = v; videoRef.current.muted = v === 0; }
                }}
              />
              <button
                className="player-btn"
                title="Speed — click to cycle  [ slower  ] faster  = normal"
                type="button"
                onClick={() => {
                  const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
                  const next = speeds[(speeds.indexOf(playerRate) + 1) % speeds.length];
                  setPlayerRate(next);
                }}
              >
                {playerRate}×
              </button>
              <button
                className={`player-btn${playerSubTrackUrl ? " active" : ""}`}
                onClick={() => { if (playerSubTrackUrl) setPlayerSubTrackUrl(null); else setPlayerShowSubPanel(true); }}
                title="Subtitles (CC)"
                type="button"
              >CC</button>
              <button className="player-btn" title="Fullscreen (F)" type="button"
                onClick={() => {
                  if (document.fullscreenElement) void document.exitFullscreen();
                  else void (playerContainerRef.current ?? videoRef.current)?.requestFullscreen?.();
                }}>
                {playerIsFullscreen ? "⊡" : "⛶"}
              </button>
              <div ref={playerConfigRef as React.RefObject<HTMLDivElement>} className={styles.configRelative}>                <button
                  className={`player-btn${playerShowConfig ? " active" : ""}`}
                  title="Player settings"
                  type="button"
                  onClick={() => setPlayerShowConfig((v) => !v)}
                >⚙</button>
              </div>
            </div>
          </div>
        </div>

        {/* Subtitle panel */}
        {playerShowSubPanel && (
          <div className="player-sub-panel">
            <div className="player-sub-header">
              <strong>Subtitles</strong>
              <button className="ghost-button" onClick={() => setPlayerShowSubPanel(false)} type="button">✕</button>
            </div>

            {playerSubTrackUrl && (
              <button className="player-sub-item active" onClick={() => { setPlayerSubTrackUrl(null); }} type="button">
                ✓ Subtitle active — click to remove
              </button>
            )}

            {playerMovie?.subtitles.map((sub) => (
              <button key={sub.id} className="player-sub-item" type="button"
                onClick={async () => {
                  const content = await playerDownloadSubtitleFile(`file:///${sub.path.replace(/\\/g, "/")}`);
                  if (content) { applySubtitle(content, sub.language || "und"); setPlayerShowSubPanel(false); }
                }}>
                📄 {sub.language || sub.path.split(/[\\/]/).pop()}
              </button>
            ))}

            <div className="player-sub-divider">Online — SubtitleCat</div>


            <div className={`player-sub-search-row ${styles.subSearchRow}`}>
              <select
                className="player-sub-lang-select"
                aria-label="Target language for subtitle search"
                value={playerSubTargetLang}
                onChange={(e) => { setPlayerSubTargetLang(e.target.value); setPlayerSubtitles([]); setPlayerSubHasSearched(false); }}
              >
                <option value="en">English</option>
                <option value="ja">Japanese</option>
                <option value="zh-hans">Chinese Simplified</option>
                <option value="zh-hant">Chinese Traditional</option>
                <option value="zh">Chinese</option>
                <option value="ko">Korean</option>
                <option value="fr">French</option>
                <option value="es">Spanish</option>
                <option value="de">German</option>
                <option value="pt">Portuguese</option>
                <option value="th">Thai</option>
                <option value="vi">Vietnamese</option>
                <option value="id">Indonesian</option>
                <option value="ar">Arabic</option>
                <option value="ru">Russian</option>
                <option value="it">Italian</option>
                <option value="all">All languages</option>
              </select>
              <div className={styles.searchIdBlock}>
                <label className="player-sub-id-label" htmlFor="player-sub-search-query">
                  Subtitle search ID
                </label>
                <input
                  id="player-sub-search-query"
                  className={`player-sub-search-input ${styles.subSearchInput}`}
                  type="text"
                  value={playerSubSearchQuery}
                  onChange={e => setPlayerSubSearchQuery(e.target.value)}
                  placeholder="Edit the detected DVD ID here"
                />
              </div>
              <button
                className="player-sub-search-btn"
                type="button"
                disabled={playerSubSearching || !playerSubSearchQuery.trim()}
                onClick={() => {
                  if (playerSubSearchQuery.trim()) {
                    void handleSearchSubtitles(playerSubSearchQuery.trim());
                  }
                }}
              >
                Search typed ID
              </button>
              <button
                className="player-btn"
                type="button"
                title="Search using the detected DVD ID from the movie file"
                disabled={playerSubSearching || !detectedSubtitleId}
                onClick={() => {
                  if (detectedSubtitleId) {
                    setPlayerSubSearchQuery(detectedSubtitleId);
                    setPlayerSubHasSearched(false);
                    void handleSearchSubtitles(detectedSubtitleId);
                  }
                }}
              >
                Search auto ID
              </button>
            </div>

            {!currentVideoSearchId && (
              <p className="player-sub-hint">No DVD ID detected in the current video file name.</p>
            )}
            {playerSubSearching && (
              <p className="player-sub-hint">Searching SubtitleCat…</p>
            )}
            {!playerSubSearching && playerSubtitles.length === 0 && playerSubSearchQuery && (
              <p className="player-sub-hint">
                {playerSubHasSearched
                  ? `No results for "${playerSubSearchQuery}".`
                  : "Press Search to find subtitles."}
              </p>
            )}

            {playerSubtitles.map((sub) => (
              <div key={sub.id} className="player-sub-result">
                <div className="player-sub-result-info">
                  <span className="player-sub-result-title">{sub.title}</span>
                  <span className="player-sub-result-lang">{sub.language}</span>
                  {sub.downloads > 0 && (
                    <span className="player-sub-result-downloads">⬇ {sub.downloads}</span>
                  )}
                </div>
                <button
                  className="player-sub-download-btn"
                  type="button"
                  disabled={playerSubDownloadingId === sub.id}
                  onClick={() => void handleDownloadSubtitle(sub)}
                >
                  {playerSubDownloadingId === sub.id ? "…" : "Download"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
// --- Add state for subtitle search query and initialize with videoId + title ---
// (Insert this at the top of the component, after other useState declarations)
//
// const [playerSubSearchQuery, setPlayerSubSearchQuery] = React.useState("");
// React.useEffect(() => {
//   if (playerMovie) {
//     setPlayerSubSearchQuery(
//       [playerMovie.videoId, playerMovie.title].filter(Boolean).join(" ")
//     );
//   }
// }, [playerMovie]);
}
