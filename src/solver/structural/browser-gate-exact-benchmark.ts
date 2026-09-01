import type { ArtifactRecord } from "../../cad/artifact-contract";
import { defineDesignDocument, type DesignDocument } from "../../cad/document-schema";
import { defineEngineeringSolveRequest } from "../../cad/engineering-job-contract";
import { type OpaqueBytesPayload, type SemanticMeshPayload } from "../../cad/rebuild-payload";
import {
  defineCadEvaluationRequest, type CadEvaluationEvent, type CadKernelAdapter,
} from "../../cad/runtime-contracts";
import { createOcctCadAdapter } from "../../cad/kernel/occt-adapter";
import type { EngineeringSolveRequest } from "../../engineering/solver-adapter";
import type { TopologySolveInput } from "../topology/topology-contract";
import { produceStructuralVoxelMesh } from "./structural-voxelizer";
import type { StructuralSolveInput } from "./structural-contract";

export type BrowserBenchmarkId = "axial" | "cantilever" | "drone" | "cobot";
export interface BrowserBenchmarkDefinition {
  readonly id: BrowserBenchmarkId;
  readonly sizeM: readonly [number, number, number];
  readonly cellSizeM: number;
  readonly forceN: readonly [number, number, number];
  readonly topologyTarget?: number;
  readonly topologyAcceptance?: Readonly<{
    maximumDisplacementM: number;
    maximumVonMisesStressPa: number;
    minimumSafetyFactor: number;
    maximumMaterialFraction: number;
  }>;
}
export interface ExactBrowserBenchmark {
  readonly definition: BrowserBenchmarkDefinition;
  readonly structuralRequest: EngineeringSolveRequest<StructuralSolveInput>;
  readonly topologyRequest?: EngineeringSolveRequest<TopologySolveInput>;
  readonly exactBrepArtifact: ArtifactRecord;
  readonly semanticMeshArtifact: ArtifactRecord;
}

export const BROWSER_BENCHMARKS: readonly BrowserBenchmarkDefinition[] = [
  { id: "axial", sizeM: [.1, .01, .01], cellSizeM: .005, forceN: [1_000, 0, 0] },
  { id: "cantilever", sizeM: [.12, .02, .01], cellSizeM: .005, forceN: [0, -100, 0] },
  { id: "drone", sizeM: [.08, .03, .01], cellSizeM: .005, forceN: [0, -120, 0], topologyTarget: .75,
    topologyAcceptance: { maximumDisplacementM: .02, maximumVonMisesStressPa: 180e6,
      minimumSafetyFactor: 1.25, maximumMaterialFraction: .75 } },
  { id: "cobot", sizeM: [.1, .03, .02], cellSizeM: .005, forceN: [0, -1_000, 0], topologyTarget: .75,
    topologyAcceptance: { maximumDisplacementM: .03, maximumVonMisesStressPa: 150e6,
      minimumSafetyFactor: 1.5, maximumMaterialFraction: .75 } },
];

type Success = Extract<CadEvaluationEvent, { state: "succeeded" }>;
type ExactOutputs = Readonly<{
  brep: { artifact: ArtifactRecord; payload: OpaqueBytesPayload };
  mesh: { artifact: ArtifactRecord; payload: SemanticMeshPayload };
}>;

async function evaluateExact(
  adapter: CadKernelAdapter,
  document: DesignDocument,
  requestId: string,
  signal: AbortSignal,
): Promise<ExactOutputs> {
  const terminals: CadEvaluationEvent[] = [];
  await adapter.evaluate(await defineCadEvaluationRequest({
    requestId, document, sourceRevision: document.revision,
    requestedOutputs: ["brep", "semantic-mesh"], settings: { gate: "structural-topology-browser-v1" },
  }), signal, (event) => { if (event.state !== "progress") terminals.push(event); });
  if (terminals.length !== 1) throw new Error(`${requestId} emitted ${terminals.length} CAD terminals`);
  const terminal = terminals[0]!;
  if (terminal.state !== "succeeded") {
    throw new Error(terminal.state === "failed"
      ? `${requestId} exact CAD failed (${terminal.error.code}): ${terminal.error.message}`
      : `${requestId} exact CAD was cancelled`);
  }
  const success = terminal as Success;
  const brep = success.results.find(({ output }) => output === "brep");
  const mesh = success.results.find(({ output }) => output === "semantic-mesh");
  if (!brep || brep.output !== "brep" || !mesh || mesh.output !== "semantic-mesh") {
    throw new Error(`${requestId} omitted exact BREP or semantic mesh output`);
  }
  return { brep, mesh };
}

