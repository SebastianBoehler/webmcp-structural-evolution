import { defineDesignDocument, type DesignDocument } from "../../cad/document-schema";
import { defineEngineeringSolveRequest } from "../../cad/engineering-job-contract";
import { createOcctCadAdapter } from "../../cad/kernel/occt-adapter";
import type { SemanticMeshPayload } from "../../cad/rebuild-payload";
import {
  defineCadEvaluationRequest, type CadEvaluationEvent, type CadKernelAdapter,
} from "../../cad/runtime-contracts";
import type { EngineeringSolveRequest } from "../../engineering/solver-adapter";
import type { ThermalSolveInput } from "../../solver/thermal/thermal-contract";
import { produceThermalVoxelMesh } from "../../solver/thermal/thermal-voxelizer";

export const COBOT_THERMAL_DIMENSIONS = [42, 8, 8] as const;
export const COBOT_THERMAL_CELL_SIZE_M = .01;
export const COBOT_THERMAL_BOUNDARY_AREA_M2 = .0064;
export const COBOT_THERMAL_HEAT_FLUX_WM2 = 12_500;
export const COBOT_THERMAL_HEAT_INPUT_W = 80;

export interface CobotThermalBenchmark {
  readonly request: EngineeringSolveRequest<ThermalSolveInput>;
  readonly selectedAreasM2: Readonly<{
    mounting: typeof COBOT_THERMAL_BOUNDARY_AREA_M2;
    motor: typeof COBOT_THERMAL_BOUNDARY_AREA_M2;
  }>;
  readonly heatInputW: typeof COBOT_THERMAL_HEAT_INPUT_W;
}

const abort = (signal: AbortSignal) => {
  if (signal.aborted) throw signal.reason instanceof Error
    ? signal.reason : new DOMException("Cobot thermal build was cancelled", "AbortError");
};

function reference(face: SemanticMeshPayload["faces"][number]) {
  return {
    bodyId: face.bodyId, ownerFeatureId: face.signature.ownerFeatureId,
    expectedKind: "face" as const, stableId: face.id,
    signature: { geometry: face.signature.geometry,
      centroidM: [...face.signature.centroidM] as [number, number, number],
      measureSI: face.signature.measureSI, adjacentKinds: [...face.signature.adjacentKinds] },
  };
}

async function geometryDocument(): Promise<DesignDocument> {
  return defineDesignDocument({
    id: "se6-upper-arm-link", label: "SE-6 exact aluminum upper-arm link", schemaVersion: 6,
    units: { length: "m", angle: "rad", mass: "kg" },
    createdBy: { kind: "agent", id: "thermal-browser-gate" },
    frames: [{ id: "world", label: "World", transform: {
      position: { x: { value: 0, unit: "m" }, y: { value: 0, unit: "m" }, z: { value: 0, unit: "m" } },
      orientation: { roll: { value: 0, unit: "rad" }, pitch: { value: 0, unit: "rad" }, yaw: { value: 0, unit: "rad" } },
    } }],
    parameters: [], sketches: [{ id: "link-profile", plane: "frame:world", constraints: [
      { id: "link-length", kind: "distance", first: { entityId: "link-outline", point: "left" },
        second: { entityId: "link-outline", point: "right" }, axis: "x", valueM: .42 },
      { id: "link-width", kind: "distance", first: { entityId: "link-outline", point: "bottom" },
        second: { entityId: "link-outline", point: "top" }, axis: "y", valueM: .08 },
    ],
      entities: [{ id: "link-outline", kind: "rectangle", centerM: [.21, .04], sizeM: [.42, .08] }] }],
    features: [{ id: "link-extrude", kind: "extrude", sketchId: "link-profile", distanceM: .08 }],
    bodies: [{ id: "upper-arm-link", featureId: "link-extrude" }],
    components: [], instances: [], mates: [], namedSelections: [], materials: [], studies: [],
  });
}

function endFaces(mesh: SemanticMeshPayload) {
  const faces = mesh.faces.filter(({ bodyId, signature, surfaceEvidence }) =>
    bodyId === "upper-arm-link" && signature.geometry === "plane"
    && surfaceEvidence?.kind === "plane" && Math.abs(surfaceEvidence.normal[0]) > 1 - 1e-9)
    .sort((left, right) => left.signature.centroidM[0] - right.signature.centroidM[0]);
  if (faces.length !== 2 || faces.some(({ signature }) =>
    Math.abs(signature.measureSI - COBOT_THERMAL_BOUNDARY_AREA_M2) > 1e-10)) {
    throw new Error("SE-6 exact mounting and motor interface faces are unresolved");
  }
  return { mounting: faces[0]!, motor: faces[1]! };
}

