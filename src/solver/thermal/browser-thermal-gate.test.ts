import { beforeEach, expect, test, vi } from "vitest";

import { defineArtifactRecord } from "../../cad/artifact-contract";
import { digestArtifactPayload } from "../../engineering/artifact-store";
import { createCobotThermalBenchmarkFromDocument, createCobotThermalDocument } from "../../samples/cobot/cobot-thermal-study";
import type { SolverAdapter } from "../../engineering/solver-adapter";
import { createThermalAnalyticalRequest } from "./thermal-analytical-request";
import {
  THERMAL_VOXEL_MEDIA_TYPE, THERMAL_VOXEL_PRODUCER,
  type ThermalResult, type ThermalSolveInput,
} from "./thermal-contract";
import { packInteractiveThermalResult } from "./thermal-result-artifacts";
import { runThermalBrowserGate } from "./browser-thermal-gate";
import { verifyThermalBrowserGateReportDigest } from "./browser-thermal-report";
import type { VerifiedThermalOutput } from "./verified-thermal-adapter";

const gateFakes = vi.hoisted(() => ({ study: vi.fn(), voxel: vi.fn(), adapter: undefined as unknown as
  SolverAdapter<ThermalSolveInput, VerifiedThermalOutput> }));
vi.mock("./thermal-voxelizer", () => ({ produceThermalVoxelMesh: gateFakes.voxel }));
vi.mock("../../workspace/component-showcase-runtime", () => ({
  runComponentStudy: gateFakes.study,
}));
vi.mock("./verified-thermal-adapter", () => ({
  createVerifiedThermalAdapter: () => gateFakes.adapter,
}));

beforeEach(() => vi.clearAllMocks());

async function benchmark() {
  const analytical = await createThermalAnalyticalRequest({
    dimensions: [42, 8, 8], cellSizeM: .01,
    bodies: [{ id: "upper-arm-link", materialId: "aluminum-6061", conductivityWmK: 167 }],
    cellBodyIndices: new Uint32Array(42 * 8 * 8), boundaries: [
      { id: "mounting-interface", cellIndex: 0, axis: 0, direction: -1, areaM2: .0064, temperatureK: 300 },
      { id: "motor-interface", cellIndex: 41, axis: 0, direction: 1, areaM2: .0064, heatFluxWm2: 12_500 },
    ],
  });
  const document = await createCobotThermalDocument(analytical.document,
    analytical.input.semanticMeshPayload);
  const dependencies = [{ kind: "entity" as const, reference: `document:${document.id}` as const },
    { kind: "entity" as const, reference: "body:upper-arm-link" as const }];
  const own = (source: typeof analytical.inputArtifacts[number]) => defineArtifactRecord({
    kind: source.kind, sourceRevision: document.revision, producer: source.producer,
    settingsDigest: source.settingsDigest, contentDigest: source.contentDigest,
    units: source.units, mediaType: source.mediaType, dependencies,
  });
  const brep = await own(analytical.inputArtifacts[0]!);
  const semantic = await own(analytical.inputArtifacts[1]!);
  const mounting = Array.from({ length: 64 }, (_, index) => 42 * index);
  const motor = mounting.map((cell) => cell + 41), faces = [...mounting, ...motor];
  const payload = { ...analytical.input.voxelPayload,
    selectionFaceOffsets: new Uint32Array([0, 64, 128]),
    selectionFaceCells: Uint32Array.from(faces), selectionFaceAxes: new Uint8Array(128),
    selectionFaceDirections: Int8Array.from(faces, (_cell, index) => index < 64 ? -1 : 1),
    selectionFaceAreasM2: new Float64Array(128).fill(.0001) };
  const voxel = await defineArtifactRecord({ kind: "sdf", sourceRevision: document.revision,
    producer: THERMAL_VOXEL_PRODUCER, settingsDigest: analytical.inputArtifacts[2]!.settingsDigest,
    contentDigest: await digestArtifactPayload(payload), units: "m", mediaType: THERMAL_VOXEL_MEDIA_TYPE,
    dependencies: [...dependencies, { kind: "artifact", artifactId: brep.id },
      { kind: "artifact", artifactId: semantic.id }] });
  gateFakes.voxel.mockResolvedValueOnce({ record: voxel, payload, exact: {
    brepArtifact: brep, brepPayload: { bytes: Uint8Array.of(1) }, semanticArtifact: semantic,
    semanticMeshPayload: analytical.input.semanticMeshPayload,
  } });
  return createCobotThermalBenchmarkFromDocument(document);
}

