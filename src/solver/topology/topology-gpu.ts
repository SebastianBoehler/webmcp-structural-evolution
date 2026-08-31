import {
  acquireStructuralGpu, createDeviceGuard, safeDestroy, StructuralGpuError, withStructuralGpuErrorScopes,
  type StructuralGpuAcquisitionObserver,
} from "../structural/structural-gpu-runtime";
import filterShader from "./density-filter.wgsl?raw";
export { minimumComplianceDirection, updateTopologyFromCompliance as updateTopologyDensity } from "./compliance-update-gpu";

type Dimensions = readonly [number, number, number];

function validateField(field: Float32Array, count: number, name: string): void {
  if (!(field instanceof Float32Array) || field.length !== count
    || field.some((value) => !Number.isFinite(value))) {
    throw new StructuralGpuError("invalid-input", `${name} must be a finite Float32Array matching the topology grid`);
  }
}

function params(
  dimensions: Dimensions,
  count: number,
  radius: number,
  moveLimit: number,
  volumeScale: number,
  maximumSensitivity: number,
): ArrayBuffer {
  const data = new ArrayBuffer(32);
  new Uint32Array(data, 0, 5).set([...dimensions, radius, count]);
  new Float32Array(data, 20, 3).set([moveLimit, volumeScale, maximumSensitivity]);
  return data;
}

async function runKernel(
  shaderCode: string,
  entryPoint: string,
  density: Float32Array,
  auxiliary: Float32Array,
  parameterData: ArrayBuffer,
  signal: AbortSignal,
  observer?: StructuralGpuAcquisitionObserver,
): Promise<Float32Array> {
  const device = await acquireStructuralGpu(signal, observer);
  const guard = createDeviceGuard(device, signal);
  const buffers: GPUBuffer[] = [];
  try {
    return await withStructuralGpuErrorScopes(device, guard, async () => {
      const bytes = density.byteLength;
      if (bytes > device.limits.maxBufferSize || bytes > device.limits.maxStorageBufferBindingSize) {
        throw new StructuralGpuError("resource-limit", "Topology density exceeds the WebGPU storage-buffer limit");
      }
      const create = (label: string, size: number, usage: GPUBufferUsageFlags) => {
        const buffer = device.createBuffer({ label, size, usage }); buffers.push(buffer); return buffer;
      };
      const input = create("topology-density-input", bytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      const aux = create("topology-sensitivity-input", bytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
      const output = create("topology-density-output", bytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
      const uniform = create("topology-params", 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      const readback = create("topology-density-readback", bytes, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
      device.queue.writeBuffer(input, 0, density);
      device.queue.writeBuffer(aux, 0, auxiliary);
      device.queue.writeBuffer(uniform, 0, parameterData);
      const module = device.createShaderModule({ code: shaderCode });
      const info = await guard.race(module.getCompilationInfo());
      const error = info.messages.find(({ type }) => type === "error");
      if (error) throw new Error(`Topology shader compilation failed: ${error.message}`);
      const layout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      ] });
      const pipeline = await guard.race(device.createComputePipelineAsync({
        layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        compute: { module, entryPoint },
      }));
      const group = device.createBindGroup({ layout, entries: [
        { binding: 0, resource: { buffer: input } }, { binding: 1, resource: { buffer: aux } },
        { binding: 2, resource: { buffer: output } }, { binding: 3, resource: { buffer: uniform } },
      ] });
      const workgroups = Math.ceil(density.length / 64);
      if (workgroups > device.limits.maxComputeWorkgroupsPerDimension) {
        throw new StructuralGpuError("resource-limit", "Topology density exceeds the WebGPU workgroup limit");
      }
      const encoder = device.createCommandEncoder({ label: entryPoint });
      const pass = encoder.beginComputePass({ label: entryPoint });
      pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(workgroups); pass.end();
      encoder.copyBufferToBuffer(output, 0, readback, 0, bytes);
      device.queue.submit([encoder.finish()]);
      await guard.race(device.queue.onSubmittedWorkDone());
      await guard.race(readback.mapAsync(GPUMapMode.READ, 0, bytes));
      const result = new Float32Array(readback.getMappedRange(0, bytes).slice(0));
      readback.unmap();
      if (result.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
        throw new StructuralGpuError("diverged", "Topology WebGPU kernel returned an invalid density");
      }
      return result;
    });
  } finally {
    for (const buffer of buffers) try { buffer.destroy(); } catch { /* already lost */ }
    safeDestroy(device);
  }
}

export async function filterTopologyDensity(
  density: Float32Array,
  dimensions: Dimensions,
  radiusCells: number,
  designDomain: Uint32Array,
  signal: AbortSignal,
  observer?: StructuralGpuAcquisitionObserver,
): Promise<Float32Array> {
  const count = dimensions.reduce((product, value) => product * value, 1);
  validateField(density, count, "Topology density");
  if (!Number.isInteger(radiusCells) || radiusCells < 1 || radiusCells > 8) {
    throw new StructuralGpuError("invalid-input", "Topology filter radius must resolve to 1 through 8 cells");
  }
  if (designDomain.length !== count || designDomain.some((value) => value !== 0 && value !== 1)) {
    throw new StructuralGpuError("invalid-input", "Topology filter design domain is invalid");
  }
  return runKernel(filterShader, "filter_density", density, Float32Array.from(designDomain),
    params(dimensions, count, radiusCells, 0, 1, 1), signal, observer);
}
