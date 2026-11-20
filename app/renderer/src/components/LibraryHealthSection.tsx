import { useCallback, useEffect, useState } from "react";
import type { FtsHealth, MovieRecord } from "../../../shared/contracts";

interface MissingActionState {
  busyId: string | null;
}

function formatStamp(iso: string | null): string {
  if (!iso) {
    return "never";
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** Settings panel for library health: the periodic missing-file sweep,
 *  the search-index (FTS trigram) readout, and per-movie relink/forget
 *  actions for entries whose source file has disappeared. */
export function LibraryHealthSection() {
  const [health, setHealth] = useState<FtsHealth | null>(null);
  const [missing, setMissing] = useState<MovieRecord[]>([]);
  const [checking, setChecking] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<MissingActionState["busyId"]>(null);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      // One sweep both fresh-stats the library (returning the missing list)
      // and re-syncs the search index, so the health readout that follows
      // reflects the same pass.
      const missingMovies = await window.desktopApi.sweepMissingMovies();
      const nextHealth = await window.desktopApi.getFtsHealth();
      setMissing(missingMovies);
      setHealth(nextHealth);
      setStatus(
        missingMovies.length > 0
          ? `Sweep finished — ${missingMovies.length} movie${missingMovies.length === 1 ? "" : "s"} missing its source file.`
          : "Sweep finished — every source file is present."
      );
    } catch {
      setStatus("Sweep failed — see the app logs.");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      const rebuilt = await window.desktopApi.rebuildFtsIndex();
      const nextHealth = await window.desktopApi.getFtsHealth();
      setHealth(nextHealth);
      setStatus(
        rebuilt
          ? `Search index rebuilt — ${nextHealth.ftsCount} of ${nextHealth.movieCount} movies indexed.`
          : "Search index not used on this build; search runs on the LIKE path."
      );
    } catch {
      setStatus("Rebuild failed — see the app logs.");
    } finally {
      setRebuilding(false);
    }
  };

  const handleRelink = async (movie: MovieRecord) => {
    if (busyId) {
      return;
    }
    setBusyId(movie.id);
    try {
      const result = await window.desktopApi.relinkMissingMovie(movie.id);
      if (result.ok) {
        setStatus(`Relinked "${movie.title}" to ${result.sourcePath}`);
        await refresh();
      } else if (result.error) {
        setStatus(result.error);
      }
      // Cancelled pickers change nothing.
    } catch {
      setStatus("Relink failed — see the app logs.");
    } finally {
      setBusyId(null);
    }
  };

  const handleForget = async (movie: MovieRecord) => {
    if (busyId) {
      return;
    }
    if (!window.confirm(`Forget "${movie.title}"? Only the library entry is removed; no file on disk is touched.`)) {
      return;
    }
    setBusyId(movie.id);
    try {
      const result = await window.desktopApi.forgetMissingMovie(movie.id);
      setStatus(result.deleted ? `Removed "${movie.title}" from the library.` : "Entry was no longer missing; nothing removed.");
      await refresh();
    } catch {
      setStatus("Forget failed — see the app logs.");
    } finally {
      setBusyId(null);
    }
  };

  const recentSweeps = health?.recentSweeps.slice(0, 5) ?? [];

  return (
    <div className="panel">
      <p className="eyebrow">Library health</p>
      <h3>Missing files &amp; search index</h3>
      <p className="subtle">
        A background sweep runs every 30 seconds and flags library entries whose
        video file is gone from disk; flagged entries are hidden from the library
        and search until the file returns or you relink/remove them here.
      </p>

      <ul className="plain-list">
        <li>
          Search index:{" "}
          {health
            ? health.available
              ? "FTS5 trigram (active)"
              : "unavailable — search uses the LIKE path"
            : "loading…"}
        </li>
        {health?.available && (
          <li>
            Indexed {health.ftsCount} of {health.movieCount} movies
            {health.ftsCount !== health.movieCount ? " — out of sync, rebuild recommended" : ""}
          </li>
        )}
        <li>Last sweep: {formatStamp(health?.lastSweepAt ?? null)}</li>
        <li>Last index rebuild: {formatStamp(health?.lastRebuildAt ?? null)}</li>
      </ul>

      {recentSweeps.length > 0 && (
        <ul className="plain-list">
          {recentSweeps.map((sample, index) => (
            <li key={`${sample.at}-${index}`}>
              {formatStamp(sample.at)} — {sample.durationMs} ms, {sample.changedRows} change
              {sample.changedRows === 1 ? "" : "s"}
            </li>
          ))}
        </ul>
      )}

      <div className="inline-actions">
        <button
          className="secondary-button"
          disabled={checking || rebuilding}
          onClick={() => void refresh()}
          type="button"
        >
          {checking ? "Sweeping…" : "Check now"}
        </button>
        <button
          className="secondary-button"
          disabled={checking || rebuilding}
          onClick={() => void handleRebuild()}
          type="button"
        >
          {rebuilding ? "Rebuilding…" : "Rebuild search index"}
        </button>
      </div>
      {status && (
        <p className="subtle" aria-live="polite">
          {status}
        </p>
      )}

      <h3 style={{ marginTop: "0.75rem" }}>Missing source files</h3>
      {missing.length === 0 ? (
        <p className="muted-inline">No missing source files.</p>
      ) : (
        <ul className="plain-list">
          {missing.map((movie) => (
            <li key={movie.id}>
              <strong>{movie.displayName ?? movie.title}</strong>
              <span style={{ wordBreak: "break-all" }}>{movie.sourcePath}</span>
              <span className="inline-actions">
                <button
                  className="secondary-button"
                  disabled={busyId !== null}
                  onClick={() => void handleRelink(movie)}
                  type="button"
                >
                  {busyId === movie.id ? "Working…" : "Relink…"}
                </button>
                <button
                  className="ghost-button"
                  disabled={busyId !== null}
                  onClick={() => void handleForget(movie)}
                  type="button"
                >
                  Forget
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
