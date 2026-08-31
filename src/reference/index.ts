type ReferenceModule = typeof import("./pkg/webmcp_reference.js");
import type { AssemblyTopologyInput } from "../optimization/assembly-topology-input";

let referencePromise: Promise<ReferenceModule> | undefined;

function loadReference(): Promise<ReferenceModule> {
  referencePromise ??= import("./pkg/webmcp_reference.js").then(async (reference) => {
    await reference.default();
    return reference;
  });
  return referencePromise;
}

function requireFloat32Array(value: unknown, name: string): asserts value is Float32Array {
  if (!(value instanceof Float32Array)) {
    throw new TypeError(`${name} must be a Float32Array`);
  }
}

function requireFloat64Array(value: unknown, name: string): asserts value is Float64Array {
  if (!(value instanceof Float64Array)) throw new TypeError(`${name} must be a Float64Array`);
}

export async function relativeL2(
  expected: Float32Array,
  actual: Float32Array,
): Promise<number> {
  requireFloat32Array(expected, "expected");
  requireFloat32Array(actual, "actual");

  const reference = await loadReference();
  return reference.relative_l2(expected, actual);
}

export type TopologyPreset = "lightweight" | "balanced" | "stiffness";

export interface TopologyOptimizationResult {
  readonly dimensions: { readonly width: number; readonly height: number; readonly depth: number };
  readonly density: Float32Array;
  readonly displacement: Float32Array;
  readonly stress: Float32Array;
  readonly cases: Readonly<Record<string, {
    readonly displacement: Float32Array;
    readonly stress: Float32Array;
  }>>;
  readonly metrics: {
    readonly initialCompliance: number;
    readonly finalCompliance: number;
    readonly maxDisplacement: number;
    readonly maxStress: number;
    readonly minimumSafetyFactor: number;
    readonly materialFraction: number;
    readonly iterations: number;
  };
}

export interface StructuralReferenceInput {
  readonly cellDimensions: readonly [number, number, number];
  readonly cellSizeM: number;
  readonly activeCells: Uint32Array;
  readonly fixedDofs: Uint32Array;
  readonly loadsN: Float64Array;
  readonly youngsModulusPa: number;
  readonly poissonRatio: number;
  readonly maxIterations: number;
  readonly tolerance: number;
}

export interface StructuralReferenceResult {
  readonly displacementM: Float32Array;
  readonly vonMisesStressPa: Float32Array;
  readonly iterations: number;
  readonly relativeResidual: number;
  readonly forceBalanceErrorN: number;
  readonly complianceJ: number;
}

export interface StructuralFieldEvaluation {
  readonly reactionN: readonly [number, number, number];
  readonly vonMisesStressPa: Float32Array;
  readonly forceBalanceErrorN: number;
  readonly complianceJ: number;
  readonly strainEnergyJ: number;
  readonly energyRelativeMismatch: number;
  readonly directRelativeResidual: number;
}

