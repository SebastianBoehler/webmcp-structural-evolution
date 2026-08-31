import {
  ArtifactRecordSchema, defineArtifactRecord, type ArtifactRecord,
} from "../../cad/artifact-contract";
import { defineDesignDocument, type DesignDocument } from "../../cad/document-schema";
import { resolveNamedSelections } from "../../cad/kernel/named-selection-resolution";
import {
  digestCadOutputPayload, OpaqueBytesPayloadSchema, SemanticMeshPayloadSchema,
  type OpaqueBytesPayload, type SemanticMeshPayload,
} from "../../cad/rebuild-payload";
import { digestArtifactPayload } from "../../engineering/artifact-store";
import { revisionId } from "../../domain/revisions";
import {
  DEFAULT_STRUCTURAL_COMPILE_LIMITS, STRUCTURAL_VOXEL_MEDIA_TYPE,
  type StructuralVoxelPayload,
} from "./structural-contract";
import { isPositiveFiniteFloat32 } from "./structural-grid-validation";
import { classifyExactBrepCells } from "./exact-brep-classifier";
import { rasterizeStructuralBoundaries } from "./structural-boundary-raster";
import {
  rebuildStructuralExactSource, type StructuralExactSource,
} from "./structural-exact-source";
import {
  ownedTriangles, signedTriangleVolumeM3,
  validateClosedTriangleBodies, type OwnedTriangle, type Point3,
} from "./triangle-voxel-geometry";

export interface StructuralVoxelProducerInput {
  readonly document: DesignDocument;
  readonly bodyIds: readonly string[];
  readonly cellSizeM: number;
  readonly rasterizationToleranceM: number;
  readonly signal?: AbortSignal;
}

export interface ProducedStructuralVoxelMesh {
  readonly record: ArtifactRecord;
  readonly payload: StructuralVoxelPayload;
  readonly exact: StructuralExactSource;
}
type ExactInput = StructuralVoxelProducerInput & StructuralExactSource;

type Dims = readonly [number, number, number];
const encode = (value: unknown) => Uint8Array.from(new TextEncoder().encode(JSON.stringify(value)));
const cellIndex = (dims: Dims, x: number, y: number, z: number) => x + dims[0] * (y + dims[1] * z);

async function checkedInput(input: ExactInput): Promise<SemanticMeshPayload> {
  const document = await defineDesignDocument(input.document);
  if (document.revision !== input.document.revision) {
    throw new Error("Structural voxelization requires a canonical design-document revision");
  }
  const brepArtifact = await ArtifactRecordSchema.parseAsync(input.brepArtifact);
  const semanticArtifact = await ArtifactRecordSchema.parseAsync(input.semanticArtifact);
  if (brepArtifact.kind !== "brep"
    || brepArtifact.mediaType !== "application/vnd.opencascade.brep"
    || brepArtifact.sourceRevision !== document.revision
    || brepArtifact.units !== "m" || brepArtifact.producer.name !== "occt-wasm") {
    throw new Error("Structural voxelization requires a revision-bound exact BREP artifact");
  }
  if (semanticArtifact.kind !== "render-mesh"
    || semanticArtifact.mediaType !== "application/vnd.structural-evolution.semantic-mesh"
    || semanticArtifact.sourceRevision !== document.revision
    || semanticArtifact.units !== "m" || semanticArtifact.producer.name !== "occt-wasm") {
    throw new Error("Structural voxelization requires a revision-bound exact semantic-mesh artifact");
  }
  if (!isPositiveFiniteFloat32(input.cellSizeM)
    || !Number.isFinite(input.rasterizationToleranceM) || input.rasterizationToleranceM <= 0
    || input.rasterizationToleranceM > input.cellSizeM * .5) {
    throw new Error("Structural voxelization requires bounded finite SI grid settings");
  }
  if (input.bodyIds.length !== 1 || new Set(input.bodyIds).size !== input.bodyIds.length
    || input.bodyIds.some((id) => !document.bodies.some((body) => body.id === id))) {
    throw new Error("Structural voxelization body ownership is unresolved");
  }
  for (const artifact of [brepArtifact, semanticArtifact]) {
    const dependencies = new Set(artifact.dependencies.filter((item) => item.kind === "entity")
      .map((item) => item.reference));
    if (!dependencies.has(`document:${document.id}`)
      || input.bodyIds.some((id) => !dependencies.has(`body:${id}`))) {
      throw new Error("Exact CAD artifact provenance does not cover the document and requested body");
    }
  }
  return SemanticMeshPayloadSchema.parse(input.semanticMeshPayload);
}

