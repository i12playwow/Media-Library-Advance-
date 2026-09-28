import { useCallback, useEffect, useRef, useState } from "react";
import type { GuardsChainSegmentsResult, GuardsChainState } from "../../../shared/contracts";

function shortDigest(digest: string): string {
  return `${digest.slice(0, 12)}…${digest.slice(-6)}`;
}

// Human-readable age next to each breakdown item's timestamp, computed
// against a configurable `now` (defaults to real time) so tests stay
// deterministic. Future timestamps clamp to "just now"; unparseable ones
// degrade to an em dash rather than NaN.
function ageOf(timestamp: string, now: Date = new Date()): string {
  const then = new Date(timestamp).getTime();
  if (!Number.isFinite(then)) return "—";
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days === 1 ? "1 day" : `${days} days`} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months === 1 ? "1 month" : `${months} months`} ago`;
  const years = Math.floor(months / 12);
  return `${years === 1 ? "1 year" : `${years} years`} ago`;
}

export function GuardsChainCard(props: {
  state: GuardsChainState | null;
  chain?: GuardsChainSegmentsResult | null;
  error?: string | null;
  onRefresh?: () => void;
  now?: Date;
}) {
  const { state, chain, error, onRefresh, now } = props;
  const showSegments = chain?.status === "verified" || chain?.status === "unverified";
  const unverified = chain?.status === "unverified";
  return (
    <div className="panel">
      <p className="eyebrow">Guards</p>
      <h3>Tamper-evident history</h3>
      {error ? (
        <p className="subtle">Chain state unavailable: {error}</p>
      ) : state === null ? (
        <p className="subtle">Verifying the guards log…</p>
      ) : (
        <ul className="plain-list">
          <li>
            Integrity:{" "}
            <strong>{state.ok ? "verified" : "FAILURE"}</strong>
            {state.ok
              ? " — every chained segment digests every byte before it."
              : " — the guards log failed its hash-chain replay. Run npm test for the named break."}
          </li>
          <li>Chained segments: {state.segments}</li>
          <li>Drill entries: {state.entries}</li>
          <li>
            Tip digest:{" "}
            {state.tipDigest ? (
              <code title={state.tipDigest}>{shortDigest(state.tipDigest)}</code>
            ) : (
              "—"
            )}
          </li>
          <li>Last verified run: {state.lastRun ?? "—"}</li>
          <li>Verified at: {state.verifiedAt}</li>
        </ul>
      )}
      {unverified ? (
        <p className="subtle">
          ⚠ Unverified breakdown — the hash-chain replay FAILED, so this
          history is shown for inspection only and may have been tampered
          with. Run npm test for the named break.
        </p>
      ) : null}
      {showSegments && chain.segments && chain.segments.length > 0 ? (
        <ul className="plain-list">
          {chain.segments ? (
            <>
              {chain.segments.map((segment, index) => (
            <li key={index}>
              <code title={segment.digest}>{segment.digest.slice(0, 12)}</code>{" "}
              <span className="subtle">
                {segment.kind === "entry" ? "drill entry" : "ci batch"} · entries{" "}
                {segment.entriesAtChain}
              </span>
              <ul>
                {segment.items.map((item, itemIndex) => (
                  <li key={itemIndex}>
                    {item.timestamp} — {item.verdict === "holds" ? "holds" : "BROKEN"}{" "}
                    <span className="subtle">({item.kind === "ci" ? "ci" : "drill"})</span>
                    <span className="subtle"> · {ageOf(item.timestamp, now)}</span>
                  </li>
                ))}
              </ul>
            </li>
              ))}
            </>
          ) : null}
        </ul>
      ) : null}
      {onRefresh ? (
        <div className="inline-actions">
          <button className="ghost-button" type="button" onClick={onRefresh}>
            Re-verify now
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function GuardsChainSection() {
  // Poll every 30s while mounted, so a tampered log turns the card red
  // without a manual refresh. The in-flight guard prevents overlapping
  // fetches when a poll lands while a Re-verify request is still running.
  const POLL_INTERVAL_MS = 30_000;
  const refreshInFlight = useRef(false);
  const [state, setState] = useState<GuardsChainState | null>(null);
  const [chain, setChain] = useState<GuardsChainSegmentsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    Promise.all([
      window.desktopApi.getGuardsChainState(),
      window.desktopApi.listGuardsChainSegments()
    ])
      .then(([nextState, nextChain]) => {
        refreshInFlight.current = false;
        setState(nextState);
        setChain(nextChain);
        setError(null);
      })
      .catch((err: unknown) => {
        refreshInFlight.current = false;
        setError(err instanceof Error ? err.message : String(err));
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Re-verify every 30s while Settings is open, so a tampered log turns
  // the card red without a manual refresh.
  useEffect(() => {
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return (
    <GuardsChainCard state={state} chain={chain} error={error} onRefresh={refresh} />
  );
}
