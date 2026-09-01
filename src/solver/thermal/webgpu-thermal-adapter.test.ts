import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { acquireWebGpu } from "../../gpu/capabilities";
import { digestArtifactPayload } from "../../engineering/artifact-store";
import { RECORDING_GPU_GLOBALS, recordingGpu } from "../structural/recording-gpu-device";
import type { ThermalInput } from "./thermal-contract";
import type { ThermalDeviceEvidence } from "./thermal-contract";
import {
  runThermalAnalyticalGate, thermalAnalyticalLineage, validateThermalAnalyticalLineage,
  validateThermalAnalyticalResults, validateThermalFaceSamples, validateThermalFluxProjection,
} from "./thermal-analytical-gate";
import { createWebGpuThermalAdapter, solveThermalOnDevice } from "./webgpu-thermal-adapter";
import { createThermalAnalyticalRequest } from "./thermal-analytical-request";

function bar(
  count: number,
  cellSizeM: number,
  conductivityWmK: Float32Array,
  dirichletCells: ThermalInput["dirichletCells"],
  neumannFaces: ThermalInput["neumannFaces"] = [],
): ThermalInput {
  return {
    sourceRevision: "a".repeat(64), studyId: "thermal-bar", bodyIds: ["bar"],
    consumedArtifactIds: ["brep", "mesh", "voxels"],
    grid: { cellDimensions: [count, 1, 1], originM: [0, 0, 0], cellSizeM },
    activeCells: new Uint32Array(count).fill(1), activeCellCount: count,
    conductivityWmK, dirichletCells, neumannFaces,
    rasterization: { toleranceM: cellSizeM / 100, selections: [] },
    capability: { maxCells: 262_144, maxBoundaryFaces: 1_048_576, maxRelativeAreaError: 0.02 },
  };
}

