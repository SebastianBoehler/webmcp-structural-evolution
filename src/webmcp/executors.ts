import type { WebMCPToolResponse } from "use-webmcp-tool";
import { ZodError } from "zod";

import {
  CompareFoundationProbesInputSchema,
  InspectContextInputSchema,
  RunFoundationProbeInputSchema,
  type CompareFoundationProbesInput,
  type FoundationBranch,
  type InspectContextFacts,
  type InspectContextInput,
  type ProbeComparisonFacts,
  type RunFoundationProbeInput,
} from "./schemas";
import { serializeToolFacts, TOOL_OUTPUT_LIMIT } from "./tool-output";

export interface FoundationServices {
  inspectContext(input: InspectContextInput): Promise<InspectContextFacts>;
  runProbe(input: RunFoundationProbeInput): Promise<FoundationBranch>;
  cancelProbe(): Promise<FoundationBranch>;
  compareProbes(input: CompareFoundationProbesInput): Promise<ProbeComparisonFacts>;
  canCompare(): boolean;
  recordRejectedCall(action: string, affectedRevision: string | null, error: string): Promise<void>;
}

function errorText(error: unknown): string {
  if (error instanceof ZodError) return error.issues[0]?.message ?? "Invalid tool input";
  return error instanceof Error ? error.message : String(error);
}

function affectedRevision(input: unknown): string | null {
  if (typeof input !== "object" || input === null || !("parentRevision" in input)) return null;
  const value = (input as { parentRevision?: unknown }).parentRevision;
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

function toolResponse(value: unknown, isError = false): WebMCPToolResponse {
  let text = serializeToolFacts(value);
  if (text.length > TOOL_OUTPUT_LIMIT) {
    text = JSON.stringify({ error: "Tool output exceeded the 1500 character safety limit." });
    isError = true;
  }
  return {
    content: [{ type: "text", text }],
    ...(isError ? { isError: true } : {}),
  };
}

async function rejected(
  action: string,
  input: unknown,
  error: unknown,
  services: FoundationServices,
): Promise<WebMCPToolResponse> {
  const message = errorText(error);
  await services.recordRejectedCall(action, affectedRevision(input), message);
  return toolResponse({ error: message }, true);
}

export async function inspectDesignContext(
  input: unknown,
  services: FoundationServices,
): Promise<WebMCPToolResponse> {
  let parsed: InspectContextInput;
  try {
    parsed = InspectContextInputSchema.parse(input);
  } catch (error) {
    return rejected("inspect_design_context", input, error, services);
  }
  try {
    return toolResponse(await services.inspectContext(parsed));
  } catch (error) {
    return toolResponse({ error: errorText(error) }, true);
  }
}

export async function runFoundationProbe(
  input: unknown,
  services: FoundationServices,
): Promise<WebMCPToolResponse> {
  let parsed: RunFoundationProbeInput;
  try {
    parsed = RunFoundationProbeInputSchema.parse(input);
  } catch (error) {
    return rejected("run_foundation_probe", input, error, services);
  }
  try {
    const branch = await services.runProbe(parsed);
    const facts = {
      parentRevision: branch.parentRevision,
      branchRevision: branch.branchRevision,
      variant: branch.variant,
      hypothesis: branch.hypothesis,
      prediction: branch.prediction,
      status: branch.status,
      stale: branch.stale,
      measurement: branch.measurement,
      nextActions: services.canCompare()
        ? ["inspect_design_context", "compare_foundation_probes"]
        : ["inspect_design_context"],
    };
    return toolResponse(facts, branch.status === "failed" || branch.status === "mismatch");
  } catch (error) {
    return toolResponse({ error: errorText(error) }, true);
  }
}

export async function compareFoundationProbes(
  input: unknown,
  services: FoundationServices,
): Promise<WebMCPToolResponse> {
  let parsed: CompareFoundationProbesInput;
  try {
    parsed = CompareFoundationProbesInputSchema.parse(input);
  } catch (error) {
    return rejected("compare_foundation_probes", input, error, services);
  }
  try {
    return toolResponse(await services.compareProbes(parsed));
  } catch (error) {
    return toolResponse({ error: errorText(error) }, true);
  }
}
