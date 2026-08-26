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

  return (
    <section aria-labelledby="experiment-rail-title">
      <h2 id="experiment-rail-title">Experiment branches</h2>
      {error && <p role="alert">{error}</p>}
      <table aria-label="Experiment branches">
        <thead>
          <tr>
            <th>Execution</th><th>Parent</th><th>Prediction</th><th>Measurement</th><th>Status</th><th>Human action</th>
          </tr>
        </thead>
        <tbody>
          {state.stagedBranches.map((branch) => (
            <tr key={branch.branchRevision}>
              <td>
                <span>Attempt {branch.attempt}</span><br />
                <span>Proposal {branch.proposalRevision}</span><br />
                <span>Branch {branch.branchRevision}</span>
              </td>
              <td>{branch.parentRevision}</td>
              <td><strong>{branch.hypothesis}</strong><br />{branch.prediction}</td>
              <td>{branch.measurement
                ? `${branch.measurement.status}; ${branch.measurement.elapsedMs.toFixed(2)} ms; L2 ${branch.measurement.relativeL2 ?? "n/a"}`
                : "Not measured"}</td>
              <td>{branch.stale ? "Stale" : branch.status}</td>
              <td>
                <button
                  type="button"
                  disabled={branch.status !== "verified" || branch.stale}
                  onClick={() => void promote(branch.branchRevision)}
                >Promote branch</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
