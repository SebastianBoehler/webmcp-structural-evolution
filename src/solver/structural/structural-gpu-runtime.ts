import { acquireWebGpu } from "../../gpu/capabilities";

export interface StructuralGpuAcquisition {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
}
export type StructuralGpuAcquisitionObserver = (acquisition: StructuralGpuAcquisition) => void;

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

export async function acquireStructuralGpu(
  signal: AbortSignal,
  observer?: StructuralGpuAcquisitionObserver,
): Promise<GPUDevice> {
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
  try { observer?.({ adapter: acquisition.adapter, device: acquisition.device }); }
  catch (error) { safeDestroy(acquisition.device); throw error; }
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

const STRUCTURAL_ERROR_SCOPES = ["validation", "internal", "out-of-memory"] as const;

interface ScopeDrain {
  readonly error: GPUError | null;
  readonly interruption?: unknown;
  readonly failure?: unknown;
}

function isLifecycleInterruption(error: unknown): boolean {
  return (error instanceof StructuralGpuError && error.code === "device-lost")
    || isAbortError(error);
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && "name" in error && error.name === "AbortError";
}

async function popStructuralErrorScope(
  device: GPUDevice,
  guard: DeviceGuard,
): Promise<ScopeDrain> {
  let pending: Promise<GPUError | null>;
  try {
    pending = device.popErrorScope();
  } catch (failure) {
    return { error: null, failure };
  }
  try {
    return { error: await guard.race(pending) };
  } catch (raceFailure) {
    try {
      const error = await pending;
      return isLifecycleInterruption(raceFailure)
        ? { error, interruption: raceFailure }
        : { error, failure: raceFailure };
    } catch (popFailure) {
      return {
        error: null,
        interruption: isLifecycleInterruption(raceFailure) ? raceFailure : undefined,
        failure: popFailure,
      };
    }
  }
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function withStructuralGpuErrorScopes<Value>(
  device: GPUDevice,
  guard: DeviceGuard,
  operation: () => Promise<Value>,
): Promise<Value> {
  for (const filter of STRUCTURAL_ERROR_SCOPES) device.pushErrorScope(filter);
  let value: Value | undefined;
  let operationFailed = false;
  let operationError: unknown;
  try {
    value = await operation();
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  const drained: ScopeDrain[] = [];
  for (let index = STRUCTURAL_ERROR_SCOPES.length - 1; index >= 0; index -= 1) {
    drained.push(await popStructuralErrorScope(device, guard));
  }
  const [outOfMemory, internal, validation] = drained;
  if (outOfMemory?.error) {
    throw new StructuralGpuError(
      "resource-limit", `Structural WebGPU out-of-memory error: ${outOfMemory.error.message}`,
    );
  }
  const deviceError = internal?.error ?? validation?.error;
  if (deviceError) {
    const kind = internal?.error ? "internal" : "validation";
    throw new StructuralGpuError(
      "internal-error", `Structural WebGPU ${kind} error: ${deviceError.message}`,
    );
  }
  if (operationFailed) {
    if (operationError instanceof StructuralGpuError
      || isAbortError(operationError)) {
      throw operationError;
    }
    throw new StructuralGpuError(
      "internal-error", `Structural WebGPU execution failed: ${errorDetail(operationError)}`,
    );
  }
  const interruption = drained.find(({ interruption }) => interruption)?.interruption;
  if (interruption) throw interruption;
  const scopeFailure = drained.find(({ failure }) => failure)?.failure;
  if (scopeFailure) {
    throw new StructuralGpuError(
      "internal-error", `Structural WebGPU error-scope cleanup failed: ${errorDetail(scopeFailure)}`,
    );
  }
  return value as Value;
}

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
