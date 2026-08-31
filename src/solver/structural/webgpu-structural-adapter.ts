import type { EngineeringSolveRequest, SolverAdapter } from "../../engineering/solver-adapter";
import { relativeL2, solveStructuralReference } from "../../reference";
import { compileStructuralStudy } from "./compile-structural-study";
import { runStructuralPcg } from "./pcg";
import {
  DEFAULT_STRUCTURAL_COMPILE_LIMITS,
  STRUCTURAL_FORCE_BALANCE_TOLERANCE,
  STRUCTURAL_MAX_ITERATIONS,
  STRUCTURAL_RESIDUAL_TOLERANCE,
  STRUCTURAL_VERIFICATION_METADATA,
  STRUCTURAL_WASM_L2_TOLERANCE,
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
  gpu: Awaited<ReturnType<typeof runStructuralPcg>>,
): Promise<StructuralResult> {
  const reference = await solveStructuralReference(referenceInput(system));
  const displacementDelta = await relativeL2(reference.displacementM, gpu.displacementM);
  const stressDelta = await relativeL2(reference.vonMisesStressPa, gpu.vonMisesStressPa);
  const wasmRelativeL2 = Math.max(displacementDelta, stressDelta);
  const appliedLoadN = structuralAppliedLoadMagnitude(request);
  const numericalGatesPassed = gpu.relativeResidual <= STRUCTURAL_RESIDUAL_TOLERANCE
    && gpu.forceBalanceErrorN <= appliedLoadN * STRUCTURAL_FORCE_BALANCE_TOLERANCE
    && wasmRelativeL2 <= STRUCTURAL_WASM_L2_TOLERANCE;
  if (!numericalGatesPassed) {
    throw new StructuralGpuError(
      "diverged",
      `Structural verification failed (residual ${gpu.relativeResidual}, balance ${gpu.forceBalanceErrorN}, Wasm L2 ${wasmRelativeL2})`,
    );
  }
  return {
    // The live analytical WebGPU fixtures are deliberately owned by Task 5.
    truthLevel: "interactive-estimate",
    grid: system.grid,
    iterations: gpu.iterations,
    complianceJ: gpu.complianceJ,
    strainEnergyJ: gpu.complianceJ * 0.5,
    maximumDisplacementM: maximumDisplacement(gpu.displacementM),
    maximumVonMisesStressPa: maximumValue(gpu.vonMisesStressPa),
    verification: {
      relativeResidual: gpu.relativeResidual,
      forceBalanceErrorN: gpu.forceBalanceErrorN,
      appliedLoadN,
      wasmRelativeL2,
      realGpu: true,
      metadata: STRUCTURAL_VERIFICATION_METADATA,
    },
    rasterization: system.rasterization,
    displacementM: gpu.displacementM,
    vonMisesStressPa: gpu.vonMisesStressPa,
  };
}

export function createWebGpuStructuralAdapter(): SolverAdapter<StructuralSolveInput, StructuralResult> {
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
      const device = await acquireStructuralGpu(signal);
      try {
        emit({ progress: 0.05 });
        const gpu = await runStructuralPcg(device, system, signal, (progress) => emit({ progress }));
        emit({ progress: 0.9 });
        const result = await verifiedResult(request, system, gpu);
        emit({ progress: 0.98 });
        return packInteractiveStructuralRunResult(request, system, result);
      } finally {
        safeDestroy(device);
      }
    },
  };
}
