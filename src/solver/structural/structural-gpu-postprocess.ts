import { createGpuReducer } from "./gpu-reducer";
import { createStructuralPipelines, type StructuralPipelines } from "./gpu-pipelines";
import { createStructuralGpuResources, type StructuralGpuResources } from "./gpu-resources";
import {
  dispatchVector,
  elasticityGroup,
  readField,
  vectorGroup,
  writeVectorParams,
} from "./structural-gpu-commands";
import type { CompiledStructuralSystem } from "./structural-contract";
import {
  createDeviceGuard,
  type DeviceGuard,
  StructuralGpuError,
  withStructuralGpuErrorScopes,
} from "./structural-gpu-runtime";

export interface StructuralGpuPostprocess {
  readonly vonMisesStressPa: Float32Array;
  readonly recomputedF32RelativeResidual: number;
  readonly forceBalanceErrorN: number;
  readonly complianceJ: number;
}

function appliedVector(rhsN: Float32Array): readonly [number, number, number] {
  const result: [number, number, number] = [0, 0, 0];
  for (let dof = 0; dof < rhsN.length; dof += 1) result[dof % 3] += rhsN[dof]!;
  return result;
}

export async function postprocessStructuralResources(
  device: GPUDevice,
  guard: DeviceGuard,
  pipelines: StructuralPipelines,
  resources: StructuralGpuResources,
  system: CompiledStructuralSystem,
  rhsN: Float32Array,
): Promise<StructuralGpuPostprocess> {
  const dofCount = system.fixedDofs.length;
  const nodeCount = dofCount / 3;
  const vector = vectorGroup(device, pipelines, resources);
  const reducer = createGpuReducer(device, guard, pipelines, resources);
  await dispatchVector(
    device, guard, pipelines.applyElasticity,
    elasticityGroup(device, pipelines, resources, resources.x, resources.product),
    dofCount, "structural-final-apply",
  );
  writeVectorParams(device, resources.vectorParams, dofCount);
  await dispatchVector(device, guard, pipelines.recomputeResidual, vector, dofCount, "structural-final-residual");
  const residualSquared = await reducer.dot(resources.r, resources.r, dofCount);
  const rhsSquared = await reducer.dot(resources.rhs, resources.rhs, dofCount);
  if (![residualSquared, rhsSquared].every(Number.isFinite) || residualSquared < 0 || rhsSquared <= 0) {
    throw new StructuralGpuError("diverged", "Final GPU residual reductions are invalid");
  }
  await dispatchVector(device, guard, pipelines.maskReactions, vector, dofCount, "structural-final-reactions");
  const reaction: number[] = [];
  for (let axis = 0; axis < 3; axis += 1) {
    reaction.push(await reducer.sumStrided(resources.z, nodeCount, 3, axis));
  }
  const applied = appliedVector(rhsN);
  const forceBalanceErrorN = Math.hypot(...reaction.map((value, axis) => value + applied[axis]!));
  const complianceJ = await reducer.dot(resources.rhs, resources.x, dofCount);
  await dispatchVector(
    device, guard, pipelines.computeStress,
    elasticityGroup(device, pipelines, resources, resources.x, resources.stress),
    system.activeCells.length, "structural-final-stress",
  );
  const vonMisesStressPa = await readField(
    device, guard, resources.stress, resources.fieldReadback, system.activeCells.length,
  );
  const recomputedF32RelativeResidual = Math.sqrt(residualSquared / rhsSquared);
  if (!vonMisesStressPa.every((value) => Number.isFinite(value) && value >= 0)
    || ![recomputedF32RelativeResidual, forceBalanceErrorN, complianceJ].every(Number.isFinite)
    || complianceJ < 0) {
    throw new StructuralGpuError("diverged", "Final GPU postprocess fields or evidence are invalid");
  }
  return { vonMisesStressPa, recomputedF32RelativeResidual, forceBalanceErrorN, complianceJ };
}

export async function postprocessStructuralField(
  device: GPUDevice,
  system: CompiledStructuralSystem,
  signal: AbortSignal,
  displacementM: Float32Array,
): Promise<StructuralGpuPostprocess> {
  if (displacementM.length !== system.fixedDofs.length || !displacementM.every(Number.isFinite)) {
    throw new StructuralGpuError("invalid-input", "Refined structural field is invalid");
  }
  const guard = createDeviceGuard(device, signal);
  return withStructuralGpuErrorScopes(device, guard, async () => {
    const resources = createStructuralGpuResources(device, system);
    try {
      const pipelines = await createStructuralPipelines(device, guard);
      device.queue.writeBuffer(resources.x, 0, displacementM);
      return await postprocessStructuralResources(
        device, guard, pipelines, resources, system, system.loadsN,
      );
    } finally {
      resources.destroy();
    }
  });
}
