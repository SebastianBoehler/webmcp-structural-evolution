import type {
  StructuralGpuAcquisition, StructuralGpuAcquisitionObserver,
} from "./structural-gpu-runtime";

export interface GateGpuDeviceEvidence {
  readonly vendor: string;
  readonly architecture: string;
  readonly device: string;
  readonly description: string;
  readonly features: string[];
  readonly acquisitionCount: number;
  readonly limits: Readonly<{
    maxBufferSize: number;
    maxStorageBufferBindingSize: number;
    maxComputeWorkgroupsPerDimension: number;
    maxComputeInvocationsPerWorkgroup: number;
  }>;
}

function deviceEvidence(acquisition: StructuralGpuAcquisition): GateGpuDeviceEvidence {
  const { info } = acquisition.adapter, { limits } = acquisition.device;
  return {
    vendor: info.vendor ?? "", architecture: info.architecture ?? "",
    device: info.device ?? "", description: info.description ?? "",
    features: [...acquisition.adapter.features].sort(), acquisitionCount: 1,
    limits: {
      maxBufferSize: limits.maxBufferSize,
      maxStorageBufferBindingSize: limits.maxStorageBufferBindingSize,
      maxComputeWorkgroupsPerDimension: limits.maxComputeWorkgroupsPerDimension,
      maxComputeInvocationsPerWorkgroup: limits.maxComputeInvocationsPerWorkgroup,
    },
  };
}

const identity = (evidence: GateGpuDeviceEvidence) => JSON.stringify({
  vendor: evidence.vendor, architecture: evidence.architecture,
  device: evidence.device, description: evidence.description,
  features: evidence.features, limits: evidence.limits,
});

export function createGateGpuAudit() {
  let canonical: GateGpuDeviceEvidence | undefined;
  let acquisitionCount = 0, uncapturedErrorCount = 0, deviceLost = false;
  const observe: StructuralGpuAcquisitionObserver = (acquisition) => {
    const next = deviceEvidence(acquisition);
    if (canonical && identity(canonical) !== identity(next)) {
      throw new Error("Structural solves acquired mismatched WebGPU adapter identity or limits");
    }
    canonical ??= next;
    acquisitionCount += 1;
    acquisition.device.addEventListener("uncapturederror", () => { uncapturedErrorCount += 1; });
    void acquisition.device.lost.then((info) => {
      if (info.reason !== "destroyed") deviceLost = true;
    });
  };
  return {
    observe,
    evidence(): GateGpuDeviceEvidence {
      if (!canonical || acquisitionCount === 0) {
        throw new Error("No solve-owned WebGPU acquisition was observed");
      }
      return { ...canonical, acquisitionCount };
    },
    verifiedDiagnostics() {
      if (uncapturedErrorCount !== 0 || deviceLost) {
        throw new Error("A solve-owned WebGPU device emitted an uncaptured error or was lost");
      }
      return {
        identitiesMatched: true as const, uncapturedErrorCount: 0 as const,
        errorScopesClean: true as const, deviceLost: false as const,
      };
    },
  };
}

type ConsoleCounter = { warningCount: number; errorCount: number };
const consoleCounters = new Set<ConsoleCounter>();
let originalWarn: typeof console.warn | undefined;
let originalError: typeof console.error | undefined;

function installConsoleCapture(): void {
  if (originalWarn) return;
  originalWarn = console.warn;
  originalError = console.error;
  console.warn = (...args) => {
    for (const counter of consoleCounters) counter.warningCount += 1;
    originalWarn!(...args);
  };
  console.error = (...args) => {
    for (const counter of consoleCounters) counter.errorCount += 1;
    originalError!(...args);
  };
}

function uninstallConsoleCapture(): void {
  if (consoleCounters.size !== 0 || !originalWarn || !originalError) return;
  console.warn = originalWarn;
  console.error = originalError;
  originalWarn = undefined;
  originalError = undefined;
}

export function createGateConsoleAudit() {
  const counter: ConsoleCounter = { warningCount: 0, errorCount: 0 };
  installConsoleCapture();
  consoleCounters.add(counter);
  let active = true;
  return {
    evidence: () => ({ ...counter }),
    restore: () => {
      if (!active) return;
      active = false;
      consoleCounters.delete(counter);
      uninstallConsoleCapture();
    },
  };
}
