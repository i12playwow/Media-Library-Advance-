import { useCallback, useEffect, useRef, useState } from "react";
import type { GuardsChainSegment, GuardsChainState } from "../../../shared/contracts";

function shortDigest(digest: string): string {
  return `${digest.slice(0, 12)}…${digest.slice(-6)}`;
}

export function GuardsChainCard(props: {
  state: GuardsChainState | null;
  segments?: GuardsChainSegment[] | null;
  error?: string | null;
  onRefresh?: () => void;
}) {
  const { state, segments, error, onRefresh } = props;
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
      {segments !== undefined && segments !== null && segments.length > 0 ? (
        <ul className="plain-list">
          {segments.map((segment, index) => (
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
                  </li>
                ))}
              </ul>
            </li>
          ))}
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
  const [segments, setSegments] = useState<GuardsChainSegment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    Promise.all([
      window.desktopApi.getGuardsChainState(),
      window.desktopApi.listGuardsChainSegments()
    ])
      .then(([nextState, nextSegments]) => {
        refreshInFlight.current = false;
        setState(nextState);
        setSegments(nextSegments);
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
    <GuardsChainCard state={state} segments={segments} error={error} onRefresh={refresh} />
  );
}