function output(cellDimensions: readonly [number, number, number] = [42, 8, 8]): ThermalResult {
  const cells = 42 * 8 * 8;
  return { truthLevel: "interactive-estimate", grid: { cellDimensions,
    originM: [0, 0, 0], cellSizeM: .01 }, iterations: 42,
  temperatureK: Float32Array.from({ length: cells }, (_value, index) => 300 + index % 42 / 2),
  heatFluxWm2: new Float32Array(cells * 3).fill(1),
  faceHeatFluxWm2: new Float32Array(cells * 6).fill(1),
  faceAreasM2: new Float32Array(cells * 6).fill(.0001), relativeResidual: 1e-8,
  heatInputW: 80, heatOutputW: 80, energyImbalanceW: 0, relativeEnergyImbalance: 0,
  device: { realGpu: true, backend: "webgpu", precision: "f32", adapterInfo: {
    vendor: "recording", architecture: "recording", device: "recording", description: "recording",
  }, limits: { maxBufferSize: 1, maxStorageBufferBindingSize: 1,
    maxComputeWorkgroupsPerDimension: 1 } }, rasterization: { toleranceM: 1e-6,
    selections: [
      { selectionId: "mounting-interface", topologyId: "face:mounting", faceCount: 64,
        selectedAreaM2: .0064, representedAreaM2: .0064, relativeAreaError: 0 },
      { selectionId: "motor-interface", topologyId: "face:motor", faceCount: 64,
        selectedAreaM2: .0064, representedAreaM2: .0064, relativeAreaError: 0 },
    ] } };
}

const verification = { verified: true as const, temperatureRelativeL2: 1e-6,
  fieldRelativeL2: 1e-6, heatRateRelativeError: 1e-6, relativeEnergyImbalance: 1e-6,
  independentlyEvaluatedHeatInputW: 80, independentlyEvaluatedHeatOutputW: 80,
  referenceIterations: 42, referenceRelativeResidual: 1e-12,
  maximumTemperatureRelativeL2: 1e-3 as const, maximumHeatRateRelativeError: 2e-3 as const,
  maximumRelativeEnergyImbalance: 1e-3 as const };

async function verifiedRun(
  request: Parameters<SolverAdapter<ThermalSolveInput, VerifiedThermalOutput>["run"]>[0],
) {
  const result = output(), packed = await packInteractiveThermalResult(request, result);
  return { ...packed, truthLevel: "converged-numerical-solve" as const,
    output: { result, verification } };
}

test("cancels after solver progress, commits nothing, then persists one verified recovery batch", async () => {
  const sample = await benchmark();
  let calls = 0;
  const adapter: SolverAdapter<ThermalSolveInput, VerifiedThermalOutput> = {
    capability: { kind: "thermal" }, supports: () => ({ supported: true }),
    async run(request, signal, emit) {
      calls += 1;
      if (calls === 1) {
        emit({ progress: .2 });
        if (signal.aborted) throw signal.reason;
        await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
        throw new Error("unreachable");
      }
      return verifiedRun(request);
    },
  };
  gateFakes.study.mockResolvedValue({ request: sample.request, result: {}, artifactIds: [] });
  gateFakes.adapter = adapter;

  const session = await runThermalBrowserGate();

  expect(session.report.status).toBe("passed");
  if (session.report.status !== "passed") throw new Error("expected pass");
  expect(calls).toBe(2);
  expect(session.report.cancellation).toEqual({ outcome: "cancelled", terminalCount: 1,
    artifactsCommitted: 0, recoveryRunPassed: true });
  expect(session.report.artifacts).toHaveLength(3);
  expect(session.report.artifacts.every(({ persisted }) => persisted)).toBe(true);
  expect(await session.readArtifact?.(session.report.artifacts[0]!.artifactId)).toBeDefined();
  expect(session.report.sourceArtifactIds).toEqual(sample.request.inputArtifacts.map(({ id }) => id));
  expect(session.report.boundaries).toEqual({
    mounting: { selectedAreaM2: .0064, representedAreaM2: .0064, relativeAreaError: 0 },
    motor: { selectedAreaM2: .0064, representedAreaM2: .0064, relativeAreaError: 0 },
    heatInputW: 80,
  });
  expect(await verifyThermalBrowserGateReportDigest(session.report)).toBe(true);
});

