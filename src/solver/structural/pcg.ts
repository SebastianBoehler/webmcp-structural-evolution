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

export interface BufferPcgVectors {
  readonly rhs: GPUBuffer;
  readonly solution: GPUBuffer;
  readonly residual: GPUBuffer;
  readonly preconditioned: GPUBuffer;
  readonly direction: GPUBuffer;
  readonly product: GPUBuffer;
}

export interface BufferPcgCallbacks {
  readonly initialize: (vectors: BufferPcgVectors) => Promise<void>;
  readonly applyOperator: (input: GPUBuffer, output: GPUBuffer) => Promise<void>;
  readonly precondition: (residual: GPUBuffer, output: GPUBuffer) => Promise<void>;
  readonly dot: (left: GPUBuffer, right: GPUBuffer) => Promise<number>;
  readonly axpy: (
    target: GPUBuffer, source: GPUBuffer, sourceScale: number, targetScale: number,
  ) => Promise<void>;
  readonly residualNorm: (residual: GPUBuffer, rhs: GPUBuffer) => Promise<number>;
  readonly checkIteration: () => void;
  readonly emit: (iteration: number) => void;
  readonly diverged: (message: string) => Error;
}

export interface BufferPcgOptions {
  readonly maxIterations: number;
  readonly tolerance: number;
}

export interface BufferPcgResult {
  readonly iterations: number;
  readonly relativeResidual: number;
}

export async function runBufferPcg(
  vectors: BufferPcgVectors,
  callbacks: BufferPcgCallbacks,
  options: BufferPcgOptions,
): Promise<BufferPcgResult> {
  callbacks.checkIteration();
  await callbacks.initialize(vectors);
  await callbacks.applyOperator(vectors.direction, vectors.product);
  const rhsNormSquared = await callbacks.dot(vectors.rhs, vectors.rhs);
  let rz = await callbacks.dot(vectors.residual, vectors.preconditioned);
  let denominator = await callbacks.dot(vectors.direction, vectors.product);
  if (![rhsNormSquared, rz, denominator].every(Number.isFinite)) {
    throw callbacks.diverged("PCG initialization did not produce positive finite reductions");
  }
  if (rhsNormSquared === 0 && rz === 0 && denominator === 0) {
    return { iterations: 0, relativeResidual: 0 };
  }
  if (rhsNormSquared <= 0 || rz <= 0 || denominator <= 0) {
    throw callbacks.diverged("PCG initialization did not produce positive finite reductions");
  }
  let relativeResidual = 1;
  let iterations = 0;
  for (let iteration = 0; iteration < options.maxIterations; iteration += 1) {
    callbacks.checkIteration();
    if (iteration > 0) {
      await callbacks.applyOperator(vectors.direction, vectors.product);
      denominator = await callbacks.dot(vectors.direction, vectors.product);
    }
    if (!Number.isFinite(denominator) || denominator <= 0) {
      throw callbacks.diverged("PCG operator is not positive definite");
    }
    const alpha = rz / denominator;
    await callbacks.axpy(vectors.solution, vectors.direction, alpha, 1);
    await callbacks.axpy(vectors.residual, vectors.product, -alpha, 1);
    relativeResidual = await callbacks.residualNorm(vectors.residual, vectors.rhs);
    iterations = iteration + 1;
    if (!Number.isFinite(relativeResidual)) throw callbacks.diverged("PCG residual became non-finite");
    callbacks.emit(iterations);
    callbacks.checkIteration();
    if (relativeResidual <= options.tolerance) break;
    await callbacks.precondition(vectors.residual, vectors.preconditioned);
    const nextRz = await callbacks.dot(vectors.residual, vectors.preconditioned);
    if (!Number.isFinite(nextRz) || nextRz <= 0) {
      throw callbacks.diverged("PCG preconditioned residual is not positive finite");
    }
    await callbacks.axpy(vectors.direction, vectors.preconditioned, 1, nextRz / rz);
    rz = nextRz;
  }
  if (relativeResidual > options.tolerance) {
    throw callbacks.diverged(`PCG reached ${options.maxIterations} iterations at residual ${relativeResidual}`);
  }
  return { iterations, relativeResidual };
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
