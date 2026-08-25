export type GpuUnavailableCode = "api-unavailable" | "adapter-unavailable";

export type GpuAcquisitionFailureCode =
  | GpuUnavailableCode
  | "adapter-request-failed"
  | "device-request-failed"
  | "device-lost";

export type GpuCapability =
  | { readonly status: "available"; readonly message: string }
  | {
      readonly status: "unavailable";
      readonly code: GpuUnavailableCode;
      readonly message: string;
    }
  | {
      readonly status: "failed";
      readonly code: "adapter-request-failed" | "device-request-failed";
      readonly message: string;
    }
  | {
      readonly status: "failed";
      readonly code: "device-lost";
      readonly reason: GPUDeviceLostReason;
      readonly message: string;
    };

export type GpuAcquisition =
  | { readonly status: "available"; readonly adapter: GPUAdapter; readonly device: GPUDevice }
  | Exclude<GpuCapability, { status: "available" }>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function destroyDevice(device: GPUDevice) {
  try {
    device.destroy();
  } catch {
    // A device that was already lost may reject redundant destruction.
  }
}

async function lossSettledBeforeReadiness(
  device: GPUDevice,
): Promise<GPUDeviceLostInfo | undefined> {
  let settledLoss: GPUDeviceLostInfo | undefined;
  void device.lost.then(
    (info) => {
      settledLoss = info;
    },
    () => undefined,
  );
  await Promise.resolve();
  return settledLoss;
}

export async function acquireWebGpu(): Promise<GpuAcquisition> {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) {
    return {
      status: "unavailable",
      code: "api-unavailable",
      message: "WebGPU is unavailable: navigator.gpu is not exposed in this context.",
    };
  }

  let adapter: GPUAdapter | null;
  try {
    adapter = await gpu.requestAdapter();
  } catch (error) {
    return {
      status: "failed",
      code: "adapter-request-failed",
      message: `WebGPU adapter request failed: ${errorMessage(error)}`,
    };
  }

  if (!adapter) {
    return {
      status: "unavailable",
      code: "adapter-unavailable",
      message: "WebGPU is unavailable: no compatible GPU adapter was found.",
    };
  }

  let device: GPUDevice;
  try {
    device = await adapter.requestDevice();
  } catch (error) {
    return {
      status: "failed",
      code: "device-request-failed",
      message: `WebGPU device request failed: ${errorMessage(error)}`,
    };
  }

  const settledLoss = await lossSettledBeforeReadiness(device);
  if (settledLoss) {
    destroyDevice(device);
    return {
      status: "failed",
      code: "device-lost",
      reason: settledLoss.reason,
      message: `WebGPU device was already lost (${settledLoss.reason}): ${settledLoss.message || "no detail provided"}`,
    };
  }

  return { status: "available", adapter, device };
}

export async function detectWebGpu(): Promise<GpuCapability> {
  const acquisition = await acquireWebGpu();
  if (acquisition.status !== "available") return acquisition;

  destroyDevice(acquisition.device);
  return { status: "available", message: "WebGPU adapter and device acquisition succeeded." };
}
