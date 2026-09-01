import type { ArtifactRecord } from "../cad/artifact-contract";
import type { DesignDocument } from "../cad/document-schema";
import type { EngineeringSolveRequest } from "../engineering/solver-adapter";
import { digestArtifactPayload } from "../engineering/artifact-store";
import { digestCadOutputPayload, SemanticMeshPayloadSchema } from "../cad/rebuild-payload";
import { resolveNamedSelections } from "../cad/kernel/named-selection-resolution";
import { MechanismAdapterInputSchema } from "../simulation/mechanism-adapter";
import { defineMechanismInput } from "../simulation/mechanism-contract";
import type { StructuralSolveInput } from "../solver/structural/structural-contract";
import { validateStructuralGeometryBinding } from "../solver/structural/structural-geometry-binding";
import { validateVoxelPayloadShape } from "../solver/structural/structural-payload-validation";
import {
  THERMAL_VOXEL_MEDIA_TYPE, THERMAL_VOXEL_PRODUCER, type ThermalSolveInput,
} from "../solver/thermal/thermal-contract";
import type { TopologySolveInput } from "../solver/topology/topology-contract";
import { configuredTopologyStudy } from "../solver/topology/topology-input";

type DocumentStudy = DesignDocument["studies"][number];

function documentReferences(document: DesignDocument): ReadonlySet<string> {
  const references = new Set<string>([`document:${document.id}`]);
  const collections = [
    ["parameter", document.parameters], ["frame", document.frames], ["sketch", document.sketches],
    ["feature", document.features], ["body", document.bodies], ["component", document.components],
    ["instance", document.instances], ["mate", document.mates], ["named-selection", document.namedSelections],
    ["material", document.materials], ["study", document.studies],
  ] as const;
  for (const [kind, values] of collections) {
    for (const value of values) references.add(`${kind}:${value.id}`);
  }
  return references;
}

function validateRecordGraph(
  request: EngineeringSolveRequest<unknown>, records: readonly ArtifactRecord[],
  activeIds: ReadonlySet<string>,
): void {
  const entities = documentReferences(request.document);
  const ids = new Set(records.map(({ id }) => id));
  for (const record of records) {
    if (record.sourceRevision !== request.sourceRevision && !activeIds.has(record.id)) {
      throw new Error(`Study input is not bound to the current source revision: ${record.id}`);
    }
    for (const dependency of record.dependencies) {
      if (dependency.kind === "entity" && !entities.has(dependency.reference)) {
        throw new Error(`Study input references an entity outside the current document: ${dependency.reference}`);
      }
      if (dependency.kind === "artifact" && !ids.has(dependency.artifactId)) {
        throw new Error(`Study input has a dangling artifact dependency: ${dependency.artifactId}`);
      }
    }
  }
}

function requiredGeometryReferences(document: DesignDocument, bodyIds: readonly string[]): readonly string[] {
  const bodies = new Set(bodyIds);
  const features = document.bodies.flatMap(({ id, featureId }) => bodies.has(id) ? [`feature:${featureId}`] : []);
  const components = document.components.flatMap(({ id, bodyIds: members }) =>
    members.some((id) => bodies.has(id)) ? [`component:${id}`] : []);
  return [`document:${document.id}`, ...bodyIds.map((id) => `body:${id}`), ...features, ...components];
}

function exactRoot(
  request: EngineeringSolveRequest<unknown>, active: ReadonlyMap<string, ArtifactRecord>,
  id: string, kind: "brep" | "render-mesh", mediaType: string, bodyIds: readonly string[],
): ArtifactRecord {
  const record = active.get(id);
  if (!record || record.kind !== kind
    || record.sourceRevision !== request.sourceRevision
    || record.mediaType !== mediaType || record.units !== "m"
    || !["occt-wasm", "workspace-exact-body-brep"].includes(record.producer.name)) {
    throw new Error(`Study requires an active current exact CAD ${kind} root`);
  }
  const entityDependencies = new Set(record.dependencies.flatMap((dependency) =>
    dependency.kind === "entity" ? [dependency.reference] : []));
  const missing = requiredGeometryReferences(request.document, bodyIds)
    .find((reference) => !entityDependencies.has(reference));
  if (missing) throw new Error(`Exact CAD root omits current model hierarchy: ${missing}`);
  if (record.producer.name === "workspace-exact-body-brep") {
    const roots = record.dependencies.flatMap((dependency) =>
      dependency.kind === "artifact" ? [dependency.artifactId] : []);
    if (roots.length !== 1) throw new Error("Exact body BREP must descend from one OCCT root");
    const root = exactRoot(request, active, roots[0]!, "brep",
      "application/vnd.opencascade.brep", request.document.bodies.map(({ id }) => id));
    if (root.producer.name !== "occt-wasm") throw new Error("Exact body BREP root is not authoritative OCCT");
  }
  return record;
}

