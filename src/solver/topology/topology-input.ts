import type { EngineeringSolveRequest } from "../../engineering/solver-adapter";
import type { StructuralSolveInput, StructuralVoxelPayload } from "../structural/structural-contract";
import type { RequiredTopologyInterface, TopologySolveInput } from "./topology-contract";

type TopologyRequest = EngineeringSolveRequest<TopologySolveInput>;
type ConfiguredStudy = Extract<
  TopologyRequest["document"]["studies"][number],
  { kind: "topology"; configurationState: "configured" }
>;

function decodedTopologyIds(payload: StructuralVoxelPayload): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload.selectionTopologyIdsUtf8));
  } catch {
    throw new Error("Topology source selection table is not valid UTF-8 JSON");
  }
  if (!Array.isArray(parsed) || parsed.some((id) => typeof id !== "string")) {
    throw new Error("Topology source selection table is invalid");
  }
  return parsed as string[];
}

function selectionCells(
  request: EngineeringSolveRequest<StructuralSolveInput>,
  selectionId: string,
): Uint32Array {
  const selection = request.document.namedSelections.find(({ id }) => id === selectionId);
  if (!selection) throw new Error(`Topology named selection is unresolved: ${selectionId}`);
  const ids = decodedTopologyIds(request.input.voxelPayload);
  if (!selection.reference.stableId) {
    throw new Error(`Topology named selection lacks a stable solver topology ID: ${selectionId}`);
  }
  const topology = ids.indexOf(selection.reference.stableId);
  if (topology < 0) throw new Error(`Topology named selection has no solver raster: ${selectionId}`);
  const offsets = request.input.voxelPayload.selectionCellOffsets;
  if (offsets.length !== ids.length + 1) throw new Error("Topology selection cell offsets are inconsistent");
  return request.input.voxelPayload.selectionCellIndices.slice(offsets[topology]!, offsets[topology + 1]!);
}

export function configuredTopologyStudy(request: TopologyRequest): ConfiguredStudy {
  if (request.kind !== "topology") throw new Error("Topology adapter requires a topology job");
  if (!request.settings || typeof request.settings !== "object" || Array.isArray(request.settings)
    || Object.keys(request.settings).length !== 0) {
    throw new Error("Topology optimization settings must be revision-owned by the configured study");
  }
  const inputKeys = Object.keys(request.input).sort();
  if (inputKeys.length !== 2 || inputKeys[0] !== "initialDensity" || inputKeys[1] !== "sourceStructuralRequest") {
    throw new Error("Topology solve input may contain only the source structural request and initial density");
  }
  const study = request.document.studies.find(({ id }) => id === request.studyId);
  if (!study || study.kind !== "topology") throw new Error("Topology study is unresolved");
  if (study.configurationState !== "configured") {
    throw new Error("Topology study requires revision-owned optimization configuration");
  }
  const source = request.input.sourceStructuralRequest;
  if (source.kind !== "fea" || source.studyId !== study.sourceStudyId
    || source.sourceRevision !== request.sourceRevision
    || source.document.revision !== request.document.revision) {
    throw new Error("Topology source structural request does not match the configured study revision");
  }
  const outerArtifacts = new Set(request.inputArtifacts.map(({ id }) => id));
  if (source.inputArtifacts.some(({ id }) => !outerArtifacts.has(id))) {
    throw new Error("Topology source structural artifacts are not bound to the outer solve request");
  }
  return study;
}

export function topologyPassiveCells(
  request: TopologyRequest,
  study: ConfiguredStudy,
): Readonly<{
  requiredInterfaces: readonly RequiredTopologyInterface[];
  requiredCells: ReadonlySet<number>;
  protectedCells: ReadonlySet<number>;
}> {
  const source = request.input.sourceStructuralRequest;
  const structural = source.document.studies.find(({ id }) => id === study.sourceStudyId);
  if (!structural || structural.kind !== "structural-linear") throw new Error("Topology source study is not structural");
  const interfaceIds = [...structural.supports, ...structural.loads.map(({ selectionId }) => selectionId)];
  const requiredInterfaces = interfaceIds.map((id) => ({ id, cellIndices: selectionCells(source, id) }));
  const requiredCells = new Set(requiredInterfaces.flatMap(({ cellIndices }) => [...cellIndices]));
  const protectedCells = new Set(study.protectedVoidSelectionIds.flatMap((id) => [...selectionCells(source, id)]));
  for (const cell of protectedCells) {
    if (requiredCells.has(cell)) throw new Error("Topology protected void intersects a required structural interface");
  }
  return { requiredInterfaces, requiredCells, protectedCells };
}

export function validateInitialDensity(
  input: TopologySolveInput,
  cellCount: number,
  required: ReadonlySet<number>,
  protectedCells: ReadonlySet<number>,
): Float32Array {
  const density = input.initialDensity;
  if (!(density instanceof Float32Array) || density.length !== cellCount
    || density.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error("Topology initial density must be finite, bounded in [0,1], and match the source grid");
  }
  if ([...required].some((cell) => density[cell] !== 1)) {
    throw new Error("Topology initial density must preserve every passive structural interface cell");
  }
  if ([...protectedCells].some((cell) => density[cell] !== 0)) {
    throw new Error("Topology initial density must preserve every protected void cell");
  }
  return new Float32Array(density);
}
