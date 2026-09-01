import { defineArtifactRecord, type ArtifactRecord } from "../../cad/artifact-contract";
import { revisionId } from "../../domain/revisions";
import { digestArtifactPayload, type ArtifactPayload } from "../../engineering/artifact-store";
import type { EngineeringSolveRequest, SolverRunResult } from "../../engineering/solver-adapter";
import type { ThermalResult, ThermalSolveInput } from "./thermal-contract";

type Dependency = ArtifactRecord["dependencies"][number];

function bytes(value: unknown) {
  return Uint8Array.from(new TextEncoder().encode(JSON.stringify(value)));
}

const TEMPERATURE_UNITS = Object.freeze({
  coordinateLengthUnit: "m", quantity: "temperature", quantityUnit: "K",
});
const FLUX_UNITS = Object.freeze({
  coordinateLengthUnit: "m", quantity: "heat-flux", quantityUnit: "W/m^2",
  faceAreaUnit: "m^2", heatRateUnit: "W", faceSignConvention: "positive-outward-normal",
});
const SUMMARY_UNITS = Object.freeze({
  coordinateLengthUnit: "m", scalars: [
    ["iterations", "1"], ["relativeResidual", "1"], ["heatInputW", "W"],
    ["heatOutputW", "W"], ["energyImbalanceW", "W"], ["relativeEnergyImbalance", "1"],
  ],
});

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function metadata(payload: ArtifactPayload, key: string, label: string): unknown {
  if (payload instanceof ArrayBuffer || ArrayBuffer.isView(payload)) {
    throw new Error(`Thermal ${label} quantity metadata is missing`);
  }
  const encoded = payload[key];
  if (Object.prototype.toString.call(encoded) !== "[object Uint8Array]") {
    throw new Error(`Thermal ${label} quantity metadata is missing`);
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(encoded)); }
  catch { throw new Error(`Thermal ${label} quantity metadata is invalid`); }
}

export function validateThermalArtifactQuantityMetadata(
  mediaType: string, payload: ArtifactPayload,
): void {
  if (mediaType.endsWith("quantity=temperature")) {
    if (canonical(metadata(payload, "quantityMetadataUtf8", "temperature")) !== canonical(TEMPERATURE_UNITS)) {
      throw new Error("Thermal temperature quantity metadata is invalid");
    }
    return;
  }
  if (mediaType.endsWith("quantity=heat-flux")) {
    if (canonical(metadata(payload, "quantityMetadataUtf8", "heat-flux")) !== canonical(FLUX_UNITS)) {
      throw new Error("Thermal heat-flux quantity metadata is invalid");
    }
    return;
  }
  if (mediaType === "application/vnd.structural-evolution.thermal-result") {
    if (canonical(metadata(payload, "metricsSchemaUtf8", "mixed-summary")) !== canonical(SUMMARY_UNITS)) {
      throw new Error("Thermal mixed-summary quantity metadata is invalid");
    }
    return;
  }
  throw new Error(`Thermal result media type is unsupported: ${mediaType}`);
}

function dependencies(request: EngineeringSolveRequest<ThermalSolveInput>): readonly Dependency[] {
  const study = request.document.studies.find(({ id }) => id === request.studyId);
  if (!study || study.kind !== "thermal-steady") throw new Error("Thermal result study is unresolved");
  const boundaries = study.boundaries ?? { temperatures: [], heatFluxes: [] };
  const materialIds = "materialAssignments" in study
    ? study.materialAssignments.map(({ materialId }) => materialId) : [study.materialId];
  return [
    { kind: "entity", reference: `study:${study.id}` },
    ...[...new Set(materialIds)].map((id) => ({
      kind: "entity" as const, reference: `material:${id}` as const,
    })),
    ...study.bodyIds.map((id) => ({ kind: "entity" as const, reference: `body:${id}` as const })),
    ...[...boundaries.temperatures, ...boundaries.heatFluxes].map(({ selectionId }) => ({
      kind: "entity" as const, reference: `named-selection:${selectionId}` as const,
    })),
    ...request.inputArtifacts.map(({ id }) => ({ kind: "artifact" as const, artifactId: id })),
  ];
}

async function record(
  request: EngineeringSolveRequest<ThermalSolveInput>, mediaType: string,
  payload: ArtifactPayload, settingsDigest: string, deps: readonly Dependency[],
) {
  validateThermalArtifactQuantityMetadata(mediaType, payload);
  return defineArtifactRecord({
    kind: "field", sourceRevision: request.sourceRevision,
    producer: { name: "webgpu-steady-conduction", version: "1.0.0" }, settingsDigest,
    contentDigest: await digestArtifactPayload(payload), units: "m", mediaType, dependencies: deps,
  });
}

export async function packInteractiveThermalResult(
  request: EngineeringSolveRequest<ThermalSolveInput>, result: ThermalResult,
): Promise<SolverRunResult<ThermalResult>> {
  const deps = dependencies(request);
  const settingsDigest = await revisionId({ solver: "webgpu-steady-conduction-1.0.0", grid: result.grid });
  const temperaturePayload = {
    temperatureK: new Float32Array(result.temperatureK), quantityMetadataUtf8: bytes(TEMPERATURE_UNITS),
  };
  const fluxPayload = {
    heatFluxWm2: new Float32Array(result.heatFluxWm2),
    faceHeatFluxWm2: new Float32Array(result.faceHeatFluxWm2),
    faceAreasM2: new Float32Array(result.faceAreasM2),
    quantityMetadataUtf8: bytes(FLUX_UNITS),
  };
  const temperature = await record(request, "application/vnd.structural-evolution.thermal-field; quantity=temperature", temperaturePayload, settingsDigest, deps);
  const flux = await record(request, "application/vnd.structural-evolution.thermal-field; quantity=heat-flux", fluxPayload, settingsDigest, deps);
  const summaryPayload = {
    metrics: new Float64Array([
      result.iterations, result.relativeResidual, result.heatInputW, result.heatOutputW,
      result.energyImbalanceW, result.relativeEnergyImbalance,
    ]),
    evidenceUtf8: bytes({ truthLevel: result.truthLevel, device: result.device }),
    rasterizationUtf8: bytes(result.rasterization),
    metricsSchemaUtf8: bytes(SUMMARY_UNITS),
  };
  const summary = await record(request, "application/vnd.structural-evolution.thermal-result", summaryPayload, settingsDigest, [
    ...deps, { kind: "artifact", artifactId: temperature.id }, { kind: "artifact", artifactId: flux.id },
  ]);
  return { output: result, truthLevel: result.truthLevel, artifacts: [
    { record: temperature, payload: temperaturePayload },
    { record: flux, payload: fluxPayload }, { record: summary, payload: summaryPayload },
  ] };
}
