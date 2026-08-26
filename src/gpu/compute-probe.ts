import { relativeL2 } from "../reference";
import type { VoxelGrid } from "../viewer/field-instances";
import { acquireWebGpu } from "./capabilities";
import {
  expectedProbe,
  PROBE_TOLERANCE,
  type ProbeInput,
  validateProbeInput,
} from "./probe-contract";
import {
  compileShader,
  destroyBuffer,
  deviceLossGuard,
  errorMessage,
  type ProbeFailureCode,
  ProbeCanceledError,
  ProbeStageError,
  withErrorScopes,
} from "./probe-runtime";
import probeShader from "./probe.wgsl?raw";

export type { ProbeFailureCode } from "./probe-runtime";

const WORKGROUP_SIZE = 64;
const PARAMS_BYTE_SIZE = 16;

interface ProbeMetrics {
  readonly elapsedMs: number;
  readonly relativeL2: number;
  readonly tolerance: number;
}

export interface TopologyMetrics {
  readonly solver: "sparse-simp-lattice-wasm";
  readonly initialCompliance: number;
  readonly finalCompliance: number;
  readonly maxDisplacement: number;
  readonly maxStress: number;
  readonly minimumSafetyFactor: number;
  readonly materialFraction: number;
  readonly iterations: number;
}

export type ProbeResult =
  | ({ readonly status: "verified"; readonly output: Float32Array; readonly topology?: TopologyMetrics; readonly grid?: VoxelGrid } & ProbeMetrics)
  | ({
      readonly status: "mismatch";
      readonly code: "verification-mismatch";
      readonly message: string;
    } & ProbeMetrics)
  | {
      readonly status: "canceled";
      readonly code: "canceled";
      readonly message: string;
      readonly elapsedMs: number;
    }
  | {
      readonly status: "failed";
      readonly code: ProbeFailureCode;
      readonly message: string;
      readonly elapsedMs: number;
    };

function elapsedSince(startedAt: number): number {
  return performance.now() - startedAt;
}

function canceled(startedAt: number): ProbeResult {
  return {
    status: "canceled",
    code: "canceled",
    message: "Topology optimization canceled by the user.",
    elapsedMs: elapsedSince(startedAt),
  };
}

