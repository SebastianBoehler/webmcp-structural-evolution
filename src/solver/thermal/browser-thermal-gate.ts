import { defineEngineeringSolveRequest } from "../../cad/engineering-job-contract";
import {
  createArtifactStore, type ArtifactPayload, type ArtifactStore,
} from "../../engineering/artifact-store";
import { createEngineeringJobRunner } from "../../engineering/job-runner";
import { createSolverRegistry } from "../../engineering/solver-registry";
import type { SolverAdapter } from "../../engineering/solver-adapter";
import { se6UpperArmDocument } from "../../models/component-documents";
import { COBOT_THERMAL_BOUNDARY_AREA_M2 } from "../../samples/cobot/cobot-thermal-study";
import { componentShowcaseEvidence, type ShowcaseModelEvidence } from "../../workspace/component-showcase-evidence";
import { runComponentStudy } from "../../workspace/component-showcase-runtime";
import {
  blockThermalBrowserGateReport, sealThermalBrowserGateReport,
  type ThermalBrowserGateReport,
} from "./browser-thermal-report";
import type { ThermalSolveInput } from "./thermal-contract";
import {
  createVerifiedThermalAdapter, type VerifiedThermalOutput,
} from "./verified-thermal-adapter";

type Adapter = SolverAdapter<ThermalSolveInput, VerifiedThermalOutput>;
type Runtime = ReturnType<typeof runtime>;
type ComponentThermalBenchmark = Readonly<{
  request: import("../../engineering/solver-adapter").EngineeringSolveRequest<ThermalSolveInput>;
  heatInputW: number;
}>;
export interface ThermalBrowserGateSession {
  readonly report: ThermalBrowserGateReport;
  readonly model?: ShowcaseModelEvidence;
  readonly benchmark?: ComponentThermalBenchmark;
  readonly output?: VerifiedThermalOutput;
  readonly readArtifact?: (id: string) => Promise<ArtifactPayload | undefined>;
}

const terminal = new Set(["verified", "failed", "cancelled"]);
const now = () => performance.now();
function abort(signal: AbortSignal): void {
  if (!signal.aborted) return;
  if (signal.reason !== undefined) throw signal.reason;
  throw new DOMException("Thermal browser gate was cancelled", "AbortError");
}

const persistedThermalArtifacts = createArtifactStore();

function runtime(document: ComponentThermalBenchmark["request"]["document"], adapter: Adapter) {
  const registry = createSolverRegistry();
  registry.register(adapter);
  const base = persistedThermalArtifacts, committedIds = new Set<string>();
  const store: ArtifactStore = {
    put: (record, payload) => base.put(record, payload), get: (id) => base.get(id),
    delete: (ids) => base.delete(ids),
    async commit(entries, guard) {
      await base.commit(entries, guard);
      for (const { record } of entries) committedIds.add(record.id);
    },
  };
  return { runner: createEngineeringJobRunner({ registry, store,
    currentDocument: () => document }), store, committedIds };
}

async function requestWithId(benchmark: ComponentThermalBenchmark, jobId: string) {
  const request = benchmark.request;
  return defineEngineeringSolveRequest<ThermalSolveInput>({ ...request, jobId });
}

