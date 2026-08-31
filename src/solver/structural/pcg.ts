import type { CompiledStructuralSystem } from "./structural-contract";
import { STRUCTURAL_MAX_ITERATIONS, STRUCTURAL_RESIDUAL_TOLERANCE } from "./structural-contract";
import { createStructuralPipelines, type StructuralPipelines } from "./gpu-pipelines";
import { createGpuReducer } from "./gpu-reducer";
import { createStructuralGpuResources, type StructuralGpuResources } from "./gpu-resources";
import {
  createDeviceGuard,
  StructuralGpuError,
  submitAndWait,
  withStructuralGpuErrorScopes,
} from "./structural-gpu-runtime";

const WORKGROUP_SIZE = 64;

export interface StructuralGpuSolve {
  readonly displacementM: Float32Array;
  readonly vonMisesStressPa: Float32Array;
  readonly iterations: number;
  readonly relativeResidual: number;
  readonly forceBalanceErrorN: number;
  readonly complianceJ: number;
}

function entry(binding: number, buffer: GPUBuffer): GPUBindGroupEntry {
  return { binding, resource: { buffer } };
}

function elasticityGroup(
  device: GPUDevice,
  pipelines: StructuralPipelines,
  resources: StructuralGpuResources,
  input: GPUBuffer,
  output: GPUBuffer,
): GPUBindGroup {
  return device.createBindGroup({
    layout: pipelines.elasticityLayout,
    entries: [
      entry(0, resources.gridParams), entry(1, resources.active), entry(2, resources.fixed),
      entry(3, resources.stiffness), entry(4, input), entry(5, output),
    ],
  });
}

function vectorGroup(
  device: GPUDevice,
  pipelines: StructuralPipelines,
  resources: StructuralGpuResources,
): GPUBindGroup {
  return device.createBindGroup({
    layout: pipelines.vectorLayout,
    entries: [
      entry(0, resources.vectorParams), entry(1, resources.fixed), entry(2, resources.rhs),
      entry(3, resources.x), entry(4, resources.r), entry(5, resources.z), entry(6, resources.p),
      entry(7, resources.product), entry(8, resources.diagonal),
    ],
  });
}

function writeVectorParams(
  device: GPUDevice,
  buffer: GPUBuffer,
  count: number,
  alpha = 0,
  beta = 0,
): void {
  const raw = new ArrayBuffer(16);
  new Uint32Array(raw)[0] = count;
  new Float32Array(raw)[2] = alpha;
  new Float32Array(raw)[3] = beta;
  device.queue.writeBuffer(buffer, 0, raw);
}

async function dispatchVector(
  device: GPUDevice,
  guard: ReturnType<typeof createDeviceGuard>,
  pipeline: GPUComputePipeline,
  group: GPUBindGroup,
  count: number,
  label: string,
): Promise<void> {
  await submitAndWait(device, guard, pipeline, group, Math.ceil(count / WORKGROUP_SIZE), label);
}

async function readField(
  device: GPUDevice,
  guard: ReturnType<typeof createDeviceGuard>,
  source: GPUBuffer,
  readback: GPUBuffer,
  count: number,
): Promise<Float32Array> {
  const bytes = count * Float32Array.BYTES_PER_ELEMENT;
  const encoder = device.createCommandEncoder({ label: "structural-field-readback" });
  encoder.copyBufferToBuffer(source, 0, readback, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await guard.race(device.queue.onSubmittedWorkDone());
  await guard.race(readback.mapAsync(GPUMapMode.READ, 0, bytes));
  const result = new Float32Array(readback.getMappedRange(0, bytes).slice(0));
  readback.unmap();
  guard.check();
  return result;
}

function finiteFields(...fields: readonly Float32Array[]): boolean {
  return fields.every((field) => field.every(Number.isFinite));
}

export async function runStructuralPcg(
  device: GPUDevice,
  system: CompiledStructuralSystem,
  signal: AbortSignal,
  emit: (progress: number) => void,
): Promise<StructuralGpuSolve> {
  const guard = createDeviceGuard(device, signal);
  return withStructuralGpuErrorScopes(device, guard, async () => {
    const resources = createStructuralGpuResources(device, system);
    try {
      const pipelines = await createStructuralPipelines(device, guard);
      const vector = vectorGroup(device, pipelines, resources);
      const dofCount = system.fixedDofs.length;
      const nodeCount = dofCount / 3;
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
        throw new StructuralGpuError("diverged", `WebGPU PCG reached ${STRUCTURAL_MAX_ITERATIONS} iterations`);
      }
      await dispatchVector(
        device, guard, pipelines.applyElasticity,
        elasticityGroup(device, pipelines, resources, resources.x, resources.product),
        dofCount, "structural-reactions",
      );
      writeVectorParams(device, resources.vectorParams, dofCount);
      await dispatchVector(device, guard, pipelines.maskReactions, vector, dofCount, "structural-mask-reactions");
      const reaction: number[] = [];
      for (let axis = 0; axis < 3; axis += 1) {
        reaction.push(await reducer.sumStrided(resources.z, nodeCount, 3, axis));
      }
      const applied = [0, 1, 2].map((axis) => {
        let sum = 0;
        for (let dof = axis; dof < dofCount; dof += 3) sum += system.loadsN[dof]!;
        return sum;
      });
      const forceBalanceErrorN = Math.hypot(...reaction.map((value, axis) => value + applied[axis]!));
      const complianceJ = await reducer.dot(resources.rhs, resources.x, dofCount);
      await dispatchVector(
        device, guard, pipelines.computeStress,
        elasticityGroup(device, pipelines, resources, resources.x, resources.stress),
        system.activeCells.length, "structural-compute-stress",
      );
      const displacementM = await readField(device, guard, resources.x, resources.fieldReadback, dofCount);
      const vonMisesStressPa = await readField(
        device, guard, resources.stress, resources.fieldReadback, system.activeCells.length,
      );
      if (!finiteFields(displacementM, vonMisesStressPa) || !Number.isFinite(forceBalanceErrorN)
        || !Number.isFinite(complianceJ) || complianceJ < 0) {
        throw new StructuralGpuError("diverged", "WebGPU structural fields or evidence are non-finite");
      }
      return {
        displacementM, vonMisesStressPa, iterations, relativeResidual,
        forceBalanceErrorN, complianceJ,
      };
    } finally {
      resources.destroy();
    }
  });
}
