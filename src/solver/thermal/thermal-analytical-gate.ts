import { digestArtifactPayload } from "../../engineering/artifact-store";
import type { SolverRunResult } from "../../engineering/solver-adapter";
import { StructuralGpuError } from "../structural/structural-gpu-runtime";
import type { ThermalDeviceEvidence, ThermalResult } from "./thermal-contract";
import { createThermalAnalyticalRequest, type ThermalAnalyticalRequestSpec } from "./thermal-analytical-request";
import { validateThermalArtifactQuantityMetadata } from "./thermal-result-artifacts";
import { createWebGpuThermalAdapter } from "./webgpu-thermal-adapter";

export interface ThermalAnalyticalMetrics {
  readonly maximumLinearTemperatureErrorK: number;
  readonly expectedWallHeatRateW: number;
  readonly measuredWallHeatRateW: number;
  readonly wallHeatRateRelativeError: number;
  readonly sourceHeatRateRelativeError: number;
  readonly maximumRelativeResidual: number;
  readonly maximumRelativeEnergyImbalance: number;
  readonly linearRelativeEnergyImbalance: number;
  readonly wallRelativeEnergyImbalance: number;
  readonly sourceRelativeEnergyImbalance: number;
  readonly orientedRelativeEnergyImbalance: number;
}

export interface PassedThermalAnalyticalGate {
  readonly status: "passed";
  readonly evidenceSource: "live-browser-webgpu";
  readonly device: ThermalDeviceEvidence;
  readonly metrics: ThermalAnalyticalMetrics;
  readonly lineage: Readonly<{
    linear: ThermalAnalyticalLineage;
    wall: ThermalAnalyticalLineage;
    source: ThermalAnalyticalLineage;
    oriented: ThermalAnalyticalLineage;
  }>;
}

export interface ThermalAnalyticalLineage {
  readonly sourceRevision: string;
  readonly studyId: string;
  readonly inputArtifactIds: readonly string[];
  readonly generatedArtifacts: readonly Readonly<{
    artifactId: string;
    contentDigest: string;
    mediaType: string;
    orderedDependencies: readonly string[];
    quantitySchemaId: string;
    quantityMetadataDigest: string;
  }>[];
}

export interface ThermalFaceSample {
  readonly cellIndex: number;
  readonly axis: 0 | 1 | 2;
  readonly direction: -1 | 1;
  readonly heatFluxWm2: number;
  readonly areaM2: number;
}

type SolveFields = Pick<ThermalResult,
  "iterations" | "relativeResidual" | "temperatureK" | "heatFluxWm2" |
  "faceHeatFluxWm2" | "faceAreasM2" | "heatInputW" | "heatOutputW" |
  "energyImbalanceW" | "relativeEnergyImbalance">;

export function validateThermalFaceSamples(
  result: Pick<SolveFields, "faceHeatFluxWm2" | "faceAreasM2">,
  samples: readonly ThermalFaceSample[],
): void {
  for (const sample of samples) {
    const slot = sample.cellIndex * 6 + sample.axis * 2 + (sample.direction > 0 ? 1 : 0);
    const flux = result.faceHeatFluxWm2[slot], area = result.faceAreasM2[slot];
    const fluxTolerance = Math.max(1e-5, Math.abs(sample.heatFluxWm2) * 1e-4);
    const areaTolerance = Math.max(1e-9, Math.abs(sample.areaM2) * 1e-5);
    if (!Number.isFinite(flux) || Math.abs(flux! - sample.heatFluxWm2) > fluxTolerance) {
      throw new StructuralGpuError("diverged", `Thermal face heat flux failed at slot ${slot}`);
    }
    if (!Number.isFinite(area) || Math.abs(area! - sample.areaM2) > areaTolerance) {
      throw new StructuralGpuError("diverged", `Thermal face area failed at slot ${slot}`);
    }
  }
}

