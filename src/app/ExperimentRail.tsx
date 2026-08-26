import { useState } from "react";

import type { FoundationProjectState } from "../webmcp/schemas";
import type { ExperimentRailApi } from "./useProjectState";

export interface ExperimentRailProps {
  readonly state: FoundationProjectState;
  readonly api: ExperimentRailApi;
}

export function ExperimentRail({ state, api }: ExperimentRailProps) {
  const [error, setError] = useState<string>();
  const promote = async (branchRevision: string) => {
    setError(undefined);
    try {
      await api.promoteBranch(branchRevision);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const title = (variant: string) => variant === "stiffness"
    ? "Stiffness-first frame"
    : `${variant[0]?.toUpperCase()}${variant.slice(1)} frame`;

  return (
    <section aria-labelledby="experiment-rail-title">
      <h2 id="experiment-rail-title">Experiment branches</h2>
      {error && <p role="alert">{error}</p>}
      <div className="branch-list" role="list" aria-label="Experiment branches">
        {state.stagedBranches.map((branch) => {
          const topology = branch.measurement?.topology;
          return <article className="branch-card" role="listitem" key={branch.branchRevision}>
            <div className="branch-card__summary">
              <div><h3>{title(branch.variant)}</h3><p>{branch.hypothesis}</p></div>
              <span data-status={branch.stale ? "stale" : branch.status}>{branch.stale ? "Stale" : branch.status}</span>
            </div>
            <div className="branch-metrics">
              <span><strong>{topology ? `${(topology.materialFraction * 100).toFixed(1)}%` : "—"}</strong> material</span>
              <span><strong>{topology ? topology.finalCompliance.toPrecision(4) : "—"}</strong> compliance</span>
              <span><strong>{branch.measurement ? `${branch.measurement.elapsedMs.toFixed(0)} ms` : "—"}</strong> solve</span>
            </div>
            <div className="branch-card__actions">
              <small>Attempt {branch.attempt}</small>
              <button type="button" disabled={branch.status !== "verified" || branch.stale}
                onClick={() => void promote(branch.branchRevision)}>Use this frame</button>
            </div>
            <details><summary>Technical identity</summary><dl>
              <div><dt>Parent</dt><dd><code>{branch.parentRevision}</code></dd></div>
              <div><dt>Proposal</dt><dd><code>{branch.proposalRevision}</code></dd></div>
              <div><dt>Candidate</dt><dd><code>{branch.branchRevision}</code></dd></div>
              <div><dt>Prediction</dt><dd>{branch.prediction}</dd></div>
            </dl></details>
          </article>;
        })}
      </div>
    </section>
  );
}
