import type { EngineeringSolveRequest } from "../../engineering/solver-adapter";
import {
  STRUCTURAL_ENERGY_RELATIVE_TOLERANCE,
  STRUCTURAL_FORCE_BALANCE_TOLERANCE,
  STRUCTURAL_MAX_ITERATIONS,
  STRUCTURAL_MAX_REFINEMENTS,
  STRUCTURAL_MAX_TOTAL_ITERATIONS,
  STRUCTURAL_RESIDUAL_TOLERANCE,
  STRUCTURAL_VERIFICATION_METADATA,
  STRUCTURAL_WASM_L2_TOLERANCE,
  type CompiledStructuralSystem,
  type StructuralResult,
  type StructuralSolveInput,
} from "./structural-contract";

function equalValues(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function equalText(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameGrid(result: StructuralResult, system: CompiledStructuralSystem): boolean {
  return equalValues(result.grid.cellDimensions, system.grid.cellDimensions)
    && equalValues(result.grid.nodeDimensions, system.grid.nodeDimensions)
    && equalValues(result.grid.originM, system.grid.originM)
    && result.grid.cellSizeM === system.grid.cellSizeM;
}

function maximumDisplacement(field: Float32Array): number {
  let maximum = 0;
  for (let index = 0; index < field.length; index += 3) {
    maximum = Math.max(maximum, Math.hypot(field[index]!, field[index + 1]!, field[index + 2]!));
  }
  return maximum;
}

function maximum(field: Float32Array): number {
  let value = 0;
  for (const entry of field) value = Math.max(value, entry);
  return value;
}

function sameRasterization(result: StructuralResult, system: CompiledStructuralSystem): boolean {
  return JSON.stringify(result.rasterization) === JSON.stringify(system.rasterization);
}

export function structuralAppliedLoadMagnitude(
  request: EngineeringSolveRequest<StructuralSolveInput>,
): number {
  const study = request.document.studies.find(({ id }) => id === request.studyId);
  if (!study || study.kind !== "structural-linear") throw new Error("Structural result study is unresolved");
  return study.loads.reduce((total, { forceN }) => total + Math.hypot(...forceN), 0);
}

function finiteNonnegative(values: readonly number[]): boolean {
  return values.every((value) => Number.isFinite(value) && value >= 0);
}

function validateRefinementEvidence(result: StructuralResult): void {
  const evidence = result.verification;
  const passes = evidence.refinementPasses;
  if (!Number.isInteger(evidence.refinementCount) || evidence.refinementCount < 0
    || evidence.refinementCount > STRUCTURAL_MAX_REFINEMENTS
    || passes.length !== evidence.refinementCount + 1) {
    throw new Error("Structural refinement pass count is inconsistent");
  }
  for (let index = 0; index < passes.length; index += 1) {
    const pass = passes[index]!;
    if (pass.kind !== (index === 0 ? "initial" : "correction")
      || !Number.isInteger(pass.iterations) || pass.iterations < 1
      || pass.iterations > STRUCTURAL_MAX_ITERATIONS
      || !finiteNonnegative([
        pass.recursiveResidual, pass.recomputedF32Residual, pass.residualScaleN,
        pass.postDirectResidual, pass.postBalance, pass.postEnergy,
      ]) || pass.residualScaleN <= 0) {
      throw new Error("Structural refinement pass evidence is invalid");
    }
    if (pass.recursiveResidual > STRUCTURAL_RESIDUAL_TOLERANCE) {
      throw new Error("Structural refinement pass residual exceeds the locked threshold");
    }
  }
  const iterationTotal = passes.reduce((sum, pass) => sum + pass.iterations, 0);
  const recursiveMaximum = Math.max(...passes.map((pass) => pass.recursiveResidual));
  const final = passes[passes.length - 1]!;
  if (iterationTotal !== result.iterations || recursiveMaximum !== evidence.relativeResidual
    || final.postDirectResidual !== evidence.directRelativeResidual
    || final.postBalance !== evidence.wasmForceBalanceErrorN
    || final.postEnergy !== evidence.energyRelativeMismatch) {
    throw new Error("Structural refinement pass evidence does not match the final result");
  }
}

function validateSystemBinding(
  request: EngineeringSolveRequest<StructuralSolveInput>,
  system: CompiledStructuralSystem,
): void {
  const study = request.document.studies.find(({ id }) => id === request.studyId);
  if (!study || study.kind !== "structural-linear"
    || system.sourceRevision !== request.sourceRevision || system.studyId !== request.studyId
    || !equalText(system.bodyIds, study.bodyIds)
    || system.consumedArtifactIds.length !== 2
    || system.consumedArtifactIds[0] !== request.input.semanticMeshArtifactId
    || system.consumedArtifactIds[1] !== request.input.voxelArtifactId) {
    throw new Error("Structural result compiled system does not match the solve request");
  }
}

export function validateInteractiveStructuralResult(
  request: EngineeringSolveRequest<StructuralSolveInput>,
  system: CompiledStructuralSystem,
  result: StructuralResult,
): void {
  if (result.truthLevel !== "interactive-estimate") {
    throw new Error("Task 5 must supply the evidence-bound converged structural result path");
  }
  validateSystemBinding(request, system);
  if (!sameGrid(result, system) || !sameRasterization(result, system)) {
    throw new Error("Structural result grid or rasterization does not match the compiled system");
  }
  if (Object.prototype.toString.call(result.displacementM) !== "[object Float32Array]"
    || result.displacementM.length !== system.fixedDofs.length) {
    throw new Error("Structural displacement field length must match the compiled system");
  }
  if (Object.prototype.toString.call(result.vonMisesStressPa) !== "[object Float32Array]"
    || result.vonMisesStressPa.length !== system.activeCells.length) {
    throw new Error("Structural stress field length must match the compiled system");
  }
  if (!result.displacementM.every(Number.isFinite)) {
    throw new Error("Structural displacement field values must be finite");
  }
  if (!result.vonMisesStressPa.every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error("Structural stress field values must be finite and nonnegative");
  }
  if (!Number.isInteger(result.iterations) || result.iterations < 1
    || result.iterations > STRUCTURAL_MAX_TOTAL_ITERATIONS) {
    throw new Error("Structural result iterations exceed the locked solver bounds");
  }
  const metrics = [
    result.complianceJ, result.strainEnergyJ,
    result.maximumDisplacementM, result.maximumVonMisesStressPa,
  ];
  if (!finiteNonnegative(metrics)) throw new Error("Structural result metrics must be finite and nonnegative");
  if (result.maximumDisplacementM !== maximumDisplacement(result.displacementM)) {
    throw new Error("Structural maximum displacement does not match its field");
  }
  if (result.maximumVonMisesStressPa !== maximum(result.vonMisesStressPa)) {
    throw new Error("Structural maximum stress does not match its field");
  }
  const energyMismatch = Math.abs(result.complianceJ - 2 * result.strainEnergyJ)
    / Math.max(result.complianceJ, Number.MIN_VALUE);
  if (energyMismatch > STRUCTURAL_ENERGY_RELATIVE_TOLERANCE) {
    throw new Error("Structural strain energy is inconsistent with compliance");
  }
  const evidence = result.verification;
  if (evidence.realGpu !== true
    || JSON.stringify(evidence.metadata) !== JSON.stringify(STRUCTURAL_VERIFICATION_METADATA)) {
    throw new Error("Structural verification metadata does not match the locked reference contract");
  }
  if (!finiteNonnegative([
    evidence.relativeResidual, evidence.gpuReactionBalanceErrorN,
    evidence.wasmForceBalanceErrorN, evidence.appliedLoadN,
    evidence.recomputedF32RelativeResidual, evidence.wasmRelativeL2,
    evidence.wasmFieldStressRelativeL2, evidence.energyRelativeMismatch,
    evidence.directRelativeResidual,
  ]) || evidence.appliedLoadN <= 0) {
    throw new Error("Structural numerical evidence must be finite and nonnegative");
  }
  if (evidence.relativeResidual > STRUCTURAL_RESIDUAL_TOLERANCE) {
    throw new Error("Structural residual exceeds the locked threshold");
  }
  if (evidence.wasmForceBalanceErrorN > evidence.appliedLoadN * STRUCTURAL_FORCE_BALANCE_TOLERANCE) {
    throw new Error("Structural force balance exceeds the locked threshold");
  }
  if (evidence.appliedLoadN !== structuralAppliedLoadMagnitude(request)) {
    throw new Error("Structural applied load evidence does not match the study");
  }
  if (evidence.wasmRelativeL2 > STRUCTURAL_WASM_L2_TOLERANCE) {
    throw new Error("Structural Wasm agreement exceeds the locked threshold");
  }
  if (evidence.wasmFieldStressRelativeL2 > STRUCTURAL_WASM_L2_TOLERANCE) {
    throw new Error("Structural Wasm field-stress agreement exceeds the locked threshold");
  }
  if (evidence.wasmReactionN.length !== 3 || !evidence.wasmReactionN.every(Number.isFinite)) {
    throw new Error("Structural Wasm reaction vector is invalid");
  }
  if (evidence.energyRelativeMismatch > STRUCTURAL_ENERGY_RELATIVE_TOLERANCE) {
    throw new Error("Structural field energy exceeds the locked threshold");
  }
  validateRefinementEvidence(result);
}
