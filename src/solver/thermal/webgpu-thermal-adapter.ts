import type { EngineeringSolveRequest, SolverAdapter } from "../../engineering/solver-adapter";
import { acquireWebGpu } from "../../gpu/capabilities";
import { safeDestroy, StructuralGpuError } from "../structural/structural-gpu-runtime";
import { compileThermalStudy } from "./compile-thermal-study";
import {
  DEFAULT_THERMAL_COMPILE_LIMITS, type ThermalInput, type ThermalResult, type ThermalSolveInput,
} from "./thermal-contract";
import { thermalDeviceEvidence } from "./thermal-device-evidence";
import { solveThermalGpu } from "./thermal-gpu-solver";
import { packInteractiveThermalResult } from "./thermal-result-artifacts";

export type ThermalGpuAcquisitionObserver = (value: Readonly<{ adapter: GPUAdapter; device: GPUDevice }>) => void;
export interface WebGpuThermalAdapterOptions { readonly onAcquisition?: ThermalGpuAcquisitionObserver }

function unsupported(message: string, kind: "dimension" | "memory" | "precision", rule: string) {
  return { supported: false as const, error: {
    code: "unsupported-capability" as const, message, limit: { kind, rule },
  } };
}

function capability(request: EngineeringSolveRequest<ThermalSolveInput>) {
  if (!globalThis.navigator?.gpu) return unsupported(
    "Steady conduction requires a live browser WebGPU device", "precision",
    "navigator.gpu must expose a compatible f32 compute device",
  );
  if (request.kind !== "thermal") return unsupported(
    "Thermal adapter accepts only thermal jobs", "dimension", "job kind must be thermal",
  );
  const dimensions = request.input?.voxelPayload?.dimensions;
  if (!(dimensions instanceof Uint32Array) || dimensions.length !== 3) return unsupported(
    "Thermal solver mesh dimensions are unavailable", "dimension", "three voxel axes are required",
  );
  const cells = dimensions[0]! * dimensions[1]! * dimensions[2]!;
  if (!Number.isSafeInteger(cells) || cells < 1 || cells > DEFAULT_THERMAL_COMPILE_LIMITS.maxCells) {
    return unsupported("Thermal voxel grid exceeds the bounded adapter envelope", "dimension",
      `cell count must be at most ${DEFAULT_THERMAL_COMPILE_LIMITS.maxCells}`);
  }
  return { supported: true as const };
}

export const solveThermalOnDevice = solveThermalGpu;

export function createWebGpuThermalAdapter(
  options: WebGpuThermalAdapterOptions = {},
): SolverAdapter<ThermalSolveInput, ThermalResult> {
  return {
    capability: { kind: "thermal" }, supports: capability,
    async run(request, signal, emit) {
      const decision = capability(request);
      if (!decision.supported) throw new StructuralGpuError(
        "unsupported-capability", decision.error.message, decision.error.limit,
      );
      let input: ThermalInput;
      try {
        input = await compileThermalStudy(request, {
          ...DEFAULT_THERMAL_COMPILE_LIMITS, maxRelativeAreaError: 0.02,
        });
      } catch (error) {
        throw new StructuralGpuError("invalid-input", error instanceof Error ? error.message : "Thermal study compilation failed");
      }
      const acquisition = await acquireWebGpu();
      if (acquisition.status !== "available") throw new StructuralGpuError(
        acquisition.code === "device-lost" ? "device-lost" : "unsupported-capability", acquisition.message,
        acquisition.code === "device-lost" ? undefined : { kind: "precision", rule: "a live WebGPU device is required" },
      );
      try {
        options.onAcquisition?.(acquisition);
        const evidence = thermalDeviceEvidence(acquisition.adapter, acquisition.device);
        emit({ progress: 0.05 });
        const solved = await solveThermalGpu(acquisition.device, input, signal, (progress) => emit({ progress }));
        const result: ThermalResult = {
          truthLevel: "interactive-estimate", grid: input.grid, ...solved,
          device: evidence, rasterization: input.rasterization,
        };
        emit({ progress: 0.98 });
        return packInteractiveThermalResult(request, result);
      } finally {
        safeDestroy(acquisition.device);
      }
    },
  };
}
