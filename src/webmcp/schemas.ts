import { z } from "zod";

import type { ActionReceipt } from "../domain/receipts";
import { RevisionSchema, type DeepReadonly } from "../domain/snapshots";
import type { GpuCapability } from "../gpu/capabilities";
import type { ProbeResult } from "../gpu/compute-probe";

const unsafeIntent = /https?:\/\/|<|>|(?:^|\s)\/[\w.-]|[A-Za-z]:\\|```|=>|\bfunction\s*\(/i;
const boundedText = z.string().trim().min(1).max(120).refine(
  (value) => !unsafeIntent.test(value),
  "Intent text cannot contain HTML, URLs, file paths, or code",
);
const structuralClaim = /\b(mass|weight|light(?:er)?|heavy|stiffness|rigid|flexible|compliance|stress|displacement|strength|load|force)\b/i;
const foundationPrediction = /\b(verif(?:y|ied|ication)|tim(?:e|ing)|budget|field|value|distribution|l2|mismatch|pass|fail)\b/i;

export const InspectContextInputSchema = z.object({
  scope: z.literal("current"),
}).strict();

export const ProbeVariantSchema = z.enum(["baseline", "edge-biased", "center-biased"]);

export const RunFoundationProbeInputSchema = z.object({
  parentRevision: RevisionSchema,
  variant: ProbeVariantSchema,
  hypothesis: boundedText,
  prediction: boundedText.refine(
    (value) => foundationPrediction.test(value) && !structuralClaim.test(value),
    "Prediction may describe verification, timing, or field behavior only",
  ),
}).strict();

export const CompareFoundationProbesInputSchema = z.object({
  leftRevision: RevisionSchema,
  rightRevision: RevisionSchema,
}).strict().refine(
  ({ leftRevision, rightRevision }) => leftRevision !== rightRevision,
  "Probe revisions must be distinct",
);

export type InspectContextInput = z.infer<typeof InspectContextInputSchema>;
export type RunFoundationProbeInput = z.infer<typeof RunFoundationProbeInputSchema>;
export type CompareFoundationProbesInput = z.infer<typeof CompareFoundationProbesInputSchema>;
export type ProbeVariant = z.infer<typeof ProbeVariantSchema>;

export interface ProbeMeasurement {
  readonly status: ProbeResult["status"];
  readonly elapsedMs: number;
  readonly relativeL2?: number;
  readonly resultDigest: string;
  readonly code?: string;
  readonly message?: string;
}

export interface FoundationBranch extends RunFoundationProbeInput {
  readonly branchRevision: string;
  readonly stale: boolean;
  readonly status: "staged" | "running" | ProbeResult["status"];
  readonly measurement?: ProbeMeasurement;
  readonly result?: ProbeResult;
}

export interface SemanticSelection {
  readonly id: string;
  readonly label: string;
}

export interface FoundationProjectState {
  readonly contextRevision: string;
  readonly selection: SemanticSelection;
  readonly locks: readonly string[];
  readonly acceptedBranchRevision: string;
  readonly stagedBranches: readonly FoundationBranch[];
  readonly capability: GpuCapability;
  readonly operationStatus: "idle" | "running";
  readonly receipts: readonly ActionReceipt[];
}

export type FrozenFoundationProjectState = DeepReadonly<FoundationProjectState>;

export interface InspectContextFacts {
  readonly contextRevision: string;
  readonly selection: SemanticSelection;
  readonly locks: readonly string[];
  readonly acceptedBranchRevision: string;
  readonly stagedBranches: readonly Pick<FoundationBranch,
    "parentRevision" | "branchRevision" | "hypothesis" | "prediction" | "status" | "stale" | "measurement"
  >[];
  readonly capability: GpuCapability;
  readonly stale: boolean;
  readonly nextActions: readonly string[];
}

export interface ProbeComparisonFacts {
  readonly parentRevision: string;
  readonly leftRevision: string;
  readonly rightRevision: string;
  readonly leftStatus: "verified";
  readonly rightStatus: "verified";
  readonly timingDeltaMs: number;
  readonly relativeL2Delta: number;
  readonly leftDigest: string;
  readonly rightDigest: string;
  readonly stale: false;
  readonly nextActions: readonly string[];
}

export const inspectInputJsonSchema = {
  type: "object",
  properties: {
    scope: { type: "string", enum: ["current"], description: "Inspect the exact current foundation context." },
  },
  required: ["scope"],
  additionalProperties: false,
} as const;

export const runInputJsonSchema = {
  type: "object",
  properties: {
    parentRevision: { type: "string", pattern: "^[0-9a-f]{64}$", description: "Exact current context revision." },
    variant: { type: "string", enum: ["baseline", "edge-biased", "center-biased"], description: "Bounded deterministic input field." },
    hypothesis: { type: "string", minLength: 1, maxLength: 120, pattern: "^(?!.*(?:https?://|<|>|```|=>|/[^ ]+)).+$", description: "Short reason for this probe branch." },
    prediction: { type: "string", minLength: 1, maxLength: 120, pattern: "^(?!.*(?:https?://|<|>|```|=>|/[^ ]+)).+$", description: "Expected verification, timing, or field behavior." },
  },
  required: ["parentRevision", "variant", "hypothesis", "prediction"],
  additionalProperties: false,
} as const;

export const compareInputJsonSchema = {
  type: "object",
  properties: {
    leftRevision: { type: "string", pattern: "^[0-9a-f]{64}$", description: "First exact verified branch revision." },
    rightRevision: { type: "string", pattern: "^[0-9a-f]{64}$", description: "Second exact verified branch revision." },
  },
  required: ["leftRevision", "rightRevision"],
  additionalProperties: false,
} as const;
