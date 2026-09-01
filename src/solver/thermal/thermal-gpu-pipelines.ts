import reductionSource from "../structural/reduction.wgsl?raw";
import { StructuralGpuError, type DeviceGuard } from "../structural/structural-gpu-runtime";
import conductionSource from "./conduction.wgsl?raw";
import fluxSource from "./heat-flux.wgsl?raw";
import vectorSource from "./thermal-vector.wgsl?raw";

export interface ThermalGpuPipelines {
  readonly systemLayout: GPUBindGroupLayout;
  readonly operatorLayout: GPUBindGroupLayout;
  readonly vectorLayout: GPUBindGroupLayout;
  readonly reductionLayout: GPUBindGroupLayout;
  readonly faceFluxLayout: GPUBindGroupLayout;
  readonly fluxProjectionLayout: GPUBindGroupLayout;
  readonly thermostatLayout: GPUBindGroupLayout;
  readonly buildSystem: GPUComputePipeline;
  readonly applyConduction: GPUComputePipeline;
  readonly initializeSolution: GPUComputePipeline;
  readonly copyVector: GPUComputePipeline;
  readonly applyPreconditioner: GPUComputePipeline;
  readonly axpy: GPUComputePipeline;
  readonly addOffset: GPUComputePipeline;
  readonly dotProduct: GPUComputePipeline;
  readonly reduceSum: GPUComputePipeline;
  readonly deriveFaceHeatFlux: GPUComputePipeline;
  readonly projectHeatFlux: GPUComputePipeline;
  readonly deriveThermostatPower: GPUComputePipeline;
}

function storage(binding: number, readOnly: boolean): GPUBindGroupLayoutEntry {
  return { binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: readOnly ? "read-only-storage" : "storage" } };
}

const uniform = (binding = 0): GPUBindGroupLayoutEntry => ({
  binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" },
});

async function checkedModule(device: GPUDevice, guard: DeviceGuard, label: string, code: string) {
  const module = device.createShaderModule({ label, code });
  const errors = (await guard.race(module.getCompilationInfo())).messages.filter(({ type }) => type === "error");
  if (errors.length) throw new StructuralGpuError(
    "internal-error",
    `${label} compilation failed: ${errors.map(({ lineNum, linePos, message }) => `${lineNum}:${linePos} ${message}`).join("; ")}`,
  );
  return module;
}

async function pipeline(
  device: GPUDevice, guard: DeviceGuard, layout: GPUBindGroupLayout,
  module: GPUShaderModule, entryPoint: string,
) {
  try {
    return await guard.race(device.createComputePipelineAsync({
      label: `thermal-${entryPoint}`,
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint },
    }));
  } catch (error) {
    if (error instanceof StructuralGpuError || (error instanceof DOMException && error.name === "AbortError")) throw error;
    throw new StructuralGpuError("internal-error", `Thermal WebGPU pipeline ${entryPoint} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function createThermalGpuPipelines(device: GPUDevice, guard: DeviceGuard): Promise<ThermalGpuPipelines> {
  const [conduction, vector, reduction, flux] = await Promise.all([
    checkedModule(device, guard, "thermal-conduction", conductionSource),
    checkedModule(device, guard, "thermal-vector", vectorSource),
    checkedModule(device, guard, "thermal-reduction", reductionSource),
    checkedModule(device, guard, "thermal-heat-flux", fluxSource),
  ]);
  const systemLayout = device.createBindGroupLayout({ entries: [
    uniform(), storage(1, true), storage(2, true), storage(3, true), storage(4, true),
    storage(5, true), storage(6, false), storage(7, false),
  ] });
  const operatorLayout = device.createBindGroupLayout({ entries: [
    uniform(), storage(1, true), storage(2, true), storage(3, true),
    storage(6, false), storage(7, false), storage(8, true),
  ] });
  const vectorLayout = device.createBindGroupLayout({ entries: [
    uniform(), storage(1, true), storage(2, false), storage(3, true),
    storage(4, true), storage(5, true),
  ] });
  const reductionLayout = device.createBindGroupLayout({ entries: [
    uniform(), storage(1, true), storage(2, true), storage(3, false),
  ] });
  const faceFluxLayout = device.createBindGroupLayout({ entries: [
    uniform(), storage(1, true), storage(3, true), storage(4, true), storage(5, true),
    storage(6, true), storage(7, false), storage(8, false),
  ] });
  const fluxProjectionLayout = device.createBindGroupLayout({ entries: [
    uniform(), storage(7, false), storage(8, false), storage(9, false),
  ] });
  const thermostatLayout = device.createBindGroupLayout({ entries: [
    uniform(), storage(1, true), storage(2, true), storage(3, true), storage(4, true),
    storage(10, false), storage(11, true),
  ] });
  const values = await Promise.all([
    pipeline(device, guard, systemLayout, conduction, "build_system"),
    pipeline(device, guard, operatorLayout, conduction, "apply_conduction"),
    pipeline(device, guard, vectorLayout, vector, "initialize_pcg"),
    pipeline(device, guard, vectorLayout, vector, "copy_vector"),
    pipeline(device, guard, vectorLayout, vector, "apply_preconditioner"),
    pipeline(device, guard, vectorLayout, vector, "axpy"),
    pipeline(device, guard, vectorLayout, vector, "add_offset"),
    pipeline(device, guard, reductionLayout, reduction, "dot_product"),
    pipeline(device, guard, reductionLayout, reduction, "reduce_sum"),
    pipeline(device, guard, faceFluxLayout, flux, "derive_face_heat_flux"),
    pipeline(device, guard, fluxProjectionLayout, flux, "project_heat_flux"),
    pipeline(device, guard, thermostatLayout, flux, "derive_thermostat_power"),
  ]);
  return {
    systemLayout, operatorLayout, vectorLayout, reductionLayout,
    faceFluxLayout, fluxProjectionLayout, thermostatLayout,
    buildSystem: values[0], applyConduction: values[1], initializeSolution: values[2],
    copyVector: values[3], applyPreconditioner: values[4], axpy: values[5], addOffset: values[6],
    dotProduct: values[7], reduceSum: values[8], deriveFaceHeatFlux: values[9],
    projectHeatFlux: values[10], deriveThermostatPower: values[11],
  };
}
