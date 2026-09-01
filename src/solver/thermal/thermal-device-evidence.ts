import { StructuralGpuError } from "../structural/structural-gpu-runtime";
import type { ThermalDeviceEvidence } from "./thermal-contract";

export function thermalDeviceEvidence(adapter: GPUAdapter, device: GPUDevice): ThermalDeviceEvidence {
  const info = adapter.info;
  if (!info) throw new StructuralGpuError(
    "unsupported-capability", "Thermal WebGPU adapter identity is unavailable",
    { kind: "precision", rule: "explicit WebGPU adapter info is required" },
  );
  const adapterInfo = {
    vendor: info.vendor,
    architecture: info.architecture,
    device: info.device,
    description: info.description,
  };
  const limits = {
    maxBufferSize: device.limits.maxBufferSize,
    maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
    maxComputeWorkgroupsPerDimension: device.limits.maxComputeWorkgroupsPerDimension,
  };
  if (Object.values(adapterInfo).some((value) => typeof value !== "string")
    || Object.values(limits).some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new StructuralGpuError(
      "unsupported-capability", "Thermal WebGPU adapter identity or required limits are unavailable",
      { kind: "precision", rule: "explicit WebGPU adapter info and finite device limits are required" },
    );
  }
  return { realGpu: true, backend: "webgpu", precision: "f32", adapterInfo, limits };
}
