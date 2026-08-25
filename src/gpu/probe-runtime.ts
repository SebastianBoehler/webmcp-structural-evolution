import type { GpuAcquisitionFailureCode } from "./capabilities";

export type ProbeFailureCode =
  | GpuAcquisitionFailureCode
  | "invalid-input"
  | "device-error"
  | "device-lost"
  | "shader-compilation-error"
  | "pipeline-error"
  | "dispatch-error"
  | "map-error"
  | "wasm-verification-error";

export class ProbeStageError extends Error {
  constructor(
    readonly code: ProbeFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "ProbeStageError";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function deviceLossGuard(device: GPUDevice) {
  let lost: GPUDeviceLostInfo | undefined;
  const loss = device.lost.then((info) => {
    lost = info;
    return info;
  });
  const failure = (info: GPUDeviceLostInfo) =>
    new ProbeStageError(
      "device-lost",
      `WebGPU device was lost (${info.reason}): ${info.message || "no detail provided"}`,
    );

  return {
    async race<T>(operation: Promise<T>): Promise<T> {
      const outcome = await Promise.race([
        operation.then((value) => ({ kind: "value" as const, value })),
        loss.then((info) => ({ kind: "lost" as const, info })),
      ]);
      if (outcome.kind === "lost") throw failure(outcome.info);
      return outcome.value;
    },
    check() {
      if (lost) throw failure(lost);
    },
  };
}

export async function withErrorScopes<T>(
  device: GPUDevice,
  code: ProbeFailureCode,
  label: string,
  operation: () => T | Promise<T>,
): Promise<T> {
  device.pushErrorScope("validation");
  device.pushErrorScope("internal");
  device.pushErrorScope("out-of-memory");

  let value: T | undefined;
  let thrown: unknown;
  try {
    value = await operation();
  } catch (error) {
    thrown = error;
  }

  let scopedError: GPUError | null = null;
  try {
    const outOfMemory = await device.popErrorScope();
    const internal = await device.popErrorScope();
    const validation = await device.popErrorScope();
    scopedError = outOfMemory ?? internal ?? validation;
  } catch (error) {
    thrown ??= error;
  }

  if (thrown instanceof ProbeStageError) throw thrown;
  if (thrown) throw new ProbeStageError(code, `${label}: ${errorMessage(thrown)}`);
  if (scopedError) throw new ProbeStageError(code, `${label}: ${scopedError.message}`);
  return value as T;
}

export async function compileShader(
  device: GPUDevice,
  guard: ReturnType<typeof deviceLossGuard>,
  source: string,
) {
  return withErrorScopes(device, "shader-compilation-error", "Shader compilation failed", async () => {
    const module = device.createShaderModule({ label: "compute-probe", code: source });
    const info = await guard.race(module.getCompilationInfo());
    const errors = info.messages.filter((message) => message.type === "error");
    if (errors.length > 0) {
      const diagnostics = errors
        .map((message) => `line ${message.lineNum}:${message.linePos} ${message.message}`)
        .join("; ");
      throw new Error(diagnostics);
    }
    return module;
  });
}

export function destroyBuffer(buffer: GPUBuffer | undefined) {
  try {
    buffer?.destroy();
  } catch {
    // Continue releasing the remaining resources after a device-loss cleanup error.
  }
}