export function validateThermalFluxProjection(
  result: Pick<SolveFields, "heatFluxWm2" | "faceHeatFluxWm2" | "faceAreasM2">,
): void {
  const cells = result.heatFluxWm2.length / 3;
  if (!Number.isInteger(cells) || result.faceHeatFluxWm2.length !== cells * 6
    || result.faceAreasM2.length !== cells * 6) {
    throw new StructuralGpuError("diverged", "Thermal flux projection dimensions failed");
  }
  for (let cell = 0; cell < cells; cell += 1) for (let axis = 0; axis < 3; axis += 1) {
    const minus = cell * 6 + axis * 2, plus = minus + 1;
    const represented = result.faceAreasM2[minus]! + result.faceAreasM2[plus]!;
    const expected = represented > 0 ? (
      -result.faceHeatFluxWm2[minus]! * result.faceAreasM2[minus]!
      + result.faceHeatFluxWm2[plus]! * result.faceAreasM2[plus]!
    ) / represented : 0;
    const actual = result.heatFluxWm2[cell * 3 + axis]!;
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > Math.max(1e-5, Math.abs(expected) * 1e-4)) {
      throw new StructuralGpuError("diverged", `Thermal flux projection failed at cell ${cell}, axis ${axis}`);
    }
  }
}

const finiteMetrics = (metrics: ThermalAnalyticalMetrics) => Object.values(metrics).every(Number.isFinite);
const finiteFields = (result: SolveFields) => [
  result.temperatureK, result.heatFluxWm2, result.faceHeatFluxWm2, result.faceAreasM2,
].every((field) => field.every(Number.isFinite));

export function validateThermalAnalyticalResults(
  device: ThermalDeviceEvidence, linear: SolveFields, wall: SolveFields,
  source: SolveFields, oriented: SolveFields = linear,
): Omit<PassedThermalAnalyticalGate, "lineage"> {
  if (device.realGpu !== true || device.backend !== "webgpu" || device.precision !== "f32"
    || Object.values(device.adapterInfo).some((value) => typeof value !== "string")
    || Object.values(device.limits).some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new StructuralGpuError("unsupported-capability", "Thermal analytical gate lacks explicit real WebGPU evidence");
  }
  const dimensions = [
    [linear, 101], [wall, 11], [source, 11], [oriented, oriented === linear ? 101 : 11],
  ] as const;
  if (dimensions.some(([result, count]) => result.temperatureK.length !== count
    || result.heatFluxWm2.length !== count * 3 || result.faceHeatFluxWm2.length !== count * 6
    || result.faceAreasM2.length !== count * 6 || !finiteFields(result))) {
    throw new StructuralGpuError("diverged", "Thermal analytical gate fields have invalid dimensions or values");
  }
  let maximumLinearTemperatureErrorK = 0;
  for (let index = 0; index < 101; index += 1) maximumLinearTemperatureErrorK = Math.max(
    maximumLinearTemperatureErrorK, Math.abs(linear.temperatureK[index]! - (300 + index)),
  );
  // R = 0.4/(10A) + 0.05/(10A) + 0.05/(1A) + 0.5/(1A) = 59.5 K/W.
  const expectedWallHeatRateW = 1.680672268907563;
  const measuredWallHeatRateW = wall.heatInputW;
  const metrics = {
    maximumLinearTemperatureErrorK, expectedWallHeatRateW, measuredWallHeatRateW,
    wallHeatRateRelativeError: Math.abs(measuredWallHeatRateW - expectedWallHeatRateW) / expectedWallHeatRateW,
    sourceHeatRateRelativeError: Math.max(Math.abs(source.heatInputW - 4), Math.abs(source.heatOutputW - 4)) / 4,
    maximumRelativeResidual: Math.max(linear.relativeResidual, wall.relativeResidual, source.relativeResidual, oriented.relativeResidual),
    maximumRelativeEnergyImbalance: Math.max(linear.relativeEnergyImbalance, wall.relativeEnergyImbalance,
      source.relativeEnergyImbalance, oriented.relativeEnergyImbalance),
    linearRelativeEnergyImbalance: linear.relativeEnergyImbalance,
    wallRelativeEnergyImbalance: wall.relativeEnergyImbalance,
    sourceRelativeEnergyImbalance: source.relativeEnergyImbalance,
    orientedRelativeEnergyImbalance: oriented.relativeEnergyImbalance,
  };
  if (!finiteMetrics(metrics) || metrics.maximumLinearTemperatureErrorK > 0.5
    || metrics.wallHeatRateRelativeError > 0.02 || metrics.sourceHeatRateRelativeError > 0.001
    || metrics.maximumRelativeResidual > 1e-6 || metrics.maximumRelativeEnergyImbalance >= 0.001) {
    throw new StructuralGpuError("diverged", `Thermal analytical gate failed: ${JSON.stringify(metrics)}`);
  }
  return { status: "passed", evidenceSource: "live-browser-webgpu", device, metrics };
}

