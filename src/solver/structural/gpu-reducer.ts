import type { StructuralPipelines } from "./gpu-pipelines";
import type { StructuralGpuResources } from "./gpu-resources";
import {
  submitAndWait,
  type DeviceGuard,
} from "./structural-gpu-runtime";

const WORKGROUP_SIZE = 64;

function binding(binding: number, buffer: GPUBuffer): GPUBindGroupEntry {
  return { binding, resource: { buffer } };
}

export function createGpuReducer(
  device: GPUDevice,
  guard: DeviceGuard,
  pipelines: StructuralPipelines,
  resources: StructuralGpuResources,
) {
  const writeParams = (count: number, stride = 1, offset = 0) => {
    device.queue.writeBuffer(
      resources.reductionParams, 0, new Uint32Array([count, stride, offset, 0]),
    );
  };
  const dispatch = async (
    pipeline: GPUComputePipeline,
    left: GPUBuffer,
    right: GPUBuffer,
    output: GPUBuffer,
    count: number,
    label: string,
  ): Promise<number> => {
    const groups = Math.ceil(count / WORKGROUP_SIZE);
    const bindGroup = device.createBindGroup({
      layout: pipelines.reductionLayout,
      entries: [binding(0, resources.reductionParams), binding(1, left), binding(2, right), binding(3, output)],
    });
    await submitAndWait(device, guard, pipeline, bindGroup, groups, label);
    return groups;
  };
  const finish = async (source: GPUBuffer): Promise<number> => {
    const encoder = device.createCommandEncoder({ label: "structural-reduction-readback" });
    encoder.copyBufferToBuffer(source, 0, resources.scalarReadback, 0, 4);
    device.queue.submit([encoder.finish()]);
    await guard.race(device.queue.onSubmittedWorkDone());
    await guard.race(resources.scalarReadback.mapAsync(GPUMapMode.READ, 0, 4));
    const value = new Float32Array(resources.scalarReadback.getMappedRange(0, 4).slice(0))[0]!;
    resources.scalarReadback.unmap();
    guard.check();
    return value;
  };
  const reduce = async (
    pipeline: GPUComputePipeline,
    left: GPUBuffer,
    right: GPUBuffer,
    count: number,
    stride = 1,
    offset = 0,
  ): Promise<number> => {
    writeParams(count, stride, offset);
    let remaining = await dispatch(pipeline, left, right, resources.partialA, count, "structural-reduction-first");
    let source = resources.partialA;
    let destination = resources.partialB;
    while (remaining > 1) {
      writeParams(remaining);
      remaining = await dispatch(
        pipelines.reduceSum, source, source, destination, remaining, "structural-reduction-next",
      );
      [source, destination] = [destination, source];
    }
    return finish(source);
  };
  return {
    dot: (left: GPUBuffer, right: GPUBuffer, count: number) =>
      reduce(pipelines.dotProduct, left, right, count),
    sumStrided: (values: GPUBuffer, count: number, stride: number, offset: number) =>
      reduce(pipelines.sumStrided, values, values, count, stride, offset),
  };
}
