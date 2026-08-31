import { acquireWebGpu } from "../../gpu/capabilities";

export type StructuralGpuErrorCode =
  | "unsupported-capability"
  | "invalid-input"
  | "resource-limit"
  | "device-lost"
  | "diverged"
  | "internal-error";

export class StructuralGpuError extends Error {
  readonly limit?: Readonly<{ kind: "dimension" | "memory" | "precision" | "material"; rule: string }>;

  constructor(
    readonly code: StructuralGpuErrorCode,
    message: string,
    limit?: Readonly<{ kind: "dimension" | "memory" | "precision" | "material"; rule: string }>,
  ) {
    super(message);
    this.name = "StructuralGpuError";
    this.limit = limit;
  }
}

export function abortError(): DOMException {
  return new DOMException("Structural solve was cancelled", "AbortError");
}

export function checkAbort(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

export async function acquireStructuralGpu(signal: AbortSignal): Promise<GPUDevice> {
  checkAbort(signal);
  const acquisition = await acquireWebGpu();
  if (signal.aborted) {
    if (acquisition.status === "available") safeDestroy(acquisition.device);
    throw abortError();
  }
  if (acquisition.status !== "available") {
    if (acquisition.code === "device-lost") {
      throw new StructuralGpuError("device-lost", acquisition.message);
    }
    throw new StructuralGpuError(
      "unsupported-capability",
      acquisition.message,
      { kind: "precision", rule: "a live WebGPU adapter and device are required" },
    );
  }
  return acquisition.device;
}

export function createDeviceGuard(device: GPUDevice, signal: AbortSignal) {
  let loss: GPUDeviceLostInfo | undefined;
  const lost = device.lost.then((info) => {
    loss = info;
    return info;
  });
  const aborted = new Promise<"aborted">((resolve) => {
    if (signal.aborted) resolve("aborted");
    else signal.addEventListener("abort", () => resolve("aborted"), { once: true });
  });
  const lostError = (info: GPUDeviceLostInfo) => new StructuralGpuError(
    "device-lost",
    `WebGPU device was lost (${info.reason}): ${info.message || "no detail provided"}`,
  );
  return {
    check(): void {
      checkAbort(signal);
      if (loss) throw lostError(loss);
    },
    async race<Value>(operation: Promise<Value>): Promise<Value> {
      const outcome = await Promise.race([
        operation.then((value) => ({ kind: "value" as const, value })),
        lost.then((info) => ({ kind: "lost" as const, info })),
        aborted.then(() => ({ kind: "aborted" as const })),
      ]);
      if (outcome.kind === "lost") throw lostError(outcome.info);
      if (outcome.kind === "aborted") throw abortError();
      return outcome.value;
    },
  };
}

export type DeviceGuard = ReturnType<typeof createDeviceGuard>;

export async function submitAndWait(
  device: GPUDevice,
  guard: DeviceGuard,
  pipeline: GPUComputePipeline,
  bindGroup: GPUBindGroup,
  workgroups: number,
  label: string,
): Promise<void> {
  guard.check();
  if (!Number.isInteger(workgroups) || workgroups < 1
    || workgroups > device.limits.maxComputeWorkgroupsPerDimension) {
    throw new StructuralGpuError("resource-limit", `${label} exceeds the device workgroup limit`);
  }
  const encoder = device.createCommandEncoder({ label });
  const pass = encoder.beginComputePass({ label });
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bindGroup);
  pass.dispatchWorkgroups(workgroups);
  pass.end();
  device.queue.submit([encoder.finish()]);
  await guard.race(device.queue.onSubmittedWorkDone());
  guard.check();
}

export function safeDestroy(device: GPUDevice): void {
  try { device.destroy(); } catch { /* Device loss can reject redundant destruction. */ }
}