async function cancellationAndRecovery(
  benchmark: ComponentThermalBenchmark, adapter: Adapter, signal: AbortSignal,
) {
  const active = runtime(benchmark.request.document, adapter);
  const cancellation = await requestWithId(benchmark, "se6-thermal-cancellation-probe");
  let activeJobId = cancellation.jobId;
  let cancellationRequested = false, iterationObserved = false;
  const unsubscribe = active.runner.subscribe(({ event }) => {
    if (event.jobId === cancellation.jobId && event.state === "partial"
      && event.progress > .05 && !cancellationRequested) {
      iterationObserved = true;
      cancellationRequested = active.runner.cancel(event.jobId);
    }
  });
  const externalAbort = () => active.runner.cancel(activeJobId);
  signal.addEventListener("abort", externalAbort, { once: true });
  try {
    abort(signal);
    const cancelled = await active.runner.launch<ThermalSolveInput, VerifiedThermalOutput>(cancellation).completion;
    abort(signal);
    if (cancelled.event.state === "failed") {
      throw new Error(`Thermal GPU cancellation probe failed (${cancelled.event.error.code}): ${cancelled.event.error.message}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const terminals = active.runner.entries().filter(({ event }) =>
      event.jobId === cancellation.jobId && terminal.has(event.state));
    if (!iterationObserved || !cancellationRequested || cancelled.event.state !== "cancelled"
      || terminals.length !== 1 || active.committedIds.size !== 0) {
      throw new Error("Thermal in-dispatch cancellation did not preserve one terminal and zero commits");
    }
    const solveStarted = now();
    const recoveryRequest = await requestWithId(benchmark, "se6-thermal-cancellation-recovery");
    activeJobId = recoveryRequest.jobId;
    abort(signal);
    const recovery = await active.runner.launch<ThermalSolveInput, VerifiedThermalOutput>(recoveryRequest).completion;
    abort(signal);
    if (!("output" in recovery) || recovery.event.truthLevel !== "converged-numerical-solve") {
      throw new Error(recovery.event.state === "failed"
        ? `Thermal recovery failed (${recovery.event.error.code}): ${recovery.event.error.message}`
        : "Thermal recovery did not produce a verified result");
    }
    if (recovery.event.artifacts.length !== 3 || [...active.committedIds].length !== 3) {
      throw new Error("Thermal verified artifact batch was not committed atomically");
    }
    const artifacts = await Promise.all(recovery.event.artifacts.map(async (record) => {
      if (await active.store.get(record.id) === undefined) {
        throw new Error("Thermal persisted artifact is unavailable");
      }
      return { artifactId: record.id, contentDigest: record.contentDigest,
        mediaType: record.mediaType, persisted: true as const };
    }));
    return { output: recovery.output, artifacts,
      readArtifact: (id: string) => active.store.get(id),
      solveMs: now() - solveStarted,
      cancellation: { outcome: "cancelled" as const, terminalCount: 1 as const,
        artifactsCommitted: 0 as const, recoveryRunPassed: true as const } };
  } finally {
    unsubscribe();
    signal.removeEventListener("abort", externalAbort);
  }
}

function validate(output: VerifiedThermalOutput): void {
  const { result, verification } = output;
  if (result.device.realGpu !== true || result.relativeResidual > 1e-6
    || result.relativeEnergyImbalance >= 1e-3
    || verification.temperatureRelativeL2 > 1e-3 || verification.fieldRelativeL2 > 2e-3
    || verification.heatRateRelativeError > 2e-3 || verification.relativeEnergyImbalance > 1e-3
    || ![result.temperatureK, result.heatFluxWm2, result.faceHeatFluxWm2]
      .every((field) => field.length > 0 && field.every(Number.isFinite))) {
    throw new Error("Thermal live result did not satisfy WebGPU and independent Wasm thresholds");
  }
}

function boundaryEvidence(result: VerifiedThermalOutput["result"], selectionId: string) {
  const selection = result.rasterization.selections.find((item) => item.selectionId === selectionId);
  if (!selection) throw new Error(`Thermal rasterization evidence is missing for ${selectionId}`);
  if (selection.selectedAreaM2 !== COBOT_THERMAL_BOUNDARY_AREA_M2) {
    throw new Error(`Thermal selected area is not locked for ${selectionId}`);
  }
  return { selectedAreaM2: COBOT_THERMAL_BOUNDARY_AREA_M2,
    representedAreaM2: selection.representedAreaM2,
    relativeAreaError: selection.relativeAreaError } as const;
}

export async function runThermalBrowserGate(
  signal: AbortSignal = new AbortController().signal,
): Promise<ThermalBrowserGateSession> {
  const started = now();
  let stage = "component-workspace-planning";
  let evidence: ShowcaseModelEvidence | undefined;
  try {
    abort(signal);
    const buildStarted = now();
    const model = await se6UpperArmDocument();
    evidence = componentShowcaseEvidence(model, "failure");
    const adapter = createVerifiedThermalAdapter();
    const planned = await runComponentStudy(
      model, "se6-upper-arm-thermal", adapter, signal,
    );
    const study = model.document.studies.find(({ id }) => id === "se6-upper-arm-thermal");
    if (!study || study.kind !== "thermal-steady" || !study.boundaries) {
      throw new Error("Component thermal study is unresolved");
    }
    const heat = study.boundaries.heatFluxes[0];
    const selection = model.document.namedSelections.find(({ id }) => id === heat?.selectionId);
    if (!heat || !selection) throw new Error("Component thermal heat boundary is unresolved");
    const heatInputW = heat.heatFluxWm2 * selection.reference.signature.measureSI;
    if (Math.abs(heatInputW - 80) > 1e-9) throw new Error("Component thermal heat input changed");
    const benchmark = { request: planned.request, heatInputW: 80 as const };
    const buildMs = now() - buildStarted;
    abort(signal);
    stage = "cancellation-and-recovery";
    const solved = await cancellationAndRecovery(benchmark, adapter, signal);
    abort(signal);
    stage = "numerical-evidence";
    validate(solved.output);
    const { result, verification } = solved.output;
    const temperatures = [...result.temperatureK];
    const report = await sealThermalBrowserGateReport({
      status: "passed", evidenceSource: "live-browser-webgpu-wasm",
      recordedAt: new Date().toISOString(), sourceRevision: benchmark.request.sourceRevision,
      sourceArtifactIds: [benchmark.request.input.exactBrepArtifactId,
        benchmark.request.input.semanticMeshArtifactId,
        benchmark.request.input.thermalVoxelArtifactId],
      studyId: "se6-upper-arm-thermal",
      device: { vendor: result.device.adapterInfo.vendor, architecture: result.device.adapterInfo.architecture },
      grid: { cellDimensions: [...result.grid.cellDimensions] as [42, 8, 8], activeCellCount: 2_688 },
      boundaries: { mounting: boundaryEvidence(result, "mounting-interface"),
        motor: boundaryEvidence(result, "motor-interface"), heatInputW: benchmark.heatInputW },
      solve: { iterations: result.iterations, relativeResidual: result.relativeResidual,
        relativeEnergyImbalance: result.relativeEnergyImbalance,
        minimumTemperatureK: Math.min(...temperatures), maximumTemperatureK: Math.max(...temperatures) },
      verification: { temperatureRelativeL2: verification.temperatureRelativeL2,
        fieldRelativeL2: verification.fieldRelativeL2,
        heatRateRelativeError: verification.heatRateRelativeError,
        relativeEnergyImbalance: verification.relativeEnergyImbalance },
      cancellation: solved.cancellation, artifacts: solved.artifacts,
      timingsMs: { build: buildMs, solve: solved.solveMs, total: now() - started },
    });
    return { report, model: componentShowcaseEvidence(model, "verified"), benchmark,
      output: solved.output, readArtifact: solved.readArtifact };
  } catch (error) {
    if (signal.aborted) throw error;
    return { report: await blockThermalBrowserGateReport(stage, error), model: evidence };
  }
}