async function validateMechanism(
  request: EngineeringSolveRequest<unknown>, active: ReadonlyMap<string, ArtifactRecord>,
): Promise<void> {
  const parsed = MechanismAdapterInputSchema.parse(request.input);
  if (request.inputArtifacts.length !== 3) {
    throw new Error("Mechanism study requires exact CAD and body-dynamics roots");
  }
  exactRoot(request, active, request.inputArtifacts.find(({ kind }) => kind === "brep")?.id ?? "",
    "brep", "application/vnd.opencascade.brep", request.document.bodies.map(({ id }) => id));
  exactRoot(request, active, request.inputArtifacts.find(({ kind }) => kind === "render-mesh")?.id ?? "",
    "render-mesh", "application/vnd.structural-evolution.semantic-mesh",
    request.document.bodies.map(({ id }) => id));
  const dynamics = request.inputArtifacts.find(({ kind }) => kind === "body-dynamics");
  const rootIds = new Set(request.inputArtifacts
    .filter(({ kind }) => kind === "brep" || kind === "render-mesh").map(({ id }) => id));
  const dynamicsRootIds = dynamics?.dependencies.flatMap((dependency) =>
    dependency.kind === "artifact" ? [dependency.artifactId] : []) ?? [];
  const dynamicsEntities = new Set(dynamics?.dependencies.flatMap((dependency) =>
    dependency.kind === "entity" ? [dependency.reference] : []) ?? []);
  if (!dynamics || dynamics.sourceRevision !== request.sourceRevision
    || dynamics.producer.name !== "workspace-exact-body-dynamics"
    || dynamics.mediaType !== "application/vnd.structural-evolution.body-dynamics-v1"
    || dynamicsRootIds.length !== 2 || dynamicsRootIds.some((id) => !rootIds.has(id))
    || !requiredGeometryReferences(request.document, request.document.bodies.map(({ id }) => id))
      .every((reference) => dynamicsEntities.has(reference))) {
    throw new Error("Mechanism body dynamics do not descend from the active exact CAD roots");
  }
  const mechanism = await defineMechanismInput(parsed.mechanismInput);
  if (mechanism.sourceRevision !== request.sourceRevision || mechanism.studyId !== request.studyId) {
    throw new Error("Mechanism compilation is not bound to the requested revision and study");
  }
  const sourceBodies = mechanism.bodies.flatMap(({ sourceBodyIds }) => sourceBodyIds);
  const expectedBodies = request.document.bodies.map(({ id }) => id).sort();
  if (sourceBodies.length !== expectedBodies.length
    || [...sourceBodies].sort().some((id, index) => id !== expectedBodies[index])) {
    throw new Error("Mechanism compilation does not cover the active component bodies exactly once");
  }
  const roots = new Set(request.inputArtifacts.map(({ id }) => id));
  if (mechanism.colliders.some(({ sourceBodyId, sourceArtifactIds }) =>
    !sourceBodies.includes(sourceBodyId) || sourceArtifactIds.length !== roots.size
    || sourceArtifactIds.some((id) => !roots.has(id)))) {
    throw new Error("Mechanism colliders do not descend from both active exact CAD roots");
  }
}

function typedThermalVoxel(input: ThermalSolveInput["voxelPayload"]): boolean {
  const fields: readonly [unknown, string][] = [
    [input.dimensions, "Uint32Array"], [input.originM, "Float64Array"], [input.cellSizeM, "Float64Array"],
    [input.activeCells, "Uint32Array"], [input.bodyIdsUtf8, "Uint8Array"],
    [input.cellBodyIndices, "Uint32Array"], [input.selectionTopologyIdsUtf8, "Uint8Array"],
    [input.selectionFaceOffsets, "Uint32Array"], [input.selectionFaceCells, "Uint32Array"],
    [input.selectionFaceAxes, "Uint8Array"], [input.selectionFaceDirections, "Int8Array"],
    [input.selectionFaceAreasM2, "Float64Array"], [input.rasterizationToleranceM, "Float64Array"],
  ];
  return fields.every(([value, tag]) => Object.prototype.toString.call(value) === `[object ${tag}]`);
}

async function validateThermal(
  request: EngineeringSolveRequest<ThermalSolveInput>,
  study: Extract<DocumentStudy, { kind: "thermal-steady" }>, active: ReadonlyMap<string, ArtifactRecord>,
): Promise<void> {
  const brep = exactRoot(request, active, request.input.exactBrepArtifactId, "brep",
    "application/vnd.opencascade.brep", study.bodyIds);
  const semantic = exactRoot(request, active, request.input.semanticMeshArtifactId, "render-mesh",
    "application/vnd.structural-evolution.semantic-mesh", study.bodyIds);
  const mesh = SemanticMeshPayloadSchema.parse(request.input.semanticMeshPayload);
  if (await digestCadOutputPayload(mesh) !== semantic.contentDigest) {
    throw new Error("Thermal semantic mesh payload does not match its exact CAD root");
  }
  const voxel = request.inputArtifacts.find(({ id }) => id === request.input.thermalVoxelArtifactId);
  const dependencies = new Set(voxel?.dependencies.flatMap((dependency) => dependency.kind === "artifact"
    ? [dependency.artifactId] : []) ?? []);
  const entities = new Set(voxel?.dependencies.flatMap((dependency) => dependency.kind === "entity"
    ? [dependency.reference] : []) ?? []);
  if (!voxel || voxel.sourceRevision !== request.sourceRevision || voxel.kind !== "sdf"
    || voxel.mediaType !== THERMAL_VOXEL_MEDIA_TYPE || voxel.units !== "m"
    || voxel.producer.name !== THERMAL_VOXEL_PRODUCER.name
    || voxel.producer.version !== THERMAL_VOXEL_PRODUCER.version
    || !requiredGeometryReferences(request.document, study.bodyIds).every((reference) => entities.has(reference))
    || !dependencies.has(brep.id) || !dependencies.has(semantic.id)
    || !typedThermalVoxel(request.input.voxelPayload)
    || await digestArtifactPayload(request.input.voxelPayload) !== voxel.contentDigest) {
    throw new Error("Thermal study requires a canonical current voxel derived from active exact CAD roots");
  }
}