function bounds(triangles: readonly OwnedTriangle[]): { origin: Point3; maximum: Point3 } {
  const origin = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
  for (const triangle of triangles) for (const point of [triangle.a, triangle.b, triangle.c]) {
    for (let axis = 0; axis < 3; axis += 1) {
      origin[axis] = Math.min(origin[axis]!, point[axis]!);
      maximum[axis] = Math.max(maximum[axis]!, point[axis]!);
    }
  }
  if (![...origin, ...maximum].every(Number.isFinite)) throw new Error("Exact semantic mesh bounds are invalid");
  return {
    origin: [origin[0]!, origin[1]!, origin[2]!],
    maximum: [maximum[0]!, maximum[1]!, maximum[2]!],
  };
}

function dimensions(
  origin: Point3, maximum: Point3, cellSizeM: number, rasterizationToleranceM: number,
): Dims {
  const result = maximum.map((value, axis) => {
    const extent = value - origin[axis]!;
    const scale = Math.max(1, Math.abs(value), Math.abs(origin[axis]!));
    const toleranceM = Math.max(rasterizationToleranceM, Number.EPSILON * scale * 16);
    const rounded = Math.round(extent / cellSizeM);
    const count = Math.abs(extent - rounded * cellSizeM) <= toleranceM
      ? rounded : Math.ceil(extent / cellSizeM);
    if (!Number.isSafeInteger(count) || count < 1) throw new Error("Exact semantic mesh has an invalid voxel extent");
    return count;
  }) as [number, number, number];
  const cells = result[0] * result[1] * result[2];
  if (!Number.isSafeInteger(cells) || cells > DEFAULT_STRUCTURAL_COMPILE_LIMITS.maxCells) {
    throw new Error(`Structural voxel cell limit exceeded: ${cells} > ${DEFAULT_STRUCTURAL_COMPILE_LIMITS.maxCells}`);
  }
  const nodes = (result[0] + 1) * (result[1] + 1) * (result[2] + 1);
  if (!Number.isSafeInteger(nodes) || nodes * 3 > DEFAULT_STRUCTURAL_COMPILE_LIMITS.maxDofs) {
    throw new Error("Structural voxel DOF limit exceeded before exact classification");
  }
  return result;
}

function pointAt(origin: Point3, cellSizeM: number, x: number, y: number, z: number): Point3 {
  return [origin[0] + x * cellSizeM, origin[1] + y * cellSizeM, origin[2] + z * cellSizeM];
}

async function occupancy(
  input: ExactInput, dims: Dims, origin: Point3,
): Promise<{
  readonly activeCells: Uint32Array; readonly boundsM: Float64Array; readonly volumeM3: number;
}> {
  const centers: Point3[] = [];
  for (let z = 0; z < dims[2]; z += 1) for (let y = 0; y < dims[1]; y += 1) {
    for (let x = 0; x < dims[0]; x += 1) {
      centers.push(pointAt(origin, input.cellSizeM, x + .5, y + .5, z + .5));
    }
  }
  const classified = await classifyExactBrepCells(
    input.brepPayload.bytes, centers, input.rasterizationToleranceM, input.signal,
  );
  const active = new Uint32Array(classified.activeCells);
  if (active.length !== centers.length || active.some((value) => value !== 0 && value !== 1)) {
    throw new Error("Exact BREP voxel classifier returned an invalid occupancy mask");
  }
  if (!active.some(Boolean)) throw new Error("Exact semantic mesh voxelization produced no occupied cells");
  return { activeCells: active, boundsM: classified.boundsM, volumeM3: classified.volumeM3 };
}

function validateExactMeshCorrespondence(
  origin: Point3, maximum: Point3, exactBoundsM: Float64Array, exactVolumeM3: number,
  triangles: readonly OwnedTriangle[], toleranceM: number,
): void {
  if (exactBoundsM.length !== 6 || exactBoundsM.some((value) => !Number.isFinite(value))) {
    throw new Error("Exact BREP classifier returned invalid solid bounds");
  }
  const semantic = [...origin, ...maximum];
  const scale = Math.max(1, ...semantic.map(Math.abs), ...exactBoundsM.map(Math.abs));
  const correspondenceTolerance = Math.max(toleranceM, Number.EPSILON * scale * 64);
  if (semantic.some((value, index) => Math.abs(value - exactBoundsM[index]!) > correspondenceTolerance)) {
    throw new Error("Exact BREP and semantic mesh bounds do not correspond");
  }
  const semanticVolumeM3 = signedTriangleVolumeM3(triangles);
  const volumeToleranceM3 = Math.max(toleranceM ** 3, exactVolumeM3 * 1e-3);
  if (!(semanticVolumeM3 > 0)
    || Math.abs(semanticVolumeM3 - exactVolumeM3) > volumeToleranceM3) {
    throw new Error("Exact BREP and semantic mesh solid volumes do not correspond");
  }
}

function requiredSelectionIds(document: DesignDocument, bodyIds: ReadonlySet<string>): Set<string> {
  const required = new Set<string>();
  for (const study of document.studies) {
    if (study.kind !== "structural-linear" || !study.bodyIds.some((id) => bodyIds.has(id))) continue;
    for (const id of study.supports) required.add(id);
    for (const load of study.loads) required.add(load.selectionId);
  }
  return required;
}

