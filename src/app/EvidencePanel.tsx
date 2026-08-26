import type { FoundationProjectState, ProbeComparisonFacts } from "../webmcp/schemas";

export interface EvidencePanelProps {
  readonly state: FoundationProjectState;
  readonly comparison?: ProbeComparisonFacts;
  readonly initialAcceptedRevision: string;
}

export function EvidencePanel({ state, comparison, initialAcceptedRevision }: EvidencePanelProps) {
  const latest = state.stagedBranches.at(-1);
  const latestVerified = [...state.stagedBranches].reverse().find(
    (branch) => branch.status === "verified" && branch.measurement,
  );
  const stale = state.stagedBranches.some((branch) => branch.stale);
  const humanPromoted = state.acceptedBranchRevision !== initialAcceptedRevision;

  return (
    <section className="evidence-panel" aria-labelledby="evidence-title">
      <div className="section-heading">
        <p className="eyebrow">Evidence boundary</p>
        <h2 id="evidence-title">Prediction stays separate from proof</h2>
      </div>
      <div className="evidence-grid">
        <article className="evidence-card evidence-card--prediction">
          <p className="evidence-card__label">Agent prediction</p>
          {latest
            ? <><p>{latest.prediction}</p><small>Hypothesis: {latest.hypothesis}</small></>
            : <p>No branch prediction has been staged.</p>}
        </article>

        <article className="evidence-card evidence-card--measured">
          <p className="evidence-card__label">Measured evidence</p>
          {latestVerified?.measurement
            ? <>
                <p>Verified against the Wasm oracle.</p>
                <small>
                  {latestVerified.measurement.elapsedMs.toFixed(2)} ms · relative L2 {latestVerified.measurement.relativeL2 ?? "n/a"}
                </small>
              </>
            : latest && (latest.status === "failed" || latest.status === "mismatch")
              ? <p role="alert">{latest.measurement?.message ?? `${latest.status} probe result`}</p>
              : <p>No measured result is available.</p>}
        </article>

        <article className={`evidence-card ${stale ? "evidence-card--stale" : ""}`}>
          <p className="evidence-card__label">Plan state</p>
          <p>{stale ? "The prior experiment plan is stale after human intervention." : "Current branch plans match the active human context."}</p>
        </article>

        <article className="evidence-card">
          <p className="evidence-card__label">Human authority</p>
          {humanPromoted
            ? <p>Human-promoted configuration: <code>{state.acceptedBranchRevision}</code></p>
            : <p>No experiment is accepted. Promotion is human-only.</p>}
        </article>
      </div>

      {comparison && (
        <article className="comparison-receipt" aria-label="Measured branch comparison">
          <h3>Measured branch comparison</h3>
          <p>Exact shared parent: <code>{comparison.parentRevision}</code></p>
          <dl>
            <div><dt>Timing delta</dt><dd>{comparison.timingDeltaMs.toFixed(2)} ms</dd></div>
            <div><dt>Relative L2 delta</dt><dd>{comparison.relativeL2Delta}</dd></div>
          </dl>
        </article>
      )}

      <p className="scope-boundary"><strong>Compute foundation—not structural optimization.</strong> This verifies browser compute, Wasm agreement, immutable evidence, and agent tooling; it does not claim FEM, topology optimization, or structural validity.</p>
    </section>
  );
}
