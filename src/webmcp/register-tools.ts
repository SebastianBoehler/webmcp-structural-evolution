import type { WebMCPOptions } from "use-webmcp-tool";

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

export type FoundationToolDefinition = WebMCPOptions<unknown, unknown> & {
  readonly annotations: {
    readonly readOnlyHint: boolean;
    readonly untrustedContentHint: true;
  };
  readonly enabled: boolean;
};

function canCompare(state: FoundationProjectState): boolean {
  const parents = new Map<string, number>();
  for (const branch of state.stagedBranches) {
    if (branch.status !== "verified" || branch.stale) continue;
    parents.set(branch.parentRevision, (parents.get(branch.parentRevision) ?? 0) + 1);
  }
  return [...parents.values()].some((count) => count >= 2);
}

export function foundationToolDefinitions(
  services: FoundationServices,
  state: FoundationProjectState,
): readonly [FoundationToolDefinition, FoundationToolDefinition, FoundationToolDefinition] {
  const untrustedContentHint = true as const;
  return [
    {
      name: "inspect_design_context",
      description: "Inspect the exact active foundation context, locks, branches, capability, stale state, and valid next actions.",
      inputSchema: inspectInputJsonSchema,
      annotations: { readOnlyHint: true, untrustedContentHint },
      execute: (input) => inspectDesignContext(input, services),
      enabled: true,
    },
    {
      name: "run_foundation_probe",
      description: "Stage and execute one bounded deterministic foundation compute probe from the exact current revision.",
      inputSchema: runInputJsonSchema,
      annotations: { readOnlyHint: false, untrustedContentHint },
      execute: (input) => runFoundationProbe(input, services),
      enabled: state.capability.status === "available" && state.operationStatus === "idle",
    },
    {
      name: "compare_foundation_probes",
      description: "Compare measured verification and timing facts for two exact verified non-stale foundation probe branches.",
      inputSchema: compareInputJsonSchema,
      annotations: { readOnlyHint: true, untrustedContentHint },
      execute: (input) => compareFoundationProbes(input, services),
      enabled: canCompare(state),
    },
  ];
}
