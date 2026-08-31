import type { CompiledStructuralSystem } from "../structural/structural-contract";
import { buildHex8Stiffness } from "../structural/element-stiffness";
import {
  acquireStructuralGpu, createDeviceGuard, safeDestroy, StructuralGpuError, withStructuralGpuErrorScopes,
} from "../structural/structural-gpu-runtime";
import shader from "./sensitivity.wgsl?raw";

export function minimumComplianceDirection(
  elementEnergyJ: Float32Array,
  designDomain: Uint32Array,
): Float32Array {
  if (elementEnergyJ.length !== designDomain.length
    || elementEnergyJ.some((value) => !Number.isFinite(value) || value < 0)
    || designDomain.some((value) => value !== 0 && value !== 1)) {
    throw new StructuralGpuError("diverged", "Topology compliance sensitivity is invalid");
  }
  let maximum = 0, sum = 0, count = 0;
  for (let index = 0; index < elementEnergyJ.length; index += 1) {
    if (designDomain[index] === 0) continue;
    maximum = Math.max(maximum, elementEnergyJ[index]!); count += 1;
  }
  if (maximum === 0 || count === 0) return new Float32Array(elementEnergyJ.length);
  for (let index = 0; index < elementEnergyJ.length; index += 1) {
    if (designDomain[index] === 1) sum += elementEnergyJ[index]! / maximum;
  }
  const mean = sum / count;
  return Float32Array.from(elementEnergyJ, (value, index) =>
    designDomain[index] === 1 ? value / maximum - mean : 0);
}

function params(system: CompiledStructuralSystem, moveLimit: number): ArrayBuffer {
  const raw = new ArrayBuffer(48);
  new Uint32Array(raw, 0, 8).set([
    ...system.grid.cellDimensions, system.activeCells.length,
    ...system.grid.nodeDimensions, system.fixedDofs.length,
  ]);
  new Float32Array(raw, 32, 1)[0] = moveLimit;
  return raw;
}

export async function updateTopologyFromCompliance(
  density: Float32Array,
  displacementM: Float32Array,
  system: CompiledStructuralSystem,
  moveLimit: number,
  signal: AbortSignal,
): Promise<Float32Array> {
  const count = system.activeCells.length;
  if (density.length !== count || displacementM.length !== system.fixedDofs.length
    || density.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
    || displacementM.some((value) => !Number.isFinite(value))) {
    throw new StructuralGpuError("invalid-input", "Topology compliance update fields do not match the compiled system");
  }
  const device = await acquireStructuralGpu(signal);
  const guard = createDeviceGuard(device, signal);
  const buffers: GPUBuffer[] = [];
  try {
    return await withStructuralGpuErrorScopes(device, guard, async () => {
      const create = (label: string, size: number, usage: GPUBufferUsageFlags) => {
        if (size > device.limits.maxBufferSize
          || (usage & GPUBufferUsage.STORAGE) !== 0 && size > device.limits.maxStorageBufferBindingSize) {
          throw new StructuralGpuError("resource-limit", `${label} exceeds WebGPU buffer limits`);
        }
        const buffer = device.createBuffer({ label, size: Math.max(4, size), usage });
        buffers.push(buffer); return buffer;
      };
      const stiffness = buildHex8Stiffness(
        system.material.youngsModulusPa, system.material.poissonRatio, system.grid.cellSizeM,
      );
      const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
      const uniform = create("topology-compliance-params", 48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      const densityBuffer = create("topology-density", density.byteLength, storage);
      const domainBuffer = create("topology-domain", system.activeCells.byteLength, storage);
      const displacementBuffer = create("topology-displacement", displacementM.byteLength, storage);
      const stiffnessBuffer = create("topology-stiffness", stiffness.byteLength, storage);
      const energyBuffer = create("topology-energy", density.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
      const directionBuffer = create("topology-direction", density.byteLength, storage);
      const outputBuffer = create("topology-output", density.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
      const readback = create("topology-readback", density.byteLength, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ);
      for (const [buffer, value] of [
        [uniform, params(system, moveLimit)], [densityBuffer, density], [domainBuffer, system.activeCells],
        [displacementBuffer, displacementM], [stiffnessBuffer, stiffness],
      ] as const) device.queue.writeBuffer(buffer, 0, value);
      const module = device.createShaderModule({ code: shader });
      const info = await guard.race(module.getCompilationInfo());
      const compilationError = info.messages.find(({ type }) => type === "error");
      if (compilationError) throw new StructuralGpuError("internal-error", compilationError.message);
      const entries = [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" as const } },
        ...[1, 2, 3, 4, 6].map((binding) => ({
          binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" as const },
        })),
        ...[5, 7].map((binding) => ({
          binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" as const },
        })),
      ];
      const layout = device.createBindGroupLayout({ entries });
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
      const pipeline = async (entryPoint: string) => guard.race(device.createComputePipelineAsync({
        layout: pipelineLayout, compute: { module, entryPoint },
      }));
      const energyPipeline = await pipeline("compute_compliance_sensitivity");
      const updatePipeline = await pipeline("update_density");
      const group = device.createBindGroup({ layout, entries: [
        uniform, densityBuffer, domainBuffer, displacementBuffer, stiffnessBuffer,
        energyBuffer, directionBuffer, outputBuffer,
      ].map((buffer, binding) => ({ binding, resource: { buffer } })) });
      const dispatch = async (compute: GPUComputePipeline, output: GPUBuffer) => {
        const workgroups = Math.ceil(count / 64);
        if (workgroups > device.limits.maxComputeWorkgroupsPerDimension) {
          throw new StructuralGpuError("resource-limit", "Topology update exceeds the WebGPU workgroup limit");
        }
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(compute); pass.setBindGroup(0, group); pass.dispatchWorkgroups(workgroups); pass.end();
        encoder.copyBufferToBuffer(output, 0, readback, 0, density.byteLength);
        device.queue.submit([encoder.finish()]); await guard.race(device.queue.onSubmittedWorkDone());
        await guard.race(readback.mapAsync(GPUMapMode.READ, 0, density.byteLength));
        const result = new Float32Array(readback.getMappedRange(0, density.byteLength).slice(0));
        readback.unmap(); return result;
      };
      const energy = await dispatch(energyPipeline, energyBuffer);
      guard.check();
      device.queue.writeBuffer(directionBuffer, 0, minimumComplianceDirection(energy, system.activeCells));
      guard.check();
      const output = await dispatch(updatePipeline, outputBuffer);
      if (output.some((value, cell) => !Number.isFinite(value) || value < 0 || value > 1
        || system.activeCells[cell] === 0 && value !== 0)) {
        throw new StructuralGpuError("diverged", "Topology compliance update left its bounded design domain");
      }
      return output;
    });
  } finally {
    for (const buffer of buffers) try { buffer.destroy(); } catch { /* device lost */ }
    safeDestroy(device);
  }
}
