import type { EngineeringSolveRequest, SolverAdapter } from "../../engineering/solver-adapter";
import {
  evaluateStructuralField,
  evaluateStructuralIterateF64,
  relativeL2,
  solveStructuralReference,
} from "../../reference";
import { compileStructuralStudy } from "./compile-structural-study";
import { runStructuralPcg } from "./pcg";
import {
  runMixedPrecisionRefinement,
  type MixedPrecisionStructuralSolve,
} from "./mixed-precision-refinement";
import { postprocessStructuralField } from "./structural-gpu-postprocess";
import {
  DEFAULT_STRUCTURAL_COMPILE_LIMITS,
  STRUCTURAL_FORCE_BALANCE_TOLERANCE,
  STRUCTURAL_ENERGY_RELATIVE_TOLERANCE,
  STRUCTURAL_MAX_ITERATIONS,
  STRUCTURAL_RESIDUAL_TOLERANCE,
  STRUCTURAL_WASM_L2_TOLERANCE,
  structuralPcgIterationBudget,
  structuralVerificationMetadata,
  type CompiledStructuralSystem,
  type StructuralResult,
  type StructuralSolveInput,
} from "./structural-contract";
import { packInteractiveStructuralRunResult } from "./structural-result-artifacts";
import { structuralAppliedLoadMagnitude } from "./structural-result-validation";
import {
  acquireStructuralGpu,
  safeDestroy,
  StructuralGpuError,
  type StructuralGpuAcquisitionObserver,
} from "./structural-gpu-runtime";

function unsupported(
  message: string,
  kind: "dimension" | "memory" | "precision" | "material",
  rule: string,
) {
  return {
    supported: false as const,
    error: { code: "unsupported-capability" as const, message, limit: { kind, rule } },
  };
}

function capability(
  request: EngineeringSolveRequest<StructuralSolveInput>,
): ReturnType<SolverAdapter<StructuralSolveInput, StructuralResult>["supports"]> {
  if (!globalThis.navigator?.gpu) {
    return unsupported(
      "Structural elasticity requires a live browser WebGPU device",
      "precision", "navigator.gpu must expose a compatible f32 compute device",
    );
  }
  if (request.kind !== "fea") {
    return unsupported("Structural adapter accepts only FEA jobs", "dimension", "job kind must be fea");
  }
  const study = request.document.studies.find(({ id }) => id === request.studyId);
  const material = study?.kind === "structural-linear"
    ? request.document.materials.find(({ id }) => id === study.materialId)
    : undefined;
  if (!material || material.kind !== "isotropic" || material.youngsModulusPa > 1e13
    || material.poissonRatio <= -0.99 || material.poissonRatio >= 0.49) {
    return unsupported(
      "Structural adapter supports bounded finite isotropic materials only",
      "material", "isotropic E <= 1e13 Pa and -0.99 < nu < 0.49 are required",
    );
  }
  const dimensions = request.input?.voxelPayload?.dimensions;
  if (!(dimensions instanceof Uint32Array) || dimensions.length !== 3) {
    return unsupported("Structural solver mesh dimensions are unavailable", "dimension", "three voxel axes are required");
  }
  const cells = dimensions[0]! * dimensions[1]! * dimensions[2]!;
  const dofs = (dimensions[0]! + 1) * (dimensions[1]! + 1) * (dimensions[2]! + 1) * 3;
  if (!Number.isSafeInteger(cells) || cells > DEFAULT_STRUCTURAL_COMPILE_LIMITS.maxCells) {
    return unsupported(
      "Structural voxel grid exceeds the bounded adapter envelope",
      "dimension", `cell count must be at most ${DEFAULT_STRUCTURAL_COMPILE_LIMITS.maxCells}`,
    );
  }
  if (!Number.isSafeInteger(dofs) || dofs > DEFAULT_STRUCTURAL_COMPILE_LIMITS.maxDofs) {
    return unsupported(
      "Structural degree-of-freedom count exceeds the bounded adapter envelope",
      "memory", `degree-of-freedom count must be at most ${DEFAULT_STRUCTURAL_COMPILE_LIMITS.maxDofs}`,
    );
  }
  return { supported: true };
}

function maximumDisplacement(field: Float32Array): number {
  let maximum = 0;
  for (let index = 0; index < field.length; index += 3) {
    maximum = Math.max(maximum, Math.hypot(field[index]!, field[index + 1]!, field[index + 2]!));
  }
  return maximum;
}

function maximumValue(field: Float32Array): number {
  let maximum = 0;
  for (const value of field) maximum = Math.max(maximum, value);
  return maximum;
}

function referenceInput(system: CompiledStructuralSystem) {
  return {
    cellDimensions: system.grid.cellDimensions,
    cellSizeM: system.grid.cellSizeM,
    activeCells: new Uint32Array(system.activeCells),
    fixedDofs: new Uint32Array(system.fixedDofs),
    loadsN: Float64Array.from(system.loadsN),
    youngsModulusPa: system.material.youngsModulusPa,
    poissonRatio: system.material.poissonRatio,
    maxIterations: STRUCTURAL_MAX_ITERATIONS * 3,
    tolerance: 1e-6,
  };
}

