import { useCallback, useEffect, useState } from "react";
import type { GuardsChainState } from "../../../shared/contracts";

function shortDigest(digest: string): string {
  return `${digest.slice(0, 12)}…${digest.slice(-6)}`;
}

export function GuardsChainCard(props: {
  state: GuardsChainState | null;
  error?: string | null;
  onRefresh?: () => void;
}) {
  const { state, error, onRefresh } = props;
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
  const [state, setState] = useState<GuardsChainState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    window.desktopApi
      .getGuardsChainState()
      .then((next) => {
        setState(next);
        setError(null);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <GuardsChainCard state={state} error={error} onRefresh={refresh} />;
}