function dependencyKey(dependency: SolverRunResult<ThermalResult>["artifacts"][number]["record"]["dependencies"][number]) {
  return dependency.kind === "artifact" ? `artifact:${dependency.artifactId}` : `entity:${dependency.reference}`;
}

const schemaId = (mediaType: string) => mediaType.endsWith("quantity=temperature")
  ? ["temperature-K-v1", "quantityMetadataUtf8"] as const
  : mediaType.endsWith("quantity=heat-flux")
    ? ["heat-flux-outward-face-v1", "quantityMetadataUtf8"] as const
    : ["thermal-summary-scalars-v1", "metricsSchemaUtf8"] as const;

function expectedBaseDependencies(
  request: Awaited<ReturnType<typeof createThermalAnalyticalRequest>>,
): string[] {
  const study = request.document.studies.find(({ id }) => id === request.studyId);
  if (!study || study.kind !== "thermal-steady") {
    throw new StructuralGpuError("diverged", "Thermal analytical lineage study is unresolved");
  }
  const materialIds = [...new Set("materialAssignments" in study
    ? study.materialAssignments.map(({ materialId }) => materialId) : [study.materialId])];
  const boundaries = study.boundaries ?? { temperatures: [], heatFluxes: [] };
  return [
    ...request.inputArtifacts.map(({ id }) => `artifact:${id}`),
    ...study.bodyIds.map((id) => `entity:body:${id}`),
    ...materialIds.map((id) => `entity:material:${id}`),
    ...[...boundaries.temperatures, ...boundaries.heatFluxes]
      .map(({ selectionId }) => `entity:named-selection:${selectionId}`),
    `entity:study:${study.id}`,
  ].sort();
}

async function actualLineage(
  request: Awaited<ReturnType<typeof createThermalAnalyticalRequest>>,
  run: SolverRunResult<ThermalResult>,
): Promise<ThermalAnalyticalLineage> {
  if (run.truthLevel !== "interactive-estimate" || run.artifacts.length !== 3) {
    throw new StructuralGpuError("diverged", "Thermal public adapter artifact set is incomplete");
  }
  for (const { record, payload } of run.artifacts) {
    validateThermalArtifactQuantityMetadata(record.mediaType, payload);
    if (record.sourceRevision !== request.sourceRevision || record.units !== "m"
      || record.contentDigest !== await digestArtifactPayload(payload)
      || !request.inputArtifacts.every(({ id }) => record.dependencies.some(
        (dependency) => dependency.kind === "artifact" && dependency.artifactId === id,
      ))) throw new StructuralGpuError("diverged", "Thermal public adapter artifact provenance failed");
  }
  const [temperature, flux, summary] = run.artifacts;
  if (![temperature.record.id, flux.record.id].every((id) => summary.record.dependencies.some(
    (dependency) => dependency.kind === "artifact" && dependency.artifactId === id,
  ))) throw new StructuralGpuError("diverged", "Thermal summary field dependencies failed");
  const baseDependencies = expectedBaseDependencies(request);
  const expectedDependencies = [baseDependencies, baseDependencies, [
    ...baseDependencies, `artifact:${temperature.record.id}`, `artifact:${flux.record.id}`,
  ].sort()];
  run.artifacts.forEach(({ record }, index) => {
    if (JSON.stringify(record.dependencies.map(dependencyKey)) !== JSON.stringify(expectedDependencies[index])) {
      throw new StructuralGpuError("diverged", "Thermal analytical artifact dependencies failed exact authority comparison");
    }
  });
  return {
    sourceRevision: request.sourceRevision, studyId: request.studyId,
    inputArtifactIds: request.inputArtifacts.map(({ id }) => id),
    generatedArtifacts: await Promise.all(run.artifacts.map(async ({ record, payload }) => {
      const [quantitySchemaId, key] = schemaId(record.mediaType);
      const encoded = !(payload instanceof ArrayBuffer) && !ArrayBuffer.isView(payload) ? payload[key] : undefined;
      if (Object.prototype.toString.call(encoded) !== "[object Uint8Array]") {
        throw new StructuralGpuError("diverged", "Thermal artifact lineage metadata is missing");
      }
      return {
        artifactId: record.id, contentDigest: record.contentDigest, mediaType: record.mediaType,
        orderedDependencies: record.dependencies.map(dependencyKey), quantitySchemaId,
        quantityMetadataDigest: await digestArtifactPayload(encoded as Uint8Array),
      };
    })),
  };
}

