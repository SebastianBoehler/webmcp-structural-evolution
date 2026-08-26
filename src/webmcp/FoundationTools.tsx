import { useMemo } from "react";

import type { FoundationServices } from "./executors";
import { foundationToolDefinitions } from "./register-tools";
import type { FoundationProjectState } from "./schemas";
import { hasComparableBranches } from "./comparability";
import { useFoundationTools } from "./use-foundation-tools";

export interface FoundationToolsProps {
  readonly services: FoundationServices;
  readonly state: FoundationProjectState;
}

export function FoundationTools({ services, state }: FoundationToolsProps) {
  const eligibility = `${state.capability.status}:${state.operationStatus}:${hasComparableBranches(state.stagedBranches)}`;
  const definitions = useMemo(
    () => foundationToolDefinitions(services, state),
    [services, eligibility],
  );
  const { supported, registered, errors } = useFoundationTools(definitions);

  return (
    <section aria-labelledby="webmcp-foundation-status">
      <h2 id="webmcp-foundation-status">Agent tool status</h2>
      <p role="status">
        {supported
          ? `${registered} of 3 foundation tools registered.`
          : "WebMCP is unavailable in this browser context."}
      </p>
      {errors.map((error) => <p role="alert" key={error}>{error}</p>)}
    </section>
  );
}