async function validateStructural(
  request: EngineeringSolveRequest<StructuralSolveInput>,
  study: Extract<DocumentStudy, { kind: "structural-linear" }>, active: ReadonlyMap<string, ArtifactRecord>,
): Promise<void> {
  const semantic = request.inputArtifacts.find(({ id }) => id === request.input.semanticMeshArtifactId);
  if (!semantic || semantic.kind !== "render-mesh"
    || semantic.mediaType !== "application/vnd.structural-evolution.semantic-mesh"
    || await digestCadOutputPayload(request.input.semanticMeshPayload) !== semantic.contentDigest) {
    throw new Error("Structural study requires a canonical exact semantic-mesh payload");
  }
  const voxelInput = request.inputArtifacts.find(({ id }) => id === request.input.voxelArtifactId);
  validateVoxelPayloadShape(request.input.voxelPayload);
  if (!voxelInput || voxelInput.sourceRevision !== request.sourceRevision
    || voxelInput.kind !== "solver-mesh"
    || voxelInput.mediaType !== "application/vnd.structural-evolution.voxel-domain-v1"
    || await digestArtifactPayload(request.input.voxelPayload) !== voxelInput.contentDigest) {
    throw new Error("Structural study requires a canonical current exact-derived voxel payload");
  }
  const resolved = new Map(resolveNamedSelections(request.document, request.input.semanticMeshPayload.faces)
    .map(({ selectionId, topologyId }) => [selectionId, topologyId]));
  const topologyIds = [...study.supports, ...study.loads.map(({ selectionId }) => selectionId)].map((id) => {
    const topologyId = resolved.get(id);
    if (!topologyId) throw new Error(`Structural selection is unresolved: ${id}`);
    return topologyId;
  });
  validateStructuralGeometryBinding(request, study, topologyIds);
  exactRoot(request, active, request.input.semanticMeshArtifactId, "render-mesh",
    "application/vnd.structural-evolution.semantic-mesh", study.bodyIds);
  const voxel = request.inputArtifacts.find(({ id }) => id === request.input.voxelArtifactId);
  if (!voxel || voxel.producer.name !== "occt-exact-brep-voxelizer"
    || voxel.producer.version !== "1.0.0") throw new Error("Structural study requires the authoritative exact BREP voxelizer");
  const brepIds = voxel.dependencies.flatMap((dependency) => dependency.kind === "artifact"
    && request.inputArtifacts.find(({ id }) => id === dependency.artifactId)?.kind === "brep"
    ? [dependency.artifactId] : []);
  if (brepIds.length !== 1) throw new Error("Structural voxel lineage must contain one exact BREP root");
  exactRoot(request, active, brepIds[0]!, "brep", "application/vnd.opencascade.brep", study.bodyIds);
}

async function validateTopology(
  request: EngineeringSolveRequest<TopologySolveInput>, active: ReadonlyMap<string, ArtifactRecord>,
): Promise<void> {
  const study = configuredTopologyStudy(request);
  const sourceStudy = request.document.studies.find(({ id }) => id === study.sourceStudyId);
  if (!sourceStudy || sourceStudy.kind !== "structural-linear") throw new Error("Topology source study is unresolved");
  await validateStructural(request.input.sourceStructuralRequest, sourceStudy, active);
  const density = request.input.initialDensity;
  if (!(density instanceof Float32Array)
    || density.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error("Topology initial density is not canonical");
  }
}

export async function validateStudyInputAuthority(
  request: EngineeringSolveRequest<unknown>, study: DocumentStudy,
  activeArtifacts: readonly ArtifactRecord[],
): Promise<void> {
  const active = new Map(activeArtifacts.map((record) => [record.id, record]));
  validateRecordGraph(request, request.inputArtifacts, new Set(active.keys()));
  switch (study.kind) {
    case "structural-linear":
      await validateStructural(request as EngineeringSolveRequest<StructuralSolveInput>, study, active);
      return;
    case "thermal-steady": {
      const thermal = request as EngineeringSolveRequest<ThermalSolveInput>;
      await validateThermal(thermal, study, active);
      return;
    }
    case "topology":
      await validateTopology(request as EngineeringSolveRequest<TopologySolveInput>, active);
      return;
    case "mechanism":
      await validateMechanism(request, active);
  }
}
