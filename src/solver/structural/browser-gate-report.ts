import { z } from "zod";
import { revisionId } from "../../domain/revisions";

import {
  STRUCTURAL_FORCE_BALANCE_TOLERANCE, STRUCTURAL_RESIDUAL_TOLERANCE,
  STRUCTURAL_VERIFICATION_METADATA, STRUCTURAL_WASM_L2_TOLERANCE,
} from "./structural-contract";

const digest = z.string().regex(/^[0-9a-f]{64}$/);
const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const positive = finite.positive();
const grid = z.object({
  dimensions: z.tuple([z.number().int().positive(), z.number().int().positive(), z.number().int().positive()]),
  activeCells: z.number().int().positive(), cellSizeM: positive,
}).strict();
const numericalShape = z.object({
  iterations: z.number().int().positive(), relativeResidual: nonnegative,
  recomputedF32RelativeResidual: nonnegative,
  gpuReactionBalanceErrorN: nonnegative, wasmForceBalanceErrorN: nonnegative,
  wasmReactionN: z.tuple([finite, finite, finite]),
  appliedLoadN: positive, wasmRelativeL2: nonnegative,
  wasmFieldStressRelativeL2: nonnegative, energyRelativeMismatch: nonnegative,
  maximumDisplacementM: nonnegative, maximumVonMisesStressPa: nonnegative,
}).strict();
const numerical = numericalShape.superRefine((value, context) => {
  if (value.relativeResidual > STRUCTURAL_RESIDUAL_TOLERANCE) {
    context.addIssue({ code: "custom", message: "Structural residual exceeds the locked threshold" });
  }
  if (value.wasmForceBalanceErrorN > value.appliedLoadN * STRUCTURAL_FORCE_BALANCE_TOLERANCE) {
    context.addIssue({ code: "custom", message: "Structural force balance exceeds the locked threshold" });
  }
  if (value.wasmRelativeL2 > STRUCTURAL_WASM_L2_TOLERANCE) {
    context.addIssue({ code: "custom", message: "Structural Wasm agreement exceeds the locked threshold" });
  }
  if (value.wasmFieldStressRelativeL2 > STRUCTURAL_WASM_L2_TOLERANCE) {
    context.addIssue({ code: "custom", message: "Structural field-stress agreement exceeds the locked threshold" });
  }
  if (value.energyRelativeMismatch > STRUCTURAL_VERIFICATION_METADATA.thresholds.energyRelativeMismatch) {
    context.addIssue({ code: "custom", message: "Structural energy mismatch exceeds the locked threshold" });
  }
});
const consoleEvidence = z.object({
  statusLines: z.array(z.string().min(1)), warningCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
}).strict();

const structuralCase = z.object({
  exactBrepArtifactId: digest, semanticMeshArtifactId: digest, voxelArtifactId: digest,
  bindingDigest: digest,
  grid, numerical,
  analytical: z.object({
    expectedDisplacementM: positive, measuredDisplacementM: positive,
    relativeError: nonnegative, tolerance: positive,
    component: z.enum(["x", "y", "z"]), loadedNodeCount: z.number().int().positive(),
  }).strict(),
  timingMs: nonnegative,
}).strict().superRefine((value, context) => {
  if (value.analytical.relativeError > value.analytical.tolerance) {
    context.addIssue({ code: "custom", message: "Structural analytical error exceeds its locked threshold" });
  }
});

const extraction = z.object({
  closed: z.literal(true), oriented: z.literal(true),
  requiredInterfacesConnected: z.literal(true), protectedVoidsClear: z.literal(true),
  minimumFeatureSatisfied: z.literal(true),
}).strict();
const topologyCase = z.object({
  exactBrepArtifactId: digest, semanticMeshArtifactId: digest, voxelArtifactId: digest,
  manufacturingMeshArtifactId: digest, rerasterizedVoxelArtifactId: digest,
  bindingDigest: digest,
  grid, objectiveHistoryJ: z.array(positive).min(2), materialFraction: positive.max(1),
  targetVolumeFraction: positive.lt(1), initialActiveCells: z.number().int().positive(),
  finalActiveCells: z.number().int().positive(), rerasterMatchesFinalMask: z.literal(true),
  extraction, postAnalysis: numerical,
  configuredLimits: z.object({
    maximumDisplacementM: positive, maximumVonMisesStressPa: positive,
    minimumSafetyFactor: positive, maximumMaterialFraction: positive.lt(1),
    measuredSafetyFactor: positive,
  }).strict(),
  auditDecision: z.object({
    eligible: z.literal(true), accepted: z.literal(false), exportable: z.literal(false),
  }).strict(),
  timingMs: nonnegative,
}).strict().superRefine((value, context) => {
  if (value.finalActiveCells >= value.initialActiveCells
    || value.finalActiveCells !== Math.round(value.targetVolumeFraction * value.initialActiveCells)) {
    context.addIssue({ code: "custom", message: "Live topology must remove material to the exact sub-unity target" });
  }
  for (let index = 1; index < value.objectiveHistoryJ.length; index += 1) {
    if (value.objectiveHistoryJ[index]! < value.objectiveHistoryJ[index - 1]! * (1 - 1e-5)) {
      context.addIssue({ code: "custom", message: "Topology compliance decreased during material removal" });
    }
  }
  const limits = value.configuredLimits;
  if (value.postAnalysis.maximumDisplacementM > limits.maximumDisplacementM
    || value.postAnalysis.maximumVonMisesStressPa > limits.maximumVonMisesStressPa
    || limits.measuredSafetyFactor < limits.minimumSafetyFactor
    || value.materialFraction > limits.maximumMaterialFraction) {
    context.addIssue({ code: "custom", message: "Topology post-analysis exceeds revision-owned limits" });
  }
});

