import {
  STRUCTURAL_VERIFICATION_METADATA,
  type StructuralResult,
} from "../structural/structural-contract";
import type {
  TopologyAcceptanceDecision,
  TopologyExtractionValidation,
} from "./topology-contract";

interface AcceptanceInput {
  readonly objectiveHistory: readonly number[];
  readonly materialFraction: number;
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

function monotonic(values: readonly number[]): boolean {
  return values.length > 0 && values.every((value, index) => Number.isFinite(value)
    && value >= 0 && (index === 0 || value <= values[index - 1]!));
}

function coherentStructuralEvidence(result: StructuralResult): boolean {
  const metrics = [
    result.iterations, result.complianceJ, result.strainEnergyJ,
    result.maximumDisplacementM, result.maximumVonMisesStressPa,
    result.verification.relativeResidual, result.verification.forceBalanceErrorN,
    result.verification.appliedLoadN, result.verification.wasmRelativeL2,
  ];
  return result.truthLevel === "interactive-estimate"
    && Number.isInteger(result.iterations) && result.iterations > 0
    && metrics.every((value) => Number.isFinite(value) && value >= 0)
    && result.displacementM instanceof Float32Array
    && result.vonMisesStressPa instanceof Float32Array
    && result.displacementM.length > 0 && result.vonMisesStressPa.length > 0
    && result.displacementM.every(Number.isFinite)
    && result.vonMisesStressPa.every((value) => Number.isFinite(value) && value >= 0)
    && Math.abs(result.strainEnergyJ * 2 - result.complianceJ)
      <= Math.max(1, result.complianceJ) * 1e-5
    && JSON.stringify(result.verification.metadata) === JSON.stringify(STRUCTURAL_VERIFICATION_METADATA);
}

export function decideTopologyAcceptance(input: AcceptanceInput): TopologyAcceptanceDecision {
  const reasons: string[] = [];
  if (!monotonic(input.objectiveHistory)) reasons.push("objective history is not monotonic");
  if (!input.extraction.closed) reasons.push("manufacturing mesh is not closed");
  if (!input.extraction.oriented) reasons.push("manufacturing mesh orientation is inconsistent");
  if (!input.extraction.requiredInterfacesConnected) reasons.push("required interfaces are disconnected");
  if (!input.extraction.protectedVoidsClear) reasons.push("protected voids are obstructed");
  if (!input.extraction.minimumFeatureSatisfied) reasons.push("minimum feature is violated");
  if (!coherentStructuralEvidence(input.analysis)) reasons.push("post-extraction structural evidence is incoherent");
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
  if (input.materialFraction > input.constraints.maximumMaterialFraction) {
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
