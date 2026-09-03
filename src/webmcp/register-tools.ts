import {
  compareFoundationProbes,
  inspectDesignContext,
  runFoundationProbe,
  type FoundationServices,
} from "./executors";
import {
  compareInputJsonSchema,
  inspectInputJsonSchema,
  runInputJsonSchema,
  type FoundationProjectState,
} from "./schemas";
import { hasComparableBranches } from "./comparability";
import type { ModelContextTool } from "./protocol";
import type { LayoutAuthority } from "../assembly/layout-validation";
import { topologyLayoutIsVerified } from "../assembly/layout-probe-authority";

export type FoundationToolDefinition = ModelContextTool & {
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly untrustedContentHint: true;
  };
  readonly enabled: boolean;
};

export function foundationToolDefinitions(
  services: FoundationServices,
  state: FoundationProjectState,
  layoutAuthority?: LayoutAuthority,
): readonly [FoundationToolDefinition, FoundationToolDefinition, FoundationToolDefinition] {
  const untrustedContentHint = true as const;
  return [
    {
      name: "inspect_design_context",
      description: "Inspect the current design context snapshot, locks, accepted and staged candidate revisions, capability, staleness, and valid next actions.",
      inputSchema: inspectInputJsonSchema,
      annotations: { readOnlyHint: true, untrustedContentHint },
      execute: (input) => inspectDesignContext(input, services),
      enabled: true,
    },
    {
      name: "generate_topology_candidate",
      description: "Generate a deterministic topology candidate for the exact current assembly using the selected material/compliance tradeoff. The result remains a reviewable branch.",
      inputSchema: runInputJsonSchema,
      annotations: { readOnlyHint: false, untrustedContentHint },
      execute: (input, options) => runFoundationProbe(input, services, options?.signal),
      enabled: state.capability.status === "available" && state.operationStatus === "idle"
        && topologyLayoutIsVerified(layoutAuthority),
    },
    {
      name: "compare_topology_candidates",
      description: "Compare compliance, material fraction, displacement, timing, and identity for two exact non-stale topology candidates.",
      inputSchema: compareInputJsonSchema,
      annotations: { readOnlyHint: true, untrustedContentHint },
      execute: (input) => compareFoundationProbes(input, services),
      enabled: hasComparableBranches(state.stagedBranches),
    },
  ];
}