const offsets = (groups: readonly number[][]) => {
  const values = [0];
  for (const group of groups) values.push(values.at(-1)! + group.length);
  return Uint32Array.from(values);
};

async function produceFromExact(
  input: ExactInput,
): Promise<ProducedStructuralVoxelMesh> {
  const mesh = await checkedInput(input);
  const brep = OpaqueBytesPayloadSchema.parse(input.brepPayload);
  if (await digestCadOutputPayload(brep) !== input.brepArtifact.contentDigest) {
    throw new Error("Exact BREP payload does not match its content digest");
  }
  if (await digestCadOutputPayload(mesh) !== input.semanticArtifact.contentDigest) {
    throw new Error("Exact semantic mesh payload does not match its content digest");
  }
  const bodySet = new Set(input.bodyIds), triangles = ownedTriangles(mesh, bodySet);
  validateClosedTriangleBodies(triangles, input.bodyIds, input.rasterizationToleranceM);
  const { origin, maximum } = bounds(triangles);
  const dims = dimensions(
    origin, maximum, input.cellSizeM, input.rasterizationToleranceM,
  );
  const classified = await occupancy(input, dims, origin);
  validateExactMeshCorrespondence(
    origin, maximum, classified.boundsM, classified.volumeM3, triangles,
    input.rasterizationToleranceM,
  );
  const activeCells = classified.activeCells;
  const required = requiredSelectionIds(input.document, bodySet);
  const selectionDocument = {
    ...input.document,
    namedSelections: input.document.namedSelections.filter(({ id, reference }) =>
      required.has(id) && bodySet.has(reference.bodyId) && reference.expectedKind === "face"),
  };
  if (selectionDocument.namedSelections.length !== required.size) {
    throw new Error("A structural study selection is missing unique exact face ownership");
  }
  const topologyIds = resolveNamedSelections(selectionDocument, mesh.faces).map(({ topologyId }) => topologyId);
  if (new Set(topologyIds).size !== topologyIds.length) {
    throw new Error("Structural study selections resolve to duplicate exact face ownership");
  }
  const operationBudget = activeCells.length * triangles.length * 6;
  if (!Number.isSafeInteger(operationBudget) || operationBudget > 10_000_000) {
    throw new Error("Structural semantic correspondence operation budget exceeded");
  }
  const groups = await rasterizeStructuralBoundaries({
    topologyIds, triangles, activeCells, dimensions: dims, originM: origin,
    cellSizeM: input.cellSizeM, toleranceM: input.rasterizationToleranceM,
  }, input.signal);
  const payload: StructuralVoxelPayload = {
    dimensions: Uint32Array.from(dims), originM: Float64Array.from(origin),
    cellSizeM: new Float64Array(3).fill(input.cellSizeM), activeCells,
    selectionTopologyIdsUtf8: encode(topologyIds),
    selectionCellOffsets: offsets(groups.cells),
    selectionCellIndices: Uint32Array.from(groups.cells.flat()),
    selectionNodeOffsets: offsets(groups.nodes),
    selectionNodeIndices: Uint32Array.from(groups.nodes.flat()),
    rasterizationToleranceM: Float64Array.of(input.rasterizationToleranceM),
  };
  const record = await defineArtifactRecord({
    kind: "solver-mesh", sourceRevision: input.document.revision,
    producer: { name: "occt-exact-brep-voxelizer", version: "1.0.0" },
    settingsDigest: await revisionId({
      brepArtifactId: input.brepArtifact.id,
      semanticMeshArtifactId: input.semanticArtifact.id,
      bodyIds: [...input.bodyIds].sort(), cellSizeM: input.cellSizeM,
      rasterizationToleranceM: input.rasterizationToleranceM,
    }),
    contentDigest: await digestArtifactPayload(payload), units: "m",
    mediaType: STRUCTURAL_VOXEL_MEDIA_TYPE,
    dependencies: [
      ...input.bodyIds.map((id) => ({ kind: "entity" as const, reference: `body:${id}` as const })),
      { kind: "artifact", artifactId: input.brepArtifact.id },
      { kind: "artifact", artifactId: input.semanticArtifact.id },
    ],
  });
  return { record, payload, exact: {
    brepArtifact: input.brepArtifact, brepPayload: input.brepPayload,
    semanticArtifact: input.semanticArtifact, semanticMeshPayload: input.semanticMeshPayload,
  } };
}

export async function produceStructuralVoxelMesh(
  input: StructuralVoxelProducerInput,
): Promise<ProducedStructuralVoxelMesh> {
  const signal = input.signal ?? new AbortController().signal;
  const exact = await rebuildStructuralExactSource(input.document, signal);
  return produceFromExact({ ...input, ...exact });
}
