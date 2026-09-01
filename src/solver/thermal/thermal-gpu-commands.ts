import type { BufferPcgCallbacks, BufferPcgVectors } from "../structural/pcg";
import { StructuralGpuError, submitAndWait, type DeviceGuard } from "../structural/structural-gpu-runtime";
import type { ThermalGpuPipelines } from "./thermal-gpu-pipelines";
import type { ThermalGpuResources } from "./thermal-gpu-resources";

const WORKGROUP_SIZE = 64;
const entry = (binding: number, buffer: GPUBuffer): GPUBindGroupEntry => ({ binding, resource: { buffer } });

async function dispatch(
  device: GPUDevice, guard: DeviceGuard, pipeline: GPUComputePipeline,
  group: GPUBindGroup, count: number, label: string,
) {
  await submitAndWait(device, guard, pipeline, group, Math.ceil(count / WORKGROUP_SIZE), label);
}

function writeVectorParams(
  device: GPUDevice, buffer: GPUBuffer, count: number, sourceScale = 0, targetScale = 0,
) {
  const raw = new ArrayBuffer(16);
  new Uint32Array(raw)[0] = count;
  new Float32Array(raw)[2] = sourceScale;
  new Float32Array(raw)[3] = targetScale;
  device.queue.writeBuffer(buffer, 0, raw);
}

function vectorGroup(
  device: GPUDevice, pipelines: ThermalGpuPipelines, resources: ThermalGpuResources,
  source: GPUBuffer, target: GPUBuffer,
) {
  return device.createBindGroup({ layout: pipelines.vectorLayout, entries: [
    entry(0, resources.vectorParams), entry(1, source), entry(2, target), entry(3, resources.diagonal),
    entry(4, resources.fixed), entry(5, resources.fixedTemperature),
  ] });
}

export async function buildThermalSystem(
  device: GPUDevice, guard: DeviceGuard, pipelines: ThermalGpuPipelines,
  resources: ThermalGpuResources, count: number,
) {
  const group = device.createBindGroup({ layout: pipelines.systemLayout, entries: [
    entry(0, resources.gridParams), entry(1, resources.active), entry(2, resources.fixed),
    entry(3, resources.conductivity), entry(4, resources.fixedTemperature),
    entry(5, resources.sourcePower), entry(6, resources.rhs), entry(7, resources.diagonal),
  ] });
  await dispatch(device, guard, pipelines.buildSystem, group, count, "thermal-build-system");
}

async function applyOperator(
  device: GPUDevice, guard: DeviceGuard, pipelines: ThermalGpuPipelines,
  resources: ThermalGpuResources, input: GPUBuffer, output: GPUBuffer, count: number,
) {
  const group = device.createBindGroup({ layout: pipelines.operatorLayout, entries: [
    entry(0, resources.gridParams), entry(1, resources.active), entry(2, resources.fixed),
    entry(3, resources.conductivity), entry(6, input), entry(7, output), entry(8, resources.diagonal),
  ] });
  await dispatch(device, guard, pipelines.applyConduction, group, count, "thermal-apply-conduction");
}

function createReducer(
  device: GPUDevice, guard: DeviceGuard, pipelines: ThermalGpuPipelines,
  resources: ThermalGpuResources,
) {
  const write = (count: number) => device.queue.writeBuffer(
    resources.reductionParams, 0, new Uint32Array([count, 1, 0, 0]),
  );
  const pass = async (
    pipeline: GPUComputePipeline, left: GPUBuffer, right: GPUBuffer,
    output: GPUBuffer, count: number, label: string,
  ) => {
    const groups = Math.ceil(count / WORKGROUP_SIZE);
    const group = device.createBindGroup({ layout: pipelines.reductionLayout, entries: [
      entry(0, resources.reductionParams), entry(1, left), entry(2, right), entry(3, output),
    ] });
    await dispatch(device, guard, pipeline, group, count, label);
    return groups;
  };
  return async (left: GPUBuffer, right: GPUBuffer, count: number) => {
    write(count);
    let remaining = await pass(pipelines.dotProduct, left, right, resources.partialA, count, "thermal-dot-first");
    let source = resources.partialA, destination = resources.partialB;
    while (remaining > 1) {
      write(remaining);
      remaining = await pass(pipelines.reduceSum, source, source, destination, remaining, "thermal-reduce-next");
      [source, destination] = [destination, source];
    }
    const encoder = device.createCommandEncoder({ label: "thermal-reduction-readback" });
    encoder.copyBufferToBuffer(source, 0, resources.scalarReadback, 0, 4);
    device.queue.submit([encoder.finish()]);
    await guard.race(device.queue.onSubmittedWorkDone());
    await guard.race(resources.scalarReadback.mapAsync(GPUMapMode.READ, 0, 4));
    const value = new Float32Array(resources.scalarReadback.getMappedRange(0, 4).slice(0))[0]!;
    resources.scalarReadback.unmap();
    guard.check();
    return value;
  };
}

