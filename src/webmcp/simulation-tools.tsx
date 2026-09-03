import { useMemo, useRef } from "react";
import { z } from "zod";

import type { AnalysisLayer } from "../app/ViewportModeToolbar";
import type { FoundationBranch } from "./schemas";
import { flightFrameAt, FLIGHT_SCENARIOS, type FlightMotor, type FlightScenarioId } from "../simulation/flight-scenarios";
import type { FoundationToolDefinition } from "./register-tools";
import { useFoundationTools } from "./use-foundation-tools";
import type { WebMCPToolResponse } from "./protocol";
import { serializeToolFacts, toolFactsFit } from "./tool-output";

const RevisionSchema = z.string().regex(/^[0-9a-f]{64}$/);
const SimulationDisplaySchema = z.enum(["loads", "stress", "displacement"]);
const SimulationGeometrySchema = z.enum(["frame-only", "full-assembly"]);
const ReviewTopologyCaseInputSchema = z.object({
  branchRevision: RevisionSchema,
  caseId: z.enum(["hover", "roll", "pitch", "yaw"]),
  display: SimulationDisplaySchema,
  geometry: SimulationGeometrySchema,
}).strict();

export interface SimulationViewCommand {
  readonly scenario: FlightScenarioId;
  readonly analysisLayer: Extract<AnalysisLayer, "loads" | "stress" | "displacement">;
  readonly componentsVisible: boolean;
}

interface SimulationToolOptions {
  readonly candidate?: FoundationBranch;
  readonly contextRevision: string;
  readonly motors: readonly FlightMotor[];
  readonly massKg: number;
  readonly onViewCommand: (command: SimulationViewCommand) => void;
  readonly presentationHoldMs?: number;
}
type SimulationToolSource = SimulationToolOptions | (() => SimulationToolOptions);

const PRESENTATION_HOLD_MS = 1_200;

const inputSchema = {
  type: "object",
  properties: {
    branchRevision: { type: "string", pattern: "^[0-9a-f]{64}$", description: "Exact visible topology candidate revision." },
    caseId: { type: "string", enum: ["hover", "roll", "pitch", "yaw"], description: "Named deterministic assembly load case." },
    display: { type: "string", enum: ["loads", "stress", "displacement"], description: "Result layer to show on the candidate." },
    geometry: { type: "string", enum: ["frame-only", "full-assembly"], description: "Candidate alone or with mounted components." },
  },
  required: ["branchRevision", "caseId", "display", "geometry"],
  additionalProperties: false,
} as const;

const response = (facts: unknown, isError = false): WebMCPToolResponse => {
  const bounded = toolFactsFit(facts)
    ? facts
    : { error: "Tool output exceeded the 1500 character safety limit." };
  return {
    content: [{ type: "text", text: serializeToolFacts(bounded) }],
    ...((isError || bounded !== facts) ? { isError: true } : {}),
  };
};

const errorMessage = (error: unknown) => error instanceof z.ZodError
  ? error.issues[0]?.message ?? "Invalid tool input"
  : error instanceof Error ? error.message : String(error);

const maximum = (values: Float32Array): number => values.reduce(
  (peak, value) => Math.max(peak, value), 0,
);

function candidateUnavailableReason(options: SimulationToolOptions): string | undefined {
  const result = options.candidate?.result;
  if (options.motors.length !== 4) return "the current assembly does not expose four motor mounts";
  if (!(options.massKg > 0)) return "the current assembly mass is unavailable";
  if (!options.candidate) return "no topology candidate is visible";
  if (options.candidate.parentRevision !== options.contextRevision) return "the visible candidate targets an older assembly revision";
  if (options.candidate.stale) return "the visible candidate is stale";
  if (result?.status !== "estimate" && result?.status !== "verified") return "the visible candidate has no reviewable result";
  const missing = FLIGHT_SCENARIOS.filter(
    ({ solverCase }) => result.analysis?.cases?.[solverCase] === undefined,
  ).map(({ solverCase }) => solverCase);
  return missing.length > 0 ? `the candidate is missing case fields: ${missing.join(", ")}` : undefined;
}

async function reviewTopologyCase(
  input: unknown,
  options: SimulationToolOptions,
): Promise<WebMCPToolResponse> {
  try {
    const parsed = ReviewTopologyCaseInputSchema.parse(input);
    const candidate = options.candidate;
    const unavailable = candidateUnavailableReason(options);
    if (unavailable || !candidate?.result
      || (candidate.result.status !== "estimate" && candidate.result.status !== "verified")) {
      throw new Error(`No exact current topology candidate with deterministic case fields is available: ${unavailable ?? "unknown reason"}.`);
    }
    if (parsed.branchRevision !== candidate.branchRevision) {
      throw new Error("branchRevision must match the exact visible candidate revision.");
    }
    const scenario = FLIGHT_SCENARIOS.find(({ id }) => id === parsed.caseId)!;
    const fields = candidate.result.analysis?.cases?.[scenario.solverCase];
    if (!fields) throw new Error(`The candidate has no ${scenario.solverCase} estimate fields.`);
    const replay = flightFrameAt(parsed.caseId, 0.25, options.motors, options.massKg);
    options.onViewCommand({
      scenario: parsed.caseId,
      analysisLayer: parsed.display,
      componentsVisible: parsed.geometry === "full-assembly",
    });
    const holdMs = options.presentationHoldMs ?? PRESENTATION_HOLD_MS;
    if (holdMs > 0) await new Promise((resolve) => setTimeout(resolve, holdMs));
    return response({
      status: "displayed",
      branchRevision: candidate.branchRevision,
      caseId: parsed.caseId,
      structuralCase: scenario.solverCase,
      display: parsed.display,
      geometry: parsed.geometry,
      candidateTruth: candidate.result.status === "estimate" ? "interactive-estimate" : "bounded-output-checks-passed",
      structuralEstimate: {
        maximumDisplacementM: maximum(fields.displacement),
        maximumAxialStressPa: maximum(fields.stress),
      },
      replaySample: {
        timeS: replay.timeS,
        loadFactorG: replay.loadFactorG,
        resultantForceN: replay.resultantForceN,
        resultantTorqueNm: replay.resultantTorqueNm,
      },
      humanDecision: { verified: false, accepted: false, nextAction: "human_review" },
      boundary: "Interactive candidate estimate and deterministic assembly replay; not verified continuum FEA, topology validation, or flight approval.",
    });
  } catch (error) {
    return response({ error: errorMessage(error) }, true);
  }
}

export function simulationToolDefinitions(
  source: SimulationToolSource,
): readonly [FoundationToolDefinition] {
  const current = () => typeof source === "function" ? source() : source;
  const options = current();
  return [{
    name: "review_topology_case",
    description: "Display one named deterministic replay and structural estimate case on the exact visible topology candidate, returning bounded metrics for agent review. Human approval remains required.",
    inputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    execute: (input) => reviewTopologyCase(input, current()),
    enabled: options.motors.length === 4 && options.massKg > 0,
  }];
}

export function SimulationAgentTools(options: SimulationToolOptions) {
  const current = useRef(options);
  current.current = options;
  const definitions = useMemo(
    () => simulationToolDefinitions(() => current.current),
    [],
  );
  const { supported, registered, errors } = useFoundationTools(definitions);
  return <section aria-labelledby="webmcp-simulation-status">
    <h2 id="webmcp-simulation-status">Simulation agent status</h2>
    <p role="status">{supported
      ? `${registered} of 1 simulation review tools registered.`
      : "WebMCP is unavailable in this browser context."}</p>
    {errors.map((error) => <p role="alert" key={error}>{error}</p>)}
  </section>;
}