const passed = z.object({
  status: z.literal("passed"), evidenceSource: z.literal("live-browser-webgpu"),
  realGpu: z.literal(true), auditOnly: z.literal(true),
  sessionId: digest,
  recordedAt: z.string().datetime(),
  device: z.object({
    vendor: z.string(), architecture: z.string(), device: z.string(), description: z.string(),
    features: z.array(z.string()),
    acquisitionCount: z.number().int().positive(),
    limits: z.object({
      maxBufferSize: positive, maxStorageBufferBindingSize: positive,
      maxComputeWorkgroupsPerDimension: positive, maxComputeInvocationsPerWorkgroup: positive,
    }).strict(),
  }).strict(),
  thresholds: z.object({
    relativeResidual: z.literal(STRUCTURAL_RESIDUAL_TOLERANCE),
    relativeForceBalance: z.literal(STRUCTURAL_FORCE_BALANCE_TOLERANCE),
    wasmRelativeL2: z.literal(STRUCTURAL_WASM_L2_TOLERANCE),
    axialRelativeError: z.literal(STRUCTURAL_VERIFICATION_METADATA.thresholds.axialRelativeError),
    cantileverRelativeError: z.literal(STRUCTURAL_VERIFICATION_METADATA.thresholds.cantileverRelativeError),
  }).strict(),
  structural: z.object({ axial: structuralCase, cantilever: structuralCase }).strict(),
  topology: z.object({ drone: topologyCase, cobot: topologyCase }).strict(),
  cancellation: z.object({
    outcome: z.literal("cancelled"), lateTerminal: z.literal(false),
    artifactsCommitted: z.literal(0), recoveryRunPassed: z.literal(true), timingMs: nonnegative,
  }).strict(),
  gpuDiagnostics: z.object({
    identitiesMatched: z.literal(true), uncapturedErrorCount: z.literal(0),
    errorScopesClean: z.literal(true), deviceLost: z.literal(false),
  }).strict(),
  timingsMs: z.object({ total: nonnegative }).strict(), console: consoleEvidence,
}).strict().superRefine((value, context) => {
  if (value.topology.drone.exactBrepArtifactId === value.topology.cobot.exactBrepArtifactId
    || value.topology.drone.voxelArtifactId === value.topology.cobot.voxelArtifactId
    || JSON.stringify(value.topology.drone.grid) === JSON.stringify(value.topology.cobot.grid)) {
    context.addIssue({ code: "custom", message: "Drone and cobot topology geometries must be genuinely distinct" });
  }
  if (value.console.statusLines.length === 0 || value.console.errorCount !== 0) {
    context.addIssue({ code: "custom", message: "Live console evidence is incomplete or contains errors" });
  }
  if (value.console.warningCount !== 0) {
    context.addIssue({ code: "custom", message: "Live gate emitted console warnings" });
  }
  if (value.structural.axial.analytical.tolerance
      !== STRUCTURAL_VERIFICATION_METADATA.thresholds.axialRelativeError
    || value.structural.cantilever.analytical.tolerance
      !== STRUCTURAL_VERIFICATION_METADATA.thresholds.cantileverRelativeError) {
    context.addIssue({ code: "custom", message: "Analytical tolerances are not locked to gate thresholds" });
  }
});

const blocked = z.object({
  status: z.literal("blocked"), evidenceSource: z.literal("live-browser-webgpu"),
  blocker: z.object({ stage: z.string().min(1), message: z.string().min(1) }).strict(),
  console: consoleEvidence,
}).strict();

export type StructuralTopologyGateReport = z.infer<typeof passed> | z.infer<typeof blocked>;

export function parseStructuralTopologyGateReport(value: unknown): StructuralTopologyGateReport {
  if (!value || typeof value !== "object") throw new Error("Structural topology gate report is invalid");
  const candidate = value as Record<string, unknown>;
  if (candidate.status === "passed") {
    const topology = candidate.topology as Record<string, unknown> | undefined;
    if (topology !== undefined && (!topology.drone || !topology.cobot)) {
      throw new Error("A passed report requires both drone and cobot topology evidence");
    }
    if (candidate.evidenceSource !== "live-browser-webgpu"
      || candidate.realGpu !== true) {
      throw new Error("A passed report requires live browser WebGPU authority");
    }
    if (!topology?.drone || !topology.cobot) {
      throw new Error("A passed report requires both drone and cobot topology evidence");
    }
    return passed.parse(value);
  }
  try { return blocked.parse(value); }
  catch { throw new Error("A blocked report requires an exact blocker and console evidence"); }
}

export async function verifyStructuralTopologyGateReportDigest(
  report: StructuralTopologyGateReport,
): Promise<boolean> {
  if (report.status !== "passed") return false;
  const { sessionId, ...content } = report;
  return sessionId === await revisionId(content);
}