function baseDocument(definition: BrowserBenchmarkDefinition) {
  const [length, width, height] = definition.sizeM;
  const profiles = definition.id === "drone" ? [
    { id: "arm", centerM: [length / 2, width / 2], sizeM: [length, width / 3] },
    { id: "root", centerM: [length / 8, width / 2], sizeM: [length / 4, width] },
  ] : definition.id === "cobot" ? [
    { id: "web", centerM: [length / 2, width / 2], sizeM: [length, width / 3] },
    { id: "shoulder", centerM: [length / 10, width / 2], sizeM: [length / 5, width] },
    { id: "elbow", centerM: [length * .9, width / 2], sizeM: [length / 5, width * .7] },
  ] : [{ id: "profile", centerM: [length / 2, width / 2], sizeM: [length, width] }];
  const sketches = profiles.map((profile) => ({
    id: `${profile.id}-sketch`, plane: "frame:world", constraints: [
      { id: `${profile.id}-width`, kind: "distance" as const,
        first: { entityId: `${profile.id}-outline`, point: "left" as const },
        second: { entityId: `${profile.id}-outline`, point: "right" as const },
        axis: "x" as const, valueM: profile.sizeM[0] },
      { id: `${profile.id}-height`, kind: "distance" as const,
        first: { entityId: `${profile.id}-outline`, point: "bottom" as const },
        second: { entityId: `${profile.id}-outline`, point: "top" as const },
        axis: "y" as const, valueM: profile.sizeM[1] },
    ],
    entities: [{ id: `${profile.id}-outline`, kind: "rectangle" as const,
      centerM: profile.centerM, sizeM: profile.sizeM }],
  }));
  const extrudes = profiles.map((profile) => ({
    id: `${profile.id}-extrude`, kind: "extrude" as const,
    sketchId: `${profile.id}-sketch`, distanceM: height,
  }));
  const joins = profiles.slice(1).map((profile, index) => ({
    id: `${profile.id}-join`, kind: "union" as const,
    leftFeatureId: index === 0 ? extrudes[0]!.id : `${profiles[index]!.id}-join`,
    rightFeatureId: `${profile.id}-extrude`,
  }));
  const finalFeatureId = joins.at(-1)?.id ?? extrudes[0]!.id;
  return defineDesignDocument({
    id: `${definition.id}-exact`, label: `${definition.id} exact benchmark`, schemaVersion: 6,
    units: { length: "m", angle: "rad", mass: "kg" },
    createdBy: { kind: "agent", id: "structural-topology-browser-gate" },
    frames: [{
      id: "world", label: "World", transform: {
        position: { x: { value: 0, unit: "m" }, y: { value: 0, unit: "m" }, z: { value: 0, unit: "m" } },
        orientation: { roll: { value: 0, unit: "rad" }, pitch: { value: 0, unit: "rad" }, yaw: { value: 0, unit: "rad" } },
      },
    }],
    parameters: [],
    sketches, features: [...extrudes, ...joins], bodies: [{ id: "body", featureId: finalFeatureId }],
    components: [], instances: [], mates: [], namedSelections: [], materials: [], studies: [],
  });
}

function reference(face: SemanticMeshPayload["faces"][number]) {
  return {
    bodyId: face.bodyId, ownerFeatureId: face.signature.ownerFeatureId,
    expectedKind: "face" as const, stableId: face.id,
    signature: {
      geometry: face.signature.geometry,
      centroidM: [...face.signature.centroidM] as [number, number, number],
      measureSI: face.signature.measureSI, adjacentKinds: [...face.signature.adjacentKinds],
    },
  };
}

