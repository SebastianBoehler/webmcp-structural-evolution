import type { StructuralFieldEvaluation, StructuralIterateEvaluation } from "../../reference";
import type { StructuralGpuSolve } from "./pcg";
import {
  STRUCTURAL_ENERGY_RELATIVE_TOLERANCE,
  STRUCTURAL_DEFAULT_PCG_ITERATION_BUDGET,
  STRUCTURAL_MAX_REFINEMENTS,
  STRUCTURAL_RESIDUAL_TOLERANCE,
  type StructuralRefinementPass,
} from "./structural-contract";
import { checkAbort, StructuralGpuError } from "./structural-gpu-runtime";

export interface StructuralGpuPostprocess {
  readonly vonMisesStressPa: Float32Array;
  readonly recomputedF32RelativeResidual: number;
  readonly forceBalanceErrorN: number;
  readonly complianceJ: number;
}

export interface MixedPrecisionStructuralSolve extends StructuralGpuSolve {
  readonly refinementCount: number;
  readonly passes: readonly StructuralRefinementPass[];
  readonly fieldEvaluation: StructuralFieldEvaluation;
}

interface RefinementOperations {
  readonly initialRhsN: Float32Array;
  readonly forceBalanceToleranceN: number;
  readonly maxIterations?: number;
  readonly signal: AbortSignal;
  solve(rhsN: Float32Array): Promise<StructuralGpuSolve>;
  evaluateMaster(field: Float64Array): Promise<StructuralIterateEvaluation>;
  evaluateCandidate(field: Float32Array): Promise<StructuralFieldEvaluation>;
  postprocess(field: Float32Array): Promise<StructuralGpuPostprocess>;
}

function diverged(message: string): never {
  throw new StructuralGpuError("diverged", message);
}

function requireFiniteNonnegative(values: readonly number[], label: string): void {
  if (!values.every((value) => Number.isFinite(value) && value >= 0)) {
    diverged(`${label} is non-finite or negative`);
  }
}

function validatePass(pass: StructuralGpuSolve, expectedLength: number, maxIterations: number): void {
  if (pass.displacementM.length !== expectedLength || !pass.displacementM.every(Number.isFinite)) {
    diverged("GPU correction field is invalid");
  }
  requireFiniteNonnegative(
    [pass.relativeResidual, pass.recomputedF32RelativeResidual],
    "GPU correction residual",
  );
  if (!Number.isInteger(pass.iterations) || pass.iterations < 1
    || pass.iterations > maxIterations) {
    diverged("GPU correction iterations exceed the locked per-pass bound");
  }
  if (pass.relativeResidual > STRUCTURAL_RESIDUAL_TOLERANCE) {
    diverged(`GPU correction recursive residual ${pass.relativeResidual} exceeds the locked threshold`);
  }
}

function validateCandidate(evaluation: StructuralFieldEvaluation): void {
  requireFiniteNonnegative([
    evaluation.directRelativeResidual,
    evaluation.forceBalanceErrorN,
    evaluation.energyRelativeMismatch,
  ], "Float32 candidate evidence");
}

function accepted(evaluation: StructuralFieldEvaluation, balanceToleranceN: number): boolean {
  return evaluation.forceBalanceErrorN <= balanceToleranceN
    && evaluation.energyRelativeMismatch <= STRUCTURAL_ENERGY_RELATIVE_TOLERANCE;
}

function evidence(
  kind: StructuralRefinementPass["kind"],
  pass: StructuralGpuSolve,
  residualScaleN: number,
  post: StructuralFieldEvaluation,
): StructuralRefinementPass {
  return {
    kind, iterations: pass.iterations, recursiveResidual: pass.relativeResidual,
    recomputedF32Residual: pass.recomputedF32RelativeResidual, residualScaleN,
    postDirectResidual: post.directRelativeResidual,
    postBalance: post.forceBalanceErrorN, postEnergy: post.energyRelativeMismatch,
  };
}