describe("WebGPU thermal adapter lifecycle", () => {
  beforeEach(() => {
    vi.stubGlobal("GPUBufferUsage", RECORDING_GPU_GLOBALS.GPUBufferUsage);
    vi.stubGlobal("GPUShaderStage", RECORDING_GPU_GLOBALS.GPUShaderStage);
    vi.stubGlobal("GPUMapMode", RECORDING_GPU_GLOBALS.GPUMapMode);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fails closed when a live WebGPU device is unavailable", () => {
    vi.stubGlobal("navigator", {});
    expect(createWebGpuThermalAdapter().supports({ kind: "thermal" } as never)).toMatchObject({
      supported: false, error: { code: "unsupported-capability", limit: { kind: "precision" } },
    });
  });

  it("dispatches the real conduction, PCG, reduction, and heat-flux boundary", async () => {
    const recorded = recordingGpu();
    const input = bar(65, 0.25, new Float32Array(65).fill(10), [
      { cellIndex: 0, temperatureK: 300 }, { cellIndex: 64, temperatureK: 400 },
    ]);

    const boundaryOnly = await solveThermalOnDevice(
      recorded.device as unknown as GPUDevice, input,
      new AbortController().signal, () => undefined,
    );
    expect(boundaryOnly).not.toHaveProperty("truthLevel");
    expect(recorded.dispatches).toEqual(expect.arrayContaining([
      "build_system", "initialize_pcg", "apply_conduction", "dot_product", "reduce_sum",
      "derive_face_heat_flux", "project_heat_flux", "derive_thermostat_power",
    ]));
    expect(recorded.buffers.every(({ destroyed }) => destroyed)).toBe(true);
    expect(recorded.errorScopeDepth()).toBe(0);
  });

  it("checks cancellation and device loss after submitted work and releases every buffer", async () => {
    const input = bar(4, 0.25, new Float32Array(4).fill(10), [
      { cellIndex: 0, temperatureK: 300 }, { cellIndex: 3, temperatureK: 400 },
    ]);
    const controller = new AbortController();
    const canceled = recordingGpu({ afterFirstSubmit: () => controller.abort() });
    await expect(solveThermalOnDevice(
      canceled.device as unknown as GPUDevice, input, controller.signal, () => undefined,
    )).rejects.toMatchObject({ name: "AbortError" });
    expect(canceled.buffers.every(({ destroyed }) => destroyed)).toBe(true);
    expect(canceled.errorScopeDepth()).toBe(0);

    const lost = recordingGpu({ loseAfterSubmit: true });
    await expect(solveThermalOnDevice(
      lost.device as unknown as GPUDevice, input,
      new AbortController().signal, () => undefined,
    )).rejects.toMatchObject({ code: "device-lost" });
    expect(lost.buffers.every(({ destroyed }) => destroyed)).toBe(true);
    expect(lost.errorScopeDepth()).toBe(0);
  });

  it("rejects malformed dimensions and non-finite conductivity before dispatch", async () => {
    const recorded = recordingGpu();
    const input = bar(4, 0.25, new Float32Array([10, 10, Number.NaN, 10]), [
      { cellIndex: 0, temperatureK: 300 }, { cellIndex: 3, temperatureK: 400 },
    ]);
    await expect(solveThermalOnDevice(
      recorded.device as unknown as GPUDevice, input,
      new AbortController().signal, () => undefined,
    )).rejects.toMatchObject({ code: "invalid-input" });
    expect(recorded.dispatches).toHaveLength(0);

    const fractionalDimensions = { ...bar(4, 0.25, new Float32Array(4).fill(10), [
      { cellIndex: 0, temperatureK: 300 },
    ]), grid: { cellDimensions: [4, 0.5, 2] as never, originM: [0, 0, 0] as const, cellSizeM: 0.25 } };
    await expect(solveThermalOnDevice(
      recorded.device as unknown as GPUDevice, fractionalDimensions,
      new AbortController().signal, () => undefined,
    )).rejects.toMatchObject({ code: "invalid-input" });
    const underflowArea = { ...bar(4, 1e-30, new Float32Array(4).fill(10), [
      { cellIndex: 0, temperatureK: 300 },
    ]) };
    await expect(solveThermalOnDevice(
      recorded.device as unknown as GPUDevice, underflowArea,
      new AbortController().signal, () => undefined,
    )).rejects.toMatchObject({ code: "invalid-input" });
  });

  it("rejects lossy f32 boundary sources before GPU allocation while preserving zero flux", async () => {
    const reject = async (areaM2: number, heatFluxWm2: number, extra = false) => {
      const recorded = recordingGpu();
      const input = bar(1, 1, new Float32Array([10]), [{ cellIndex: 0, temperatureK: 0 }], [
        { cellIndex: 0, axis: 0, direction: 1, areaM2, heatFluxWm2 },
        ...(extra ? [{ cellIndex: 0, axis: 1 as const, direction: 1 as const, areaM2, heatFluxWm2 }] : []),
      ]);
      await expect(solveThermalOnDevice(
        recorded.device as unknown as GPUDevice, input,
        new AbortController().signal, () => undefined,
      )).rejects.toMatchObject({ code: "invalid-input" });
      expect(recorded.buffers).toHaveLength(0);
      expect(recorded.dispatches).toHaveLength(0);
    };
    await reject(1e-50, 1);
    await reject(1e39, 1);
    await reject(1, 1e-50);
    await reject(1, 1e39);
    await reject(1e-30, 1e-30);
    await reject(1, 2e38, true);

    const zero = recordingGpu();
    await expect(solveThermalOnDevice(
      zero.device as unknown as GPUDevice,
      bar(1, 1, new Float32Array([10]), [{ cellIndex: 0, temperatureK: 0 }], [
        { cellIndex: 0, axis: 0, direction: 1, areaM2: 1, heatFluxWm2: 0 },
      ]), new AbortController().signal, () => undefined,
    )).resolves.toMatchObject({ iterations: 0, relativeResidual: 0, heatInputW: 0 });
  });

  it("never promotes a recording device into passed analytical evidence", async () => {
    const recorded = recordingGpu();
    vi.stubGlobal("navigator", { gpu: recorded.gpu });
    await expect(runThermalAnalyticalGate()).rejects.toMatchObject({ code: "unsupported-capability" });
    expect(recorded.device.destroy).toHaveBeenCalledOnce();

  });

  it("runs the canonical public adapter path and packs revision-bound artifacts", async () => {
    const recorded = recordingGpu();
    Object.assign(recorded.adapter, { info: {
      vendor: "recördïng", architecture: "recording", device: "recording", description: "recording",
    } });
    vi.stubGlobal("navigator", { gpu: recorded.gpu });
    const request = await createThermalAnalyticalRequest({
      dimensions: [2, 1, 1], cellSizeM: 0.1,
      bodies: [
        { id: "left", materialId: "left-material", conductivityWmK: 10 },
        { id: "right", materialId: "right-material", conductivityWmK: 1 },
      ],
      cellBodyIndices: new Uint32Array([0, 1]),
      boundaries: [
        { id: "left-fixed", cellIndex: 0, axis: 0, direction: -1, areaM2: 0.01, temperatureK: 0 },
        { id: "right-fixed", cellIndex: 1, axis: 0, direction: 1, areaM2: 0.01, temperatureK: 0 },
      ],
    });
    const progress: number[] = [];
    const run = await createWebGpuThermalAdapter().run(
      request, new AbortController().signal, ({ progress: value }) => progress.push(value),
    );

    expect(run.truthLevel).toBe("interactive-estimate");
    expect(run.artifacts).toHaveLength(3);
    for (const { record, payload } of run.artifacts) {
      expect(record.contentDigest).toBe(await digestArtifactPayload(payload));
      expect(record.sourceRevision).toBe(request.sourceRevision);
      expect(record.dependencies).toEqual(expect.arrayContaining([
        { kind: "entity", reference: "material:left-material" },
        { kind: "entity", reference: "material:right-material" },
      ]));
    }
    expect(progress).toEqual(expect.arrayContaining([0.05, 0.98]));
    expect(recorded.dispatches).toContain("derive_face_heat_flux");
    expect(recorded.buffers.every(({ destroyed }) => destroyed)).toBe(true);
    expect(recorded.errorScopeDepth()).toBe(0);
    expect(recorded.device.destroy).toHaveBeenCalledOnce();

    const lineage = await thermalAnalyticalLineage(request, run);
    expect(lineage.generatedArtifacts).toHaveLength(3);
    expect(lineage.generatedArtifacts[0]?.quantitySchemaId).toBe("temperature-K-v1");
    await expect(validateThermalAnalyticalLineage(request, run, {
      ...lineage, generatedArtifacts: lineage.generatedArtifacts.slice(1),
    })).rejects.toThrow(/lineage/);
    await expect(validateThermalAnalyticalLineage(request, run, {
      ...lineage, sourceRevision: "f".repeat(64),
    })).rejects.toThrow(/lineage/);
    const mutateDependencies = (dependencies: readonly unknown[]) => ({
      ...run, artifacts: run.artifacts.map((artifact, index) => index === 0 ? {
        ...artifact, record: { ...artifact.record, dependencies },
      } : artifact),
    }) as unknown as typeof run;
    const temperatureDependencies = run.artifacts[0].record.dependencies;
    await expect(thermalAnalyticalLineage(request, mutateDependencies(
      temperatureDependencies.filter((dependency) => dependency.kind !== "entity"
        || dependency.reference !== "material:right-material"),
    ))).rejects.toThrow(/dependencies/);
    await expect(thermalAnalyticalLineage(request, mutateDependencies([
      ...temperatureDependencies, { kind: "entity", reference: "material:foreign" },
    ]))).rejects.toThrow(/dependencies/);
    const summaryPayload = run.artifacts[2].payload;
    if (summaryPayload instanceof ArrayBuffer || ArrayBuffer.isView(summaryPayload)) throw new Error("summary payload shape");
    expect(JSON.parse(new TextDecoder().decode(summaryPayload.evidenceUtf8 as Uint8Array)))
      .toMatchObject({ device: { adapterInfo: { vendor: "recördïng" } } });
  });
});