async function engineeringDocument(
  geometry: DesignDocument,
  mesh: SemanticMeshPayload,
  definition: BrowserBenchmarkDefinition,
): Promise<DesignDocument> {
  const faces = mesh.faces.filter(({ bodyId }) => bodyId === "body")
    .filter(({ signature }) => signature.kind === "face" && signature.geometry === "plane")
    .sort((left, right) => left.signature.centroidM[0] - right.signature.centroidM[0]
      || right.signature.measureSI - left.signature.measureSI);
  const fixed = faces[0]!, loaded = faces.at(-1)!;
  if (!fixed || !loaded || fixed.id === loaded.id) throw new Error(`${definition.id} exact end faces are unresolved`);
  const { revision: _revision, ...content } = geometry;
  const topology = definition.topologyTarget === undefined ? [] : [{
    id: "topology", kind: "topology" as const, sourceStudyId: "structural",
    configurationState: "configured" as const, objective: "minimum-compliance" as const,
    targetVolumeFraction: definition.topologyTarget, moveLimit: .25,
    filterRadiusM: definition.cellSizeM, minimumFeatureM: definition.cellSizeM,
    maxIterations: 1, extraction: { isoValue: .5, toleranceM: 1e-6 },
    protectedVoidSelectionIds: [],
    acceptance: definition.topologyAcceptance!,
  }];
  return defineDesignDocument({
    ...content,
    namedSelections: [
      { id: "fixed", reference: reference(fixed) },
      { id: "loaded", reference: reference(loaded) },
    ],
    materials: [{
      id: "steel", kind: "isotropic", densityKgM3: 7_850,
      youngsModulusPa: 70e9, poissonRatio: .3, failureStressPa: 250e6,
    }],
    studies: [{
      id: "structural", kind: "structural-linear", bodyIds: ["body"], materialId: "steel",
      supports: ["fixed"], loads: [{ selectionId: "loaded", forceN: [...definition.forceN] }],
    }, ...topology],
  });
}

export async function buildExactBrowserBenchmark(
  definition: BrowserBenchmarkDefinition,
  signal: AbortSignal,
): Promise<ExactBrowserBenchmark> {
  const adapter = createOcctCadAdapter();
  const geometry = await baseDocument(definition);
  const discovery = await evaluateExact(adapter, geometry, `${definition.id}-discover`, signal);
  const document = await engineeringDocument(geometry, discovery.mesh.payload, definition);
  const voxel = await produceStructuralVoxelMesh({
    document, bodyIds: ["body"], cellSizeM: definition.cellSizeM,
    rasterizationToleranceM: 1e-6, signal,
  });
  const exact = {
    brep: { artifact: voxel.exact.brepArtifact, payload: voxel.exact.brepPayload },
    mesh: { artifact: voxel.exact.semanticArtifact, payload: voxel.exact.semanticMeshPayload },
  };
  const structuralRequest = await defineEngineeringSolveRequest<StructuralSolveInput>({
    jobId: `${definition.id}-structural`, kind: "fea", sourceRevision: document.revision,
    inputArtifacts: [exact.brep.artifact, exact.mesh.artifact, voxel.record], settings: {},
    studyId: "structural", document,
    input: {
      semanticMeshArtifactId: exact.mesh.artifact.id, semanticMeshPayload: exact.mesh.payload,
      voxelArtifactId: voxel.record.id, voxelPayload: voxel.payload,
    },
  });
  const topologyRequest = definition.topologyTarget === undefined ? undefined
    : await defineEngineeringSolveRequest<TopologySolveInput>({
      jobId: `${definition.id}-topology`, kind: "topology", sourceRevision: document.revision,
      inputArtifacts: structuralRequest.inputArtifacts, settings: {}, studyId: "topology", document,
      input: {
        sourceStructuralRequest: structuralRequest,
        initialDensity: Float32Array.from(voxel.payload.activeCells),
      },
    });
  return {
    definition, structuralRequest, topologyRequest,
    exactBrepArtifact: exact.brep.artifact, semanticMeshArtifact: exact.mesh.artifact,
  };
}
