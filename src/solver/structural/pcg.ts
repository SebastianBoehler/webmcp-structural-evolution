import type { CompiledStructuralSystem } from "./structural-contract";
import { STRUCTURAL_MAX_ITERATIONS, STRUCTURAL_RESIDUAL_TOLERANCE } from "./structural-contract";
import { createStructuralPipelines } from "./gpu-pipelines";
import { createGpuReducer } from "./gpu-reducer";
import { createStructuralGpuResources } from "./gpu-resources";
import {
  dispatchVector,
  elasticityGroup,
  readField,
  vectorGroup,
  writeVectorParams,
} from "./structural-gpu-commands";
import { postprocessStructuralResources } from "./structural-gpu-postprocess";
import {
  createDeviceGuard,
  StructuralGpuError,
  withStructuralGpuErrorScopes,
} from "./structural-gpu-runtime";

export interface StructuralGpuSolve {
  readonly displacementM: Float32Array;
  readonly vonMisesStressPa: Float32Array;
  readonly iterations: number;
  readonly relativeResidual: number;
  readonly recomputedF32RelativeResidual: number;
  readonly forceBalanceErrorN: number;
  readonly complianceJ: number;
}

export async function runStructuralPcg(
  device: GPUDevice,
  system: CompiledStructuralSystem,
  signal: AbortSignal,
  emit: (progress: number) => void,
  rhsN: Float32Array = system.loadsN,
): Promise<StructuralGpuSolve> {
  const guard = createDeviceGuard(device, signal);
  return withStructuralGpuErrorScopes(device, guard, async () => {
    const resources = createStructuralGpuResources(device, system, rhsN);
    try {
      const pipelines = await createStructuralPipelines(device, guard);
      const vector = vectorGroup(device, pipelines, resources);
      const dofCount = system.fixedDofs.length;
      writeVectorParams(device, resources.vectorParams, dofCount);
      await dispatchVector(
        device, guard, pipelines.buildDiagonal,
        elasticityGroup(device, pipelines, resources, resources.p, resources.diagonal),
        dofCount, "structural-build-diagonal",
      );
      await dispatchVector(device, guard, pipelines.initializePcg, vector, dofCount, "structural-initialize-pcg");
      await dispatchVector(
        device, guard, pipelines.applyElasticity,
        elasticityGroup(device, pipelines, resources, resources.p, resources.product),
        dofCount, "structural-apply-initial",
      );
      const reducer = createGpuReducer(device, guard, pipelines, resources);
      const rhsNormSquared = await reducer.dot(resources.rhs, resources.rhs, dofCount);
      const initialRz = await reducer.dot(resources.r, resources.z, dofCount);
      const initialDenominator = await reducer.dot(resources.p, resources.product, dofCount);
      if (![rhsNormSquared, initialRz, initialDenominator].every(Number.isFinite)
        || rhsNormSquared <= 0 || initialRz <= 0 || initialDenominator <= 0) {
        throw new StructuralGpuError("diverged", "WebGPU PCG initialization did not produce positive finite reductions");
      }
      let rz = initialRz;
      let denominator = initialDenominator;
      let relativeResidual = 1;
      let iterations = 0;
      for (let iteration = 0; iteration < STRUCTURAL_MAX_ITERATIONS; iteration += 1) {
        if (iteration > 0) {
          await dispatchVector(
            device, guard, pipelines.applyElasticity,
            elasticityGroup(device, pipelines, resources, resources.p, resources.product),
            dofCount, "structural-apply-elasticity",
          );
          denominator = await reducer.dot(resources.p, resources.product, dofCount);
        }
        if (!Number.isFinite(denominator) || denominator <= 0) {
          throw new StructuralGpuError("diverged", "WebGPU elasticity operator is not positive definite");
        }
        const alpha = rz / denominator;
        writeVectorParams(device, resources.vectorParams, dofCount, alpha);
        await dispatchVector(
          device, guard, pipelines.updateSolutionResidual, vector, dofCount,
          "structural-update-solution-residual",
        );
        const residualSquared = await reducer.dot(resources.r, resources.r, dofCount);
        relativeResidual = Math.sqrt(residualSquared / rhsNormSquared);
        iterations = iteration + 1;
        if (!Number.isFinite(relativeResidual)) {
          throw new StructuralGpuError("diverged", "WebGPU PCG residual became non-finite");
        }
        emit(Math.min(0.85, 0.1 + 0.75 * iterations / STRUCTURAL_MAX_ITERATIONS));
        if (relativeResidual <= STRUCTURAL_RESIDUAL_TOLERANCE) break;
        writeVectorParams(device, resources.vectorParams, dofCount);
        await dispatchVector(
          device, guard, pipelines.applyPreconditioner, vector, dofCount,
          "structural-apply-preconditioner",
        );
        const nextRz = await reducer.dot(resources.r, resources.z, dofCount);
        const beta = nextRz / rz;
        writeVectorParams(device, resources.vectorParams, dofCount, 0, beta);
        await dispatchVector(
          device, guard, pipelines.updateDirection, vector, dofCount,
          "structural-update-direction",
        );
        rz = nextRz;
      }
      if (relativeResidual > STRUCTURAL_RESIDUAL_TOLERANCE) {
        throw new StructuralGpuError(
          "diverged", `WebGPU PCG reached ${STRUCTURAL_MAX_ITERATIONS} iterations at residual ${relativeResidual}`,
        );
      }
      const post = await postprocessStructuralResources(
        device, guard, pipelines, resources, system, rhsN,
      );
      const displacementM = await readField(device, guard, resources.x, resources.fieldReadback, dofCount);
      if (!displacementM.every(Number.isFinite)) {
        throw new StructuralGpuError("diverged", "WebGPU structural fields or evidence are non-finite");
      }
      return {
        displacementM, vonMisesStressPa: post.vonMisesStressPa, iterations, relativeResidual,
        recomputedF32RelativeResidual: post.recomputedF32RelativeResidual,
        forceBalanceErrorN: post.forceBalanceErrorN,
        complianceJ: post.complianceJ,
      };
    } finally {
      resources.destroy();
    }
  });
}