describe("thermal analytical authority", () => {
  const evidence: ThermalDeviceEvidence = {
    realGpu: true, backend: "webgpu", precision: "f32",
    adapterInfo: { vendor: "vendor", architecture: "arch", device: "device", description: "description" },
    limits: { maxBufferSize: 1, maxStorageBufferBindingSize: 1, maxComputeWorkgroupsPerDimension: 1 },
  };
  const solve = (count: number, overrides: Record<string, number> = {}) => ({
    iterations: 10, relativeResidual: 1e-7,
    temperatureK: Float32Array.from({ length: count }, (_, index) => 300 + index),
    heatFluxWm2: new Float32Array(count * 3), heatInputW: 1.680672268907563,
    faceHeatFluxWm2: new Float32Array(count * 6), faceAreasM2: new Float32Array(count * 6),
    heatOutputW: 1.680672268907563, energyImbalanceW: 0, relativeEnergyImbalance: 1e-5,
    ...overrides,
  });
  const source = () => solve(11, { heatInputW: 4, heatOutputW: 4 });

  it("accepts only literal linear, series-resistance, residual, and energy thresholds", () => {
    expect(validateThermalAnalyticalResults(evidence, solve(101), solve(11), source())).toMatchObject({
      status: "passed", evidenceSource: "live-browser-webgpu",
      metrics: { maximumLinearTemperatureErrorK: 0, wallHeatRateRelativeError: 0 },
    });
    expect(() => validateThermalAnalyticalResults(evidence, solve(101, { relativeResidual: 1.1e-6 }), solve(11), source()))
      .toThrow(/analytical gate failed/);
    expect(() => validateThermalAnalyticalResults(evidence, solve(101), solve(11, { heatInputW: 1.8 }), source()))
      .toThrow(/analytical gate failed/);
    expect(() => validateThermalAnalyticalResults(evidence, solve(101), solve(11, { relativeEnergyImbalance: 0.001 }), source()))
      .toThrow(/analytical gate failed/);
  });

  it("rejects non-finite fields and incomplete device evidence", () => {
    const nonFinite = solve(101); nonFinite.temperatureK[50] = Number.NaN;
    expect(() => validateThermalAnalyticalResults(evidence, nonFinite, solve(11), source())).toThrow(/invalid dimensions or values/);
    expect(() => validateThermalAnalyticalResults({
      ...evidence, limits: { ...evidence.limits, maxBufferSize: Number.NaN },
    }, solve(101), solve(11), source())).toThrow(/lacks explicit real WebGPU evidence/);
  });

  it("locks signed face flux, harmonic magnitude, fractional area, and arbitrary axis", () => {
    const field = {
      ...solve(2),
      faceHeatFluxWm2: new Float32Array(12), faceAreasM2: new Float32Array(12),
    };
    field.faceHeatFluxWm2[0] = 1_000; field.faceAreasM2[0] = 0.01; // -x outward
    field.faceHeatFluxWm2[1] = -1_000; field.faceAreasM2[1] = 0.004; // +x outward, fractional
    field.faceHeatFluxWm2[4] = 168.06723; field.faceAreasM2[4] = 0.01; // -z harmonic
    field.faceHeatFluxWm2[5] = -168.06723; field.faceAreasM2[5] = 0.01; // +z harmonic
    const samples = [
      { cellIndex: 0, axis: 0 as const, direction: -1 as const, heatFluxWm2: 1_000, areaM2: 0.01 },
      { cellIndex: 0, axis: 0 as const, direction: 1 as const, heatFluxWm2: -1_000, areaM2: 0.004 },
      { cellIndex: 0, axis: 2 as const, direction: -1 as const, heatFluxWm2: 168.06723, areaM2: 0.01 },
      { cellIndex: 0, axis: 2 as const, direction: 1 as const, heatFluxWm2: -168.06723, areaM2: 0.01 },
    ];
    expect(() => validateThermalFaceSamples(field, samples)).not.toThrow();
    field.heatFluxWm2[0] = -1_000; field.heatFluxWm2[2] = -168.06723;
    expect(() => validateThermalFluxProjection(field)).not.toThrow();
    field.heatFluxWm2[0] = 1_000;
    expect(() => validateThermalFluxProjection(field)).toThrow(/projection/);
    field.heatFluxWm2[0] = -1_000;
    field.faceHeatFluxWm2[1] = 1_000;
    expect(() => validateThermalFaceSamples(field, samples)).toThrow(/face heat flux/);
    field.faceHeatFluxWm2[1] = -1_000; field.faceAreasM2[1] = 0.01;
    expect(() => validateThermalFaceSamples(field, samples)).toThrow(/face area/);
  });
});