export function createThermalPcgCallbacks(
  device: GPUDevice, guard: DeviceGuard, pipelines: ThermalGpuPipelines,
  resources: ThermalGpuResources, count: number, emit: (iteration: number) => void,
): { vectors: BufferPcgVectors; callbacks: BufferPcgCallbacks } {
  const dot = createReducer(device, guard, pipelines, resources);
  const vector = async (
    pipeline: GPUComputePipeline, source: GPUBuffer, target: GPUBuffer,
    label: string, sourceScale = 0, targetScale = 0,
  ) => {
    writeVectorParams(device, resources.vectorParams, count, sourceScale, targetScale);
    await dispatch(device, guard, pipeline, vectorGroup(device, pipelines, resources, source, target), count, label);
  };
  const vectors = {
    rhs: resources.rhs, solution: resources.solution, residual: resources.residual,
    preconditioned: resources.preconditioned, direction: resources.direction, product: resources.product,
  };
  return { vectors, callbacks: {
    initialize: async () => {
      await vector(pipelines.initializeSolution, resources.rhs, resources.solution, "thermal-initialize-solution");
      await vector(pipelines.copyVector, resources.rhs, resources.residual, "thermal-initialize-residual");
      await vector(pipelines.applyPreconditioner, resources.residual, resources.preconditioned, "thermal-initialize-preconditioner");
      await vector(pipelines.copyVector, resources.preconditioned, resources.direction, "thermal-initialize-direction");
    },
    applyOperator: (input, output) => applyOperator(device, guard, pipelines, resources, input, output, count),
    precondition: (residual, output) => vector(pipelines.applyPreconditioner, residual, output, "thermal-apply-preconditioner"),
    dot: (left, right) => dot(left, right, count),
    axpy: (target, source, sourceScale, targetScale) => vector(
      pipelines.axpy, source, target, "thermal-axpy", sourceScale, targetScale,
    ),
    residualNorm: async (residual, rhs) => {
      const residualSquared = await dot(residual, residual, count);
      const rhsSquared = await dot(rhs, rhs, count);
      return Math.sqrt(residualSquared / rhsSquared);
    },
    checkIteration: () => guard.check(), emit,
    diverged: (message) => new StructuralGpuError("diverged", `Thermal WebGPU ${message}`),
  } };
}

export async function deriveThermalFields(
  device: GPUDevice, guard: DeviceGuard, pipelines: ThermalGpuPipelines,
  resources: ThermalGpuResources, count: number,
) {
  const faceGroup = device.createBindGroup({ layout: pipelines.faceFluxLayout, entries: [
    entry(0, resources.gridParams), entry(1, resources.active),
    entry(3, resources.conductivity), entry(4, resources.solution),
    entry(5, resources.boundaryFaceHeatFlux), entry(6, resources.boundaryFaceAreas),
    entry(7, resources.faceHeatFlux), entry(8, resources.faceAreas),
  ] });
  await dispatch(device, guard, pipelines.deriveFaceHeatFlux, faceGroup, count, "thermal-derive-face-heat-flux");
  const projectionGroup = device.createBindGroup({ layout: pipelines.fluxProjectionLayout, entries: [
    entry(0, resources.gridParams), entry(7, resources.faceHeatFlux),
    entry(8, resources.faceAreas), entry(9, resources.heatFlux),
  ] });
  await dispatch(device, guard, pipelines.projectHeatFlux, projectionGroup, count, "thermal-project-heat-flux");
  const thermostatGroup = device.createBindGroup({ layout: pipelines.thermostatLayout, entries: [
    entry(0, resources.gridParams), entry(1, resources.active), entry(2, resources.fixed),
    entry(3, resources.conductivity), entry(4, resources.solution),
    entry(10, resources.thermostatPower), entry(11, resources.sourcePower),
  ] });
  await dispatch(device, guard, pipelines.deriveThermostatPower, thermostatGroup, count, "thermal-derive-thermostat-power");
  return {
    temperatureK: await readThermalField(device, guard, resources.solution, resources.fieldReadback, count),
    heatFluxWm2: await readThermalField(device, guard, resources.heatFlux, resources.fieldReadback, count * 3),
    faceHeatFluxWm2: await readThermalField(device, guard, resources.faceHeatFlux, resources.fieldReadback, count * 6),
    faceAreasM2: await readThermalField(device, guard, resources.faceAreas, resources.fieldReadback, count * 6),
    thermostatPowerW: await readThermalField(device, guard, resources.thermostatPower, resources.fieldReadback, count),
  };
}

export async function addThermalReferenceTemperature(
  device: GPUDevice, guard: DeviceGuard, pipelines: ThermalGpuPipelines,
  resources: ThermalGpuResources, count: number,
) {
  writeVectorParams(device, resources.vectorParams, count, resources.referenceTemperatureK, 1);
  await dispatch(
    device, guard, pipelines.addOffset,
    vectorGroup(device, pipelines, resources, resources.rhs, resources.solution),
    count, "thermal-add-reference-temperature",
  );
}

async function readThermalField(
  device: GPUDevice, guard: DeviceGuard, source: GPUBuffer, readback: GPUBuffer, count: number,
) {
  const bytes = count * 4;
  const encoder = device.createCommandEncoder({ label: "thermal-field-readback" });
  encoder.copyBufferToBuffer(source, 0, readback, 0, bytes);
  device.queue.submit([encoder.finish()]);
  await guard.race(device.queue.onSubmittedWorkDone());
  await guard.race(readback.mapAsync(GPUMapMode.READ, 0, bytes));
  const values = new Float32Array(readback.getMappedRange(0, bytes).slice(0));
  readback.unmap();
  guard.check();
  return values;
}