async function verifiedResult(
  request: EngineeringSolveRequest<StructuralSolveInput>,
  system: CompiledStructuralSystem,
  gpu: MixedPrecisionStructuralSolve,
): Promise<StructuralResult> {
  const input = referenceInput(system);
  const reference = await solveStructuralReference(input);
  const evaluation = gpu.fieldEvaluation;
  if (gpu.vonMisesStressPa.length !== system.activeCells.length
    || evaluation.vonMisesStressPa.length !== system.activeCells.length) {
    throw new StructuralGpuError("diverged", "Refined structural stress field length is invalid");
  }
  const displacementDelta = await relativeL2(reference.displacementM, gpu.displacementM);
  const stressDelta = await relativeL2(reference.vonMisesStressPa, gpu.vonMisesStressPa);
  const fieldStressDelta = await relativeL2(evaluation.vonMisesStressPa, gpu.vonMisesStressPa);
  const wasmRelativeL2 = Math.max(displacementDelta, stressDelta);
  const appliedLoadN = structuralAppliedLoadMagnitude(request);
  const numericalGatesPassed = gpu.relativeResidual <= STRUCTURAL_RESIDUAL_TOLERANCE
    && evaluation.forceBalanceErrorN <= appliedLoadN * STRUCTURAL_FORCE_BALANCE_TOLERANCE
    && wasmRelativeL2 <= STRUCTURAL_WASM_L2_TOLERANCE
    && fieldStressDelta <= STRUCTURAL_WASM_L2_TOLERANCE
    && evaluation.energyRelativeMismatch <= STRUCTURAL_ENERGY_RELATIVE_TOLERANCE;
  if (!numericalGatesPassed) {
    throw new StructuralGpuError(
      "diverged",
      `Structural verification failed (GPU iterations ${gpu.iterations}, residual ${gpu.relativeResidual}, `
      + `recomputed f32 ${gpu.recomputedF32RelativeResidual}, GPU reaction ${gpu.forceBalanceErrorN}, `
      + `Wasm balance ${evaluation.forceBalanceErrorN}, Wasm L2 ${wasmRelativeL2}, `
      + `field stress L2 ${fieldStressDelta}, energy ${evaluation.energyRelativeMismatch})`,
    );
  }
  return {
    // The live analytical WebGPU fixtures are deliberately owned by Task 5.
    truthLevel: "interactive-estimate",
    grid: system.grid,
    iterations: gpu.iterations,
    complianceJ: evaluation.complianceJ,
    strainEnergyJ: evaluation.strainEnergyJ,
    maximumDisplacementM: maximumDisplacement(gpu.displacementM),
    maximumVonMisesStressPa: maximumValue(gpu.vonMisesStressPa),
    verification: {
      relativeResidual: gpu.relativeResidual,
      recomputedF32RelativeResidual: gpu.recomputedF32RelativeResidual,
      gpuReactionBalanceErrorN: gpu.forceBalanceErrorN,
      wasmForceBalanceErrorN: evaluation.forceBalanceErrorN,
      wasmReactionN: evaluation.reactionN,
      appliedLoadN,
      wasmRelativeL2,
      wasmFieldStressRelativeL2: fieldStressDelta,
      energyRelativeMismatch: evaluation.energyRelativeMismatch,
      directRelativeResidual: evaluation.directRelativeResidual,
      refinementCount: gpu.refinementCount,
      refinementPasses: gpu.passes,
      realGpu: true,
      metadata: structuralVerificationMetadata(request.settings),
    },
    rasterization: system.rasterization,
    displacementM: gpu.displacementM,
    vonMisesStressPa: gpu.vonMisesStressPa,
  };
}

export interface WebGpuStructuralAdapterOptions {
  readonly onAcquisition?: StructuralGpuAcquisitionObserver;
}

export function createWebGpuStructuralAdapter(
  options: WebGpuStructuralAdapterOptions = {},
): SolverAdapter<StructuralSolveInput, StructuralResult> {
  return {
    capability: { kind: "fea" },
    supports: capability,
    async run(request, signal, emit) {
      const decision = capability(request);
      if (!decision.supported) {
        throw new StructuralGpuError(
          "unsupported-capability", decision.error.message, decision.error.limit,
        );
      }
      let system: CompiledStructuralSystem;
      try {
        system = await compileStructuralStudy(request);
      } catch (error) {
        throw new StructuralGpuError(
          "invalid-input",
          error instanceof Error ? error.message : "Structural study compilation failed",
        );
      }
      const device = await acquireStructuralGpu(signal, options.onAcquisition);
      try {
        emit({ progress: 0.05 });
        const input = referenceInput(system);
        const maxIterations = structuralPcgIterationBudget(request.settings);
        const balanceToleranceN = structuralAppliedLoadMagnitude(request)
          * STRUCTURAL_FORCE_BALANCE_TOLERANCE;
        let solvePass = 0;
        const gpu = await runMixedPrecisionRefinement({
          initialRhsN: system.loadsN, forceBalanceToleranceN: balanceToleranceN, signal,
          maxIterations,
          solve: async (rhsN) => {
            const pass = solvePass;
            solvePass += 1;
            return runStructuralPcg(device, system, signal, (progress) => {
              emit({ progress: 0.05 + 0.75 * (pass + progress) / 4 });
            }, rhsN, maxIterations);
          },
          evaluateMaster: (field) => evaluateStructuralIterateF64(input, field),
          evaluateCandidate: (field) => evaluateStructuralField(input, field),
          postprocess: (field) => postprocessStructuralField(device, system, signal, field),
        });
        emit({ progress: 0.9 });
        const result = await verifiedResult(request, system, gpu);
        emit({ progress: 0.98 });
        return packInteractiveStructuralRunResult(request, result);
      } finally {
        safeDestroy(device);
      }
    },
  };
}
