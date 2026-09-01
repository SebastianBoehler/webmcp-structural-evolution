import type { StructuralPipelines } from "./gpu-pipelines";
import type { StructuralGpuResources } from "./gpu-resources";
import {
  type DeviceGuard,
  submitAndWait,
} from "./structural-gpu-runtime";

const WORKGROUP_SIZE = 64;

function entry(binding: number, buffer: GPUBuffer): GPUBindGroupEntry {
  return { binding, resource: { buffer } };
}

export function elasticityGroup(
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

export function vectorGroup(
  device: GPUDevice,
  pipelines: StructuralPipelines,
  resources: StructuralGpuResources,
): GPUBindGroup {
  return device.createBindGroup({
    layout: pipelines.vectorLayout,
    entries: [
      entry(0, resources.vectorParams), entry(1, resources.fixed), entry(2, resources.rhs),
      entry(3, resources.x), entry(4, resources.r), entry(5, resources.z), entry(6, resources.p),
      entry(7, resources.product), entry(8, resources.blockDiagonal),
    ],
  });
}

export function writeVectorParams(
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

export async function dispatchVector(
  device: GPUDevice,
  guard: DeviceGuard,
  pipeline: GPUComputePipeline,
  group: GPUBindGroup,
  count: number,
  label: string,
): Promise<void> {
  await submitAndWait(device, guard, pipeline, group, Math.ceil(count / WORKGROUP_SIZE), label);
}

export async function readField(
  device: GPUDevice,
  guard: DeviceGuard,
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
