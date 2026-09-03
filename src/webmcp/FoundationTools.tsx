import { useMemo } from "react";

import type { FoundationServices } from "./executors";
import { foundationToolDefinitions } from "./register-tools";
import type { FoundationProjectState } from "./schemas";
import { hasComparableBranches } from "./comparability";
import { useFoundationTools } from "./use-foundation-tools";
import type { LayoutAuthority } from "../assembly/layout-validation";

export interface FoundationToolsProps {
  readonly services: FoundationServices;
  readonly state: FoundationProjectState;
  readonly layoutAuthority?: LayoutAuthority;
}

export function FoundationTools({ services, state, layoutAuthority }: FoundationToolsProps) {
  const eligibility = `${state.capability.status}:${state.operationStatus}:${hasComparableBranches(state.stagedBranches)}:${layoutAuthority?.state}:${layoutAuthority?.revision}`;
  const definitions = useMemo(
    () => foundationToolDefinitions(services, state, layoutAuthority),
    [services, eligibility],
  );
  const { supported, registered, errors } = useFoundationTools(definitions);

  return (
    <section aria-labelledby="webmcp-foundation-status">
      <h2 id="webmcp-foundation-status">Agent tool status</h2>
      <p role="status">
        {supported
          ? `${registered} of 3 structural design tools registered.`
          : "WebMCP is unavailable in this browser context."}
      </p>
      {errors.map((error) => <p role="alert" key={error}>{error}</p>)}
    </section>
  );
}