test("GPU adapter failure blocks without retry or fallback", async () => {
  const sample = await benchmark(), run = vi.fn(async () => { throw new Error("injected GPU failure"); });
  const adapter: SolverAdapter<ThermalSolveInput, VerifiedThermalOutput> = {
    capability: { kind: "thermal" }, supports: () => ({ supported: true }), run,
  };
  gateFakes.study.mockResolvedValue({ request: sample.request, result: {}, artifactIds: [] });
  gateFakes.adapter = adapter;
  const session = await runThermalBrowserGate();
  expect(session.report).toMatchObject({ status: "blocked",
    blocker: { stage: "cancellation-and-recovery", message: expect.stringContaining("injected GPU failure") } });
  expect(run).toHaveBeenCalledOnce();
});

test("blocks a solver grid that drifts from the planned component voxel grid", async () => {
  const sample = await benchmark();
  let calls = 0;
  const adapter: SolverAdapter<ThermalSolveInput, VerifiedThermalOutput> = {
    capability: { kind: "thermal" }, supports: () => ({ supported: true }),
    async run(request, signal, emit) {
      calls += 1;
      if (calls === 1) {
        emit({ progress: .2 });
        await new Promise<void>((_resolve, reject) => signal.addEventListener("abort",
          () => reject(signal.reason), { once: true }));
      }
      const result = output([41, 8, 8]);
      const packed = await packInteractiveThermalResult(request, result);
      return { ...packed, truthLevel: "converged-numerical-solve",
        output: { result, verification } };
    },
  };
  gateFakes.study.mockResolvedValue({ request: sample.request, result: {}, artifactIds: [] });
  gateFakes.adapter = adapter;

  const session = await runThermalBrowserGate();

  expect(session.report).toMatchObject({ status: "blocked",
    blocker: { stage: "numerical-evidence", message: expect.stringMatching(/grid.*planned/i) } });
});

test("external abort propagates and never becomes a blocked report", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("stop", "AbortError"));
  await expect(runThermalBrowserGate(controller.signal)).rejects.toThrow("stop");
});

test("external abort during recovery cancels the active recovery job", async () => {
  const sample = await benchmark(), controller = new AbortController();
  let calls = 0;
  const adapter: SolverAdapter<ThermalSolveInput, VerifiedThermalOutput> = {
    capability: { kind: "thermal" }, supports: () => ({ supported: true }),
    async run(request, signal, emit) {
      calls += 1;
      emit({ progress: .2 });
      if (calls === 1) {
        await new Promise<void>((_resolve, reject) => signal.addEventListener("abort",
          () => reject(signal.reason), { once: true }));
      }
      controller.abort(new DOMException("stop recovery", "AbortError"));
      await Promise.resolve();
      if (signal.aborted) throw signal.reason;
      return verifiedRun(request);
    },
  };
  gateFakes.study.mockResolvedValue({ request: sample.request, result: {}, artifactIds: [] });
  gateFakes.adapter = adapter;

  await expect(runThermalBrowserGate(controller.signal)).rejects.toThrow("stop recovery");
  expect(calls).toBe(2);
});