async function thermalDocument(geometry: DesignDocument, mesh: SemanticMeshPayload) {
  const faces = endFaces(mesh), { revision: _revision, ...content } = geometry;
  return defineDesignDocument({ ...content,
    namedSelections: [
      { id: "mounting-interface", reference: reference(faces.mounting) },
      { id: "motor-interface", reference: reference(faces.motor) },
    ],
    materials: [{ id: "aluminum-6061", kind: "isotropic", densityKgM3: 2_700,
      youngsModulusPa: 69e9, poissonRatio: .33, failureStressPa: 276e6,
      thermalConductivityWmK: 167 }],
    studies: [{ id: "se6-upper-arm-thermal", kind: "thermal-steady",
      bodyIds: ["upper-arm-link"], materialId: "aluminum-6061",
      boundaries: {
        temperatures: [{ selectionId: "mounting-interface", temperatureK: 300 }],
        heatFluxes: [{ selectionId: "motor-interface", heatFluxWm2: COBOT_THERMAL_HEAT_FLUX_WM2 }],
      } }],
  });
}

export const createCobotThermalDocument = thermalDocument;

type ExactOutputs = Readonly<{ semantic: Readonly<{ payload: SemanticMeshPayload }> }>;
async function evaluateExact(adapter: CadKernelAdapter, document: DesignDocument, id: string, signal: AbortSignal): Promise<ExactOutputs> {
  const terminals: CadEvaluationEvent[] = [];
  await adapter.evaluate(await defineCadEvaluationRequest({ requestId: id, document,
    sourceRevision: document.revision, requestedOutputs: ["brep", "semantic-mesh"],
    settings: { gate: "se6-cobot-thermal-v1" } }), signal,
  (event) => { if (event.state !== "progress") terminals.push(event); });
  const terminal = terminals[0];
  if (terminals.length !== 1 || terminal?.state !== "succeeded") {
    throw new Error(terminal?.state === "failed"
      ? `SE-6 exact thermal CAD failed (${terminal.error.code}): ${terminal.error.message}`
      : "SE-6 exact thermal CAD did not emit one success terminal");
  }
  const brep = terminal.results.find(({ output }) => output === "brep");
  const semantic = terminal.results.find(({ output }) => output === "semantic-mesh");
  if (!brep || brep.output !== "brep" || !semantic || semantic.output !== "semantic-mesh") {
    throw new Error("SE-6 exact thermal CAD omitted BREP or semantic mesh");
  }
  return { semantic };
}

export async function createCobotThermalBenchmarkFromDocument(
  document: DesignDocument,
  signal: AbortSignal = new AbortController().signal,
): Promise<CobotThermalBenchmark> {
  const study = document.studies.find(({ id }) => id === "se6-upper-arm-thermal");
  if (!study || study.kind !== "thermal-steady") throw new Error("SE-6 thermal study is missing");
  const voxel = await produceThermalVoxelMesh({ document,
    bodyIds: ["upper-arm-link"], cellSizeM: COBOT_THERMAL_CELL_SIZE_M,
    rasterizationToleranceM: 1e-6, signal });
  const exact = voxel.exact;
  const request = await defineEngineeringSolveRequest<ThermalSolveInput>({
    jobId: "se6-cobot-thermal-live", kind: "thermal", sourceRevision: document.revision,
    inputArtifacts: [exact.brepArtifact, exact.semanticArtifact, voxel.record],
    settings: { gate: "se6-cobot-thermal-v1" }, studyId: study.id, document, input: {
      exactBrepArtifactId: exact.brepArtifact.id,
      semanticMeshArtifactId: exact.semanticArtifact.id,
      semanticMeshPayload: exact.semanticMeshPayload,
      thermalVoxelArtifactId: voxel.record.id, voxelPayload: voxel.payload,
    },
  });
  return { request, selectedAreasM2: { mounting: .0064, motor: .0064 }, heatInputW: 80 };
}

export async function buildCobotThermalBenchmark(
  signal: AbortSignal = new AbortController().signal,
): Promise<CobotThermalBenchmark> {
  const adapter = createOcctCadAdapter();
  try {
    abort(signal);
    const geometry = await geometryDocument();
    const discovery = await evaluateExact(adapter, geometry, "se6-thermal-discovery", signal);
    const document = await thermalDocument(geometry, discovery.semantic.payload);
    abort(signal);
    return createCobotThermalBenchmarkFromDocument(document, signal);
  } finally { adapter.dispose?.(); }
}
