import {
  structuralVerificationMetadata,
  type StructuralResult,
} from "../structural/structural-contract";
import type {
  TopologyAcceptanceDecision,
  TopologyExtractionValidation,
} from "./topology-contract";

interface AcceptanceInput {
  readonly objectiveHistory: readonly number[];
  readonly materialFraction: number;
  readonly materialCount: number;
  readonly domainCount: number;
  readonly structuralSettings: unknown;
  readonly analysis: StructuralResult;
  readonly extraction: TopologyExtractionValidation;
  readonly constraints: Readonly<{
    maximumDisplacementM: number;
    maximumVonMisesStressPa: number;
    minimumSafetyFactor: number;
    maximumMaterialFraction: number;
  }>;
  readonly failureStressPa: number;
}

function finiteHistory(values: readonly number[]): boolean {
  return values.length > 0 && values.every((value, index) => Number.isFinite(value) && value > 0
    && (index === 0 || value >= values[index - 1]! * (1 - 1e-5)));
}

function coherentStructuralEvidence(result: StructuralResult, settings: unknown): boolean {
  const metrics = [
    result.iterations, result.complianceJ, result.strainEnergyJ,
    result.maximumDisplacementM, result.maximumVonMisesStressPa,
    result.verification.relativeResidual, result.verification.recomputedF32RelativeResidual,
    result.verification.gpuReactionBalanceErrorN, result.verification.wasmForceBalanceErrorN,
    result.verification.appliedLoadN,
    result.verification.wasmRelativeL2, result.verification.wasmFieldStressRelativeL2,
    result.verification.energyRelativeMismatch,
  ];
  return result.truthLevel === "interactive-estimate"
    && Number.isInteger(result.iterations) && result.iterations > 0
    && metrics.every((value) => Number.isFinite(value) && value >= 0)
    && result.verification.wasmReactionN.length === 3
    && result.verification.wasmReactionN.every(Number.isFinite)
    && result.displacementM instanceof Float32Array
    && result.vonMisesStressPa instanceof Float32Array
    && result.displacementM.length > 0 && result.vonMisesStressPa.length > 0
    && result.displacementM.every(Number.isFinite)
    && result.vonMisesStressPa.every((value) => Number.isFinite(value) && value >= 0)
    && Math.abs(result.strainEnergyJ * 2 - result.complianceJ)
      <= Math.max(1, result.complianceJ) * 1e-5
    && JSON.stringify(result.verification.metadata)
      === JSON.stringify(structuralVerificationMetadata(settings));
}

export function decideTopologyAcceptance(input: AcceptanceInput): TopologyAcceptanceDecision {
  const reasons: string[] = [];
  if (!finiteHistory(input.objectiveHistory)) {
    reasons.push("objective history is not positive and nondecreasing within numerical tolerance");
  }
  if (!input.extraction.closed) reasons.push("manufacturing mesh is not closed");
  if (!input.extraction.oriented) reasons.push("manufacturing mesh orientation is inconsistent");
  if (!input.extraction.requiredInterfacesConnected) reasons.push("required interfaces are disconnected");
  if (!input.extraction.protectedVoidsClear) reasons.push("protected voids are obstructed");
  if (!input.extraction.minimumFeatureSatisfied) reasons.push("minimum feature is violated");
  if (!coherentStructuralEvidence(input.analysis, input.structuralSettings)) {
    reasons.push("post-extraction structural evidence is incoherent");
  }
  if (!input.analysis.verification.realGpu) reasons.push("post-extraction analysis is not real WebGPU evidence");
  if (input.analysis.maximumDisplacementM > input.constraints.maximumDisplacementM) {
    reasons.push("post-extraction displacement exceeds the acceptance limit");
  }
  if (input.analysis.maximumVonMisesStressPa > input.constraints.maximumVonMisesStressPa) {
    reasons.push("post-extraction stress exceeds the acceptance limit");
  }
  const safetyFactor = input.analysis.maximumVonMisesStressPa === 0
    ? Number.POSITIVE_INFINITY
    : input.failureStressPa / input.analysis.maximumVonMisesStressPa;
  if (safetyFactor < input.constraints.minimumSafetyFactor) {
    reasons.push("post-extraction safety factor is below the acceptance limit");
  }
  const materialCountsValid = Number.isSafeInteger(input.materialCount)
    && Number.isSafeInteger(input.domainCount)
    && input.materialCount >= 0 && input.domainCount > 0
    && input.materialCount <= input.domainCount
    && Number.isFinite(input.materialFraction)
    && input.materialFraction === input.materialCount / input.domainCount;
  if (!materialCountsValid) reasons.push("material count evidence is invalid");
  if (materialCountsValid && input.materialCount > Math.round(
    input.constraints.maximumMaterialFraction * input.domainCount,
  )) {
    reasons.push("material fraction exceeds the acceptance limit");
  }
  return {
    eligible: reasons.length === 0,
    accepted: false,
    exportable: false,
    promotionRequired: "task-5-live-gate",
    reasons,
  };
}