export interface StructuralIterateEvaluation {
  readonly freeResidualN: Float64Array;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

export async function optimizeTopology(
  preset: TopologyPreset,
  assembly?: AssemblyTopologyInput,
): Promise<TopologyOptimizationResult> {
  const reference = await loadReference();
  const result = assembly ? reference.optimize_assembly_frame(preset, assembly) : reference.optimize_demo_frame(preset);
  const dimensions = { width: result.width, height: result.height, depth: result.depth };
  const density = result.density;
  const displacement = result.displacement;
  const stress = result.stress;
  const caseIds = result.case_ids;
  const caseDisplacement = result.case_displacement;
  const caseStress = result.case_stress;
  const metrics = {
    initialCompliance: result.initial_compliance,
    finalCompliance: result.final_compliance,
    maxDisplacement: result.max_displacement,
    maxStress: result.max_stress,
    minimumSafetyFactor: result.minimum_safety_factor,
    materialFraction: result.material_fraction,
    iterations: result.iterations,
  };
  const expectedLength = dimensions.width * dimensions.height * dimensions.depth;
  const validDimensions = Object.values(dimensions).every(
    (value) => Number.isInteger(value) && value > 0,
  );
  const validMetrics = Object.values(metrics).every(finite);
  const validDensity = density instanceof Float32Array
    && density.length === expectedLength
    && density.every((value) => finite(value) && value >= 0 && value <= 1);
  const validAnalysis = [displacement, stress].every((field) => field instanceof Float32Array
    && field.length === expectedLength && field.every((value) => finite(value) && value >= 0));
  const validCaseIds = Array.isArray(caseIds) && caseIds.length > 0
    && caseIds.every((id) => typeof id === "string" && id.length > 0)
    && new Set(caseIds).size === caseIds.length;
  const caseCount = Array.isArray(caseIds) ? caseIds.length : 0;
  const validCaseAnalysis = validCaseIds && [caseDisplacement, caseStress].every((field) => field instanceof Float32Array
    && field.length === expectedLength * caseCount
    && field.every((value) => finite(value) && value >= 0));
  if (!validDimensions || !validMetrics || !validDensity || !validAnalysis || !validCaseIds || !validCaseAnalysis) {
    throw new Error("Invalid topology result returned by the Wasm solver.");
  }
  const cases = Object.fromEntries((caseIds as string[]).map((loadCase, index) => [loadCase, {
    displacement: new Float32Array(caseDisplacement.slice(index * expectedLength, (index + 1) * expectedLength)),
    stress: new Float32Array(caseStress.slice(index * expectedLength, (index + 1) * expectedLength)),
  }]));
  return {
    dimensions, density: new Float32Array(density),
    displacement: new Float32Array(displacement), stress: new Float32Array(stress), cases, metrics,
  };
}

export async function solveStructuralReference(
  input: StructuralReferenceInput,
): Promise<StructuralReferenceResult> {
  const reference = await loadReference();
  const result = reference.solve_structural_reference(input);
  const cellCount = input.cellDimensions.reduce((product, value) => product * value, 1);
  const dofCount = input.cellDimensions.reduce((product, value) => product * (value + 1), 1) * 3;
  const displacement = result.displacement_m;
  const stress = result.von_mises_stress_pa;
  const metrics = {
    iterations: result.iterations,
    relativeResidual: result.relative_residual,
    forceBalanceErrorN: result.force_balance_error_n,
    complianceJ: result.compliance_j,
  };
  const valid = displacement instanceof Float32Array && displacement.length === dofCount
    && displacement.every(finite) && stress instanceof Float32Array && stress.length === cellCount
    && stress.every((value) => finite(value) && value >= 0)
    && Number.isInteger(metrics.iterations) && metrics.iterations > 0
    && Object.values(metrics).every(finite) && metrics.relativeResidual >= 0
    && metrics.forceBalanceErrorN >= 0 && metrics.complianceJ >= 0;
  if (!valid) throw new Error("Invalid structural reference result returned by the Wasm solver.");
  return {
    displacementM: new Float32Array(displacement),
    vonMisesStressPa: new Float32Array(stress),
    ...metrics,
  };
}

export async function evaluateStructuralField(
  input: StructuralReferenceInput,
  displacementM: Float32Array,
): Promise<StructuralFieldEvaluation> {
  requireFloat32Array(displacementM, "displacementM");
  const reference = await loadReference();
  const result = reference.evaluate_structural_field(input, displacementM);
  const evaluation = {
    reactionN: [...result.reaction_n] as [number, number, number],
    vonMisesStressPa: new Float32Array(result.von_mises_stress_pa),
    forceBalanceErrorN: result.force_balance_error_n,
    complianceJ: result.compliance_j,
    strainEnergyJ: result.strain_energy_j,
    energyRelativeMismatch: result.energy_relative_mismatch,
    directRelativeResidual: result.direct_relative_residual,
  };
  if (evaluation.reactionN.length !== 3 || !evaluation.reactionN.every(finite)
    || evaluation.vonMisesStressPa.length !== input.activeCells.length
    || !evaluation.vonMisesStressPa.every((value) => finite(value) && value >= 0)
    || ![evaluation.forceBalanceErrorN, evaluation.complianceJ, evaluation.strainEnergyJ,
      evaluation.energyRelativeMismatch, evaluation.directRelativeResidual].every(finite)
    || evaluation.forceBalanceErrorN < 0 || evaluation.complianceJ < 0
    || evaluation.strainEnergyJ < 0 || evaluation.energyRelativeMismatch < 0
    || evaluation.directRelativeResidual < 0) {
    throw new Error("Invalid structural field evaluation returned by Wasm.");
  }
  return evaluation;
}

export async function evaluateStructuralIterateF64(
  input: StructuralReferenceInput,
  displacementM: Float64Array,
): Promise<StructuralIterateEvaluation> {
  requireFloat64Array(displacementM, "displacementM");
  const reference = await loadReference();
  const result = reference.evaluate_structural_iterate_f64(input, displacementM);
  const evaluation = {
    freeResidualN: new Float64Array(result.free_residual_n),
  };
  if (evaluation.freeResidualN.length !== displacementM.length
    || !evaluation.freeResidualN.every(finite)) {
    throw new Error("Invalid structural iterate evaluation returned by Wasm.");
  }
  return evaluation;
}