function sameField(left: Float32Array, right: Float32Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizedResidual(residual: Float64Array): { rhs: Float32Array; scale: number } {
  if (residual.length === 0 || !residual.every(Number.isFinite)) {
    diverged("Float64 master residual is non-finite or empty");
  }
  let scale = 0;
  for (const value of residual) scale = Math.max(scale, Math.abs(value));
  if (!Number.isFinite(scale) || scale <= 0) diverged("Float64 master residual cannot produce a correction");
  const rhs = Float32Array.from(residual, (value) => value / scale);
  if (!rhs.every(Number.isFinite) || rhs.every((value) => value === 0)) {
    diverged("Float64 master residual underflowed during Float32 normalization");
  }
  return { rhs, scale };
}

function maximumAbsolute(values: Float32Array): number {
  let maximum = 0;
  for (const value of values) maximum = Math.max(maximum, Math.abs(value));
  return maximum;
}

export async function runMixedPrecisionRefinement(
  operations: RefinementOperations,
): Promise<MixedPrecisionStructuralSolve> {
  const { signal } = operations;
  const maxIterations = operations.maxIterations ?? STRUCTURAL_DEFAULT_PCG_ITERATION_BUDGET;
  checkAbort(signal);
  const initial = await operations.solve(new Float32Array(operations.initialRhsN));
  checkAbort(signal);
  validatePass(initial, operations.initialRhsN.length, maxIterations);
  const master = Float64Array.from(initial.displacementM);
  let candidateField = Float32Array.from(master);
  let candidateEvidence = await operations.evaluateCandidate(candidateField);
  checkAbort(signal);
  validateCandidate(candidateEvidence);
  const passes: StructuralRefinementPass[] = [
    evidence("initial", initial, maximumAbsolute(operations.initialRhsN), candidateEvidence),
  ];
  let refinementCount = 0;

  while (!accepted(candidateEvidence, operations.forceBalanceToleranceN)) {
    if (refinementCount === STRUCTURAL_MAX_REFINEMENTS) {
      diverged("Mixed-precision refinement exhausted three correction attempts");
    }
    const masterEvaluation = await operations.evaluateMaster(master);
    checkAbort(signal);
    const { rhs, scale } = normalizedResidual(masterEvaluation.freeResidualN);
    const correction = await operations.solve(rhs);
    checkAbort(signal);
    validatePass(correction, master.length, maxIterations);
    for (let index = 0; index < master.length; index += 1) {
      master[index] += scale * correction.displacementM[index]!;
      if (!Number.isFinite(master[index])) diverged("Float64 master iterate became non-finite");
    }
    const rounded = Float32Array.from(master);
    if (sameField(candidateField, rounded)) diverged("Float32 precision stagnation blocked refinement");
    const previousEvidence = candidateEvidence;
    candidateField = rounded;
    candidateEvidence = await operations.evaluateCandidate(candidateField);
    checkAbort(signal);
    validateCandidate(candidateEvidence);
    refinementCount += 1;
    passes.push(evidence("correction", correction, scale, candidateEvidence));
    if (!accepted(candidateEvidence, operations.forceBalanceToleranceN)
      && candidateEvidence.forceBalanceErrorN >= previousEvidence.forceBalanceErrorN
      && candidateEvidence.energyRelativeMismatch >= previousEvidence.energyRelativeMismatch) {
      diverged("Mixed-precision correction made no improvement to candidate acceptance metrics");
    }
  }

  const final = await operations.postprocess(candidateField);
  checkAbort(signal);
  requireFiniteNonnegative([
    final.recomputedF32RelativeResidual, final.forceBalanceErrorN, final.complianceJ,
  ], "Final GPU postprocess evidence");
  if (!final.vonMisesStressPa.every((value) => Number.isFinite(value) && value >= 0)) {
    diverged("Final GPU postprocess stress field is invalid");
  }
  return {
    displacementM: candidateField, vonMisesStressPa: final.vonMisesStressPa,
    iterations: passes.reduce((sum, pass) => sum + pass.iterations, 0),
    relativeResidual: Math.max(...passes.map((pass) => pass.recursiveResidual)),
    recomputedF32RelativeResidual: final.recomputedF32RelativeResidual,
    forceBalanceErrorN: final.forceBalanceErrorN, complianceJ: final.complianceJ,
    refinementCount, passes, fieldEvaluation: candidateEvidence,
  };
}