export const thermalAnalyticalLineage = actualLineage;

export async function validateThermalAnalyticalLineage(
  request: Awaited<ReturnType<typeof createThermalAnalyticalRequest>>,
  run: SolverRunResult<ThermalResult>, candidate: ThermalAnalyticalLineage,
): Promise<void> {
  const expected = await actualLineage(request, run);
  if (JSON.stringify(candidate) !== JSON.stringify(expected)) {
    throw new StructuralGpuError("diverged", "Thermal analytical artifact lineage failed");
  }
}

const body = (id: string, materialId: string, conductivityWmK: number) => ({ id, materialId, conductivityWmK });
const fixedEnds = (axis: 0 | 2, last: number, areaM2: number) => [
  { id: "cold", cellIndex: 0, axis, direction: -1 as const, areaM2, temperatureK: 300 },
  { id: "hot", cellIndex: last, axis, direction: 1 as const, areaM2, temperatureK: 400 },
];

async function run(spec: ThermalAnalyticalRequestSpec) {
  const request = await createThermalAnalyticalRequest(spec);
  const result = await createWebGpuThermalAdapter().run(request, new AbortController().signal, () => undefined);
  const lineage = await thermalAnalyticalLineage(request, result);
  await validateThermalAnalyticalLineage(request, result, lineage);
  return { output: result.output, lineage };
}

export async function runThermalAnalyticalGate(): Promise<PassedThermalAnalyticalGate> {
  const linearRun = await run({ dimensions: [101, 1, 1], cellSizeM: 0.01,
    bodies: [body("bar", "bar-material", 10)], cellBodyIndices: new Uint32Array(101),
    boundaries: fixedEnds(0, 100, 0.0001) });
  const wallRun = await run({ dimensions: [11, 1, 1], cellSizeM: 0.1,
    bodies: [body("left", "left-material", 10), body("right", "right-material", 1)],
    cellBodyIndices: new Uint32Array([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]),
    boundaries: fixedEnds(0, 10, 0.01) });
  const sourceRun = await run({ dimensions: [11, 1, 1], cellSizeM: 0.1,
    bodies: [body("source-bar", "source-material", 10)], cellBodyIndices: new Uint32Array(11),
    boundaries: [fixedEnds(0, 10, 0.01)[0]!,
      { id: "source", cellIndex: 10, axis: 0, direction: 1, areaM2: 0.004, heatFluxWm2: 1_000 }] });
  const orientedRun = await run({ dimensions: [1, 1, 11], cellSizeM: 0.1,
    bodies: [body("oriented", "oriented-material", 10)], cellBodyIndices: new Uint32Array(11),
    boundaries: fixedEnds(2, 10, 0.01) });
  const linear = linearRun.output, wall = wallRun.output, source = sourceRun.output, oriented = orientedRun.output;
  validateThermalFaceSamples(linear, [
    { cellIndex: 50, axis: 0, direction: -1, heatFluxWm2: 1_000, areaM2: 0.0001 },
    { cellIndex: 50, axis: 0, direction: 1, heatFluxWm2: -1_000, areaM2: 0.0001 },
  ]);
  validateThermalFaceSamples(wall, [
    { cellIndex: 4, axis: 0, direction: 1, heatFluxWm2: -168.0672269, areaM2: 0.01 },
    { cellIndex: 5, axis: 0, direction: -1, heatFluxWm2: 168.0672269, areaM2: 0.01 },
  ]);
  validateThermalFaceSamples(source, [
    { cellIndex: 10, axis: 0, direction: 1, heatFluxWm2: -1_000, areaM2: 0.004 },
  ]);
  validateThermalFaceSamples(oriented, [
    { cellIndex: 5, axis: 2, direction: -1, heatFluxWm2: 1_000, areaM2: 0.01 },
    { cellIndex: 5, axis: 2, direction: 1, heatFluxWm2: -1_000, areaM2: 0.01 },
  ]);
  for (const result of [linear, wall, source, oriented]) validateThermalFluxProjection(result);
  return { ...validateThermalAnalyticalResults(linear.device, linear, wall, source, oriented), lineage: {
    linear: linearRun.lineage, wall: wallRun.lineage, source: sourceRun.lineage, oriented: orientedRun.lineage,
  } };
}