export async function runComputeProbe(input: ProbeInput, signal?: AbortSignal): Promise<ProbeResult> {
  const startedAt = performance.now();
  if (signal?.aborted) return canceled(startedAt);
  try {
    validateProbeInput(input);
  } catch (error) {
    return {
      status: "failed",
      code: "invalid-input",
      message: `Invalid compute probe input: ${errorMessage(error)}`,
      elapsedMs: elapsedSince(startedAt),
    };
  }

  const acquisition = await acquireWebGpu();
  if (signal?.aborted) {
    if (acquisition.status === "available") acquisition.device.destroy();
    return canceled(startedAt);
  }
  if (acquisition.status !== "available") {
    return { ...acquisition, status: "failed", elapsedMs: elapsedSince(startedAt) };
  }

  const { device } = acquisition;
  const guard = deviceLossGuard(device, signal);
  let inputBuffer: GPUBuffer | undefined;
  let outputBuffer: GPUBuffer | undefined;
  let paramsBuffer: GPUBuffer | undefined;
  let readbackBuffer: GPUBuffer | undefined;
  let readbackMapped = false;

  try {
    guard.check();
    const byteSize = input.values.byteLength;
    if (byteSize > device.limits.maxBufferSize || byteSize > device.limits.maxStorageBufferBindingSize) {
      throw new ProbeStageError(
        "device-error",
        `Probe buffer requires ${byteSize} bytes, exceeding this device's WebGPU limits.`,
      );
    }

    await withErrorScopes(device, "device-error", "GPU buffer creation failed", () => {
      inputBuffer = device.createBuffer({
        label: "probe-input",
        size: byteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      outputBuffer = device.createBuffer({
        label: "probe-output",
        size: byteSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      paramsBuffer = device.createBuffer({
        label: "probe-params",
        size: PARAMS_BYTE_SIZE,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      readbackBuffer = device.createBuffer({
        label: "probe-readback",
        size: byteSize,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
    });
    if (!inputBuffer || !outputBuffer || !paramsBuffer || !readbackBuffer) {
      throw new ProbeStageError("device-error", "GPU buffer creation did not complete.");
    }
    const gpuInput = inputBuffer;
    const gpuOutput = outputBuffer;
    const gpuParams = paramsBuffer;
    const gpuReadback = readbackBuffer;

    const shader = await compileShader(device, guard, probeShader);
    const [pipeline, bindGroup] = await withErrorScopes(
      device,
      "pipeline-error",
      "Compute pipeline creation failed",
      async () => {
        const bindGroupLayout = device.createBindGroupLayout({
          entries: [
            {
              binding: 0,
              visibility: GPUShaderStage.COMPUTE,
              buffer: { type: "read-only-storage", minBindingSize: byteSize },
            },
            {
              binding: 1,
              visibility: GPUShaderStage.COMPUTE,
              buffer: { type: "storage", minBindingSize: byteSize },
            },
            {
              binding: 2,
              visibility: GPUShaderStage.COMPUTE,
              buffer: { type: "uniform", minBindingSize: PARAMS_BYTE_SIZE },
            },
          ],
        });
        const computePipeline = await guard.race(
          device.createComputePipelineAsync({
            layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
            compute: { module: shader, entryPoint: "main" },
          }),
        );
        const group = device.createBindGroup({
          layout: bindGroupLayout,
          entries: [
            { binding: 0, resource: { buffer: gpuInput, offset: 0, size: byteSize } },
            { binding: 1, resource: { buffer: gpuOutput, offset: 0, size: byteSize } },
            { binding: 2, resource: { buffer: gpuParams, offset: 0, size: PARAMS_BYTE_SIZE } },
          ],
        });
        return [computePipeline, group] as const;
      },
    );

    await withErrorScopes(device, "dispatch-error", "Compute dispatch failed", async () => {
      device.queue.writeBuffer(gpuInput, 0, input.values);
      device.queue.writeBuffer(gpuParams, 0, new Uint32Array([input.values.length, 0, 0, 0]));
      const encoder = device.createCommandEncoder({ label: "compute-probe" });
      const pass = encoder.beginComputePass({ label: "compute-probe" });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(Math.ceil(input.values.length / WORKGROUP_SIZE));
      pass.end();
      encoder.copyBufferToBuffer(gpuOutput, 0, gpuReadback, 0, byteSize);
      device.queue.submit([encoder.finish()]);
      await guard.race(device.queue.onSubmittedWorkDone());
    });

    const readback = await withErrorScopes(
      device,
      "map-error",
      "GPU readback mapping failed",
      async () => {
        await guard.race(gpuReadback.mapAsync(GPUMapMode.READ, 0, byteSize));
        readbackMapped = true;
        return new Float32Array(gpuReadback.getMappedRange(0, byteSize).slice(0));
      },
    );
    guard.check();

    let error: number;
    try {
      error = await relativeL2(expectedProbe(input), readback);
    } catch (verificationError) {
      throw new ProbeStageError(
        "wasm-verification-error",
        `Wasm verification failed: ${errorMessage(verificationError)}`,
      );
    }
    guard.check();

    const metrics = { elapsedMs: elapsedSince(startedAt), relativeL2: error, tolerance: PROBE_TOLERANCE };
    if (error > PROBE_TOLERANCE) {
      return {
        status: "mismatch",
        code: "verification-mismatch",
        message: `GPU readback relative L2 ${error} exceeds tolerance ${PROBE_TOLERANCE}.`,
        ...metrics,
      };
    }
    return { status: "verified", output: readback, ...metrics };
  } catch (error) {
    if (error instanceof ProbeCanceledError || signal?.aborted) {
      return canceled(startedAt);
    }
    const failure =
      error instanceof ProbeStageError
        ? error
        : new ProbeStageError("device-error", `WebGPU probe failed: ${errorMessage(error)}`);
    return {
      status: "failed",
      code: failure.code,
      message: failure.message,
      elapsedMs: elapsedSince(startedAt),
    };
  } finally {
    try {
      if (readbackMapped || readbackBuffer?.mapState === "mapped") readbackBuffer?.unmap();
    } catch {
      // Buffer destruction below remains required even when unmapping fails after device loss.
    }
    destroyBuffer(readbackBuffer);
    destroyBuffer(paramsBuffer);
    destroyBuffer(outputBuffer);
    destroyBuffer(inputBuffer);
    try {
      device.destroy();
    } catch {
      // Every buffer has already been released; device loss can make destroy a no-op/error.
    }
  }
}
