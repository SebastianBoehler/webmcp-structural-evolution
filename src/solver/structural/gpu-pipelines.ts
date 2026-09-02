import elasticitySource from "./elasticity.wgsl?raw";
import reductionSource from "./reduction.wgsl?raw";
import vectorSource from "./vector.wgsl?raw";
import {
  StructuralGpuError,
  type DeviceGuard,
} from "./structural-gpu-runtime";

export interface StructuralPipelines {
  readonly elasticityLayout: GPUBindGroupLayout;
  readonly vectorLayout: GPUBindGroupLayout;
  readonly reductionLayout: GPUBindGroupLayout;
  readonly applyElasticity: GPUComputePipeline;
  readonly buildDiagonal: GPUComputePipeline;
  readonly computeStress: GPUComputePipeline;
  readonly initializePcg: GPUComputePipeline;
  readonly updateSolutionResidual: GPUComputePipeline;
  readonly recomputeResidual: GPUComputePipeline;
  readonly applyPreconditioner: GPUComputePipeline;
  readonly updateDirection: GPUComputePipeline;
  readonly maskReactions: GPUComputePipeline;
  readonly dotProduct: GPUComputePipeline;
  readonly reduceSum: GPUComputePipeline;
  readonly sumStrided: GPUComputePipeline;
}

async function checkedModule(
  device: GPUDevice,
  guard: DeviceGuard,
  label: string,
  code: string,
): Promise<GPUShaderModule> {
  const module = device.createShaderModule({ label, code });
  const info = await guard.race(module.getCompilationInfo());
  const errors = info.messages.filter(({ type }) => type === "error");
  if (errors.length > 0) {
    throw new StructuralGpuError(
      "internal-error",
      `${label} compilation failed: ${errors.map(({ lineNum, linePos, message }) =>
        `${lineNum}:${linePos} ${message}`).join("; ")}`,
    );
  }
  return module;
}

function storage(binding: number, readOnly: boolean): GPUBindGroupLayoutEntry {
  return {
    binding, visibility: GPUShaderStage.COMPUTE,
    buffer: { type: readOnly ? "read-only-storage" : "storage" },
  };
}

function uniform(binding = 0): GPUBindGroupLayoutEntry {
  return { binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } };
}

async function pipeline(
  device: GPUDevice,
  guard: DeviceGuard,
  layout: GPUBindGroupLayout,
  module: GPUShaderModule,
  entryPoint: string,
): Promise<GPUComputePipeline> {
  try {
    return await guard.race(device.createComputePipelineAsync({
      label: `structural-${entryPoint}`,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint },
    }));
  } catch (error) {
    if (error instanceof StructuralGpuError || (error instanceof DOMException && error.name === "AbortError")) throw error;
    throw new StructuralGpuError(
      "internal-error",
      `Structural WebGPU pipeline ${entryPoint} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function createStructuralPipelines(
  device: GPUDevice,
  guard: DeviceGuard,
): Promise<StructuralPipelines> {
  const [elasticity, vector, reduction] = await Promise.all([
    checkedModule(device, guard, "structural-elasticity", elasticitySource),
    checkedModule(device, guard, "structural-vector", vectorSource),
    checkedModule(device, guard, "structural-reduction", reductionSource),
  ]);
  const elasticityLayout = device.createBindGroupLayout({
    entries: [uniform(), storage(1, true), storage(2, true), storage(3, true), storage(4, true), storage(5, false)],
  });
  const vectorLayout = device.createBindGroupLayout({
    entries: [uniform(), storage(1, true), storage(2, true), storage(3, false), storage(4, false),
      storage(5, false), storage(6, false), storage(7, true), storage(8, true), storage(9, false)],
  });
  const reductionLayout = device.createBindGroupLayout({
    entries: [uniform(), storage(1, true), storage(2, true), storage(3, false)],
  });
  const entries = await Promise.all([
    pipeline(device, guard, elasticityLayout, elasticity, "apply_elasticity"),
    pipeline(device, guard, elasticityLayout, elasticity, "build_block_diagonal"),
    pipeline(device, guard, elasticityLayout, elasticity, "compute_stress"),
    pipeline(device, guard, vectorLayout, vector, "initialize_pcg"),
    pipeline(device, guard, vectorLayout, vector, "update_solution_residual"),
    pipeline(device, guard, vectorLayout, vector, "recompute_residual"),
    pipeline(device, guard, vectorLayout, vector, "apply_preconditioner"),
    pipeline(device, guard, vectorLayout, vector, "update_direction"),
    pipeline(device, guard, vectorLayout, vector, "mask_reactions"),
    pipeline(device, guard, reductionLayout, reduction, "dot_product"),
    pipeline(device, guard, reductionLayout, reduction, "reduce_sum"),
    pipeline(device, guard, reductionLayout, reduction, "sum_strided"),
  ]);
  return {
    elasticityLayout, vectorLayout, reductionLayout,
    applyElasticity: entries[0], buildDiagonal: entries[1], computeStress: entries[2],
    initializePcg: entries[3], updateSolutionResidual: entries[4], recomputeResidual: entries[5],
    applyPreconditioner: entries[6], updateDirection: entries[7], maskReactions: entries[8],
    dotProduct: entries[9], reduceSum: entries[10], sumStrided: entries[11],
  };
}
