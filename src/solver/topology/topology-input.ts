import type { EngineeringSolveRequest } from "../../engineering/solver-adapter";
import { resolveNamedSelections } from "../../cad/kernel/named-selection-resolution";
import type { StructuralSolveInput, StructuralVoxelPayload } from "../structural/structural-contract";
import type { RequiredTopologyInterface, TopologySolveInput } from "./topology-contract";
import {
  topologyMinimumFeatureCellWidth, topologyMinimumFeatureOffenders,
} from "./minimum-feature";

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
  const resolved = resolveNamedSelections(request.document, request.input.semanticMeshPayload.faces)
    .find((candidate) => candidate.selectionId === selectionId);
  if (!resolved) throw new Error(`Topology named selection cannot be resolved: ${selectionId}`);
  const topology = ids.indexOf(resolved.topologyId);
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

function manufacturingRequiredCells(
  source: EngineeringSolveRequest<StructuralSolveInput>,
  required: ReadonlySet<number>,
  minimumFeatureM: number,
): ReadonlySet<number> {
  const { dimensions, cellSizeM, activeCells } = source.input.voxelPayload;
  const [width, height, depth] = dimensions;
  const count = width! * height! * depth!, cellSize = cellSizeM[0]!;
  if (dimensions.length !== 3 || cellSizeM.length !== 3 || activeCells.length !== count
    || !Number.isFinite(cellSize) || cellSize <= 0
    || activeCells.some((value) => value !== 0 && value !== 1)) {
    throw new Error("Topology source grid cannot compile manufacturing-aware passive material");
  }
  const minimumCells = topologyMinimumFeatureCellWidth(minimumFeatureM, cellSize);
  const layers = Math.max(0, minimumCells - 1), plane = width! * height!;
  const index = (x: number, y: number, z: number) => x + width! * (y + height! * z);
  const padded = new Set<number>();
  for (const cell of required) {
    if (cell < 0 || cell >= activeCells.length || activeCells[cell] !== 1) {
      throw new Error("Topology required interface lies outside the active design domain");
    }
    const z = Math.floor(cell / plane), rest = cell - z * plane;
    const y = Math.floor(rest / width!), x = rest - y * width!;
    for (let dz = -layers; dz <= layers; dz += 1) {
      for (let dy = -layers; dy <= layers; dy += 1) {
        for (let dx = -layers; dx <= layers; dx += 1) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          if (nx < 0 || ny < 0 || nz < 0 || nx >= width! || ny >= height! || nz >= depth!) continue;
          const neighbor = index(nx, ny, nz);
          if (activeCells[neighbor] === 1) padded.add(neighbor);
        }
      }
    }
  }
  const mask = Uint8Array.from(activeCells, (_value, cell) => Number(padded.has(cell)));
  if (topologyMinimumFeatureOffenders(
    mask, [width!, height!, depth!], minimumFeatureM, cellSize,
  ).length > 0) {
    throw new Error("Topology active domain cannot satisfy the required-interface minimum feature");
  }
  return padded;
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
  const interfaceIds = [...structural.supports, ...structural.loads.map(({ selectionId }) => selectionId),
    ...(study.requiredSelectionIds ?? [])];
  const requiredInterfaces = interfaceIds.map((id) => ({ id, cellIndices: selectionCells(source, id) }));
  const interfaceCells = new Set(requiredInterfaces.flatMap(({ cellIndices }) => [...cellIndices]));
  const requiredCells = manufacturingRequiredCells(source, interfaceCells, study.minimumFeatureM);
  const protectedCells = new Set(study.protectedVoidSelectionIds.flatMap((id) => [...selectionCells(source, id)]));
  for (const cell of protectedCells) {
    if (requiredCells.has(cell)) throw new Error("Topology protected void intersects a required structural interface");
  }
  return { requiredInterfaces, requiredCells, protectedCells };
}

export function validateInitialDensity(
  input: TopologySolveInput,
  designDomain: Uint32Array,
  required: ReadonlySet<number>,
  protectedCells: ReadonlySet<number>,
): Float32Array {
  const density = input.initialDensity;
  if (!(density instanceof Float32Array) || density.length !== designDomain.length
    || designDomain.some((value) => value !== 0 && value !== 1)
    || density.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new Error("Topology initial density must be finite, bounded in [0,1], and match the source grid");
  }
  if (density.some((value, cell) => value !== 0 && designDomain[cell] === 0)) {
    throw new Error("Topology initial density contains material outside the canonical design domain");
  }
  if ([...required].some((cell) => density[cell] !== 1)) {
    throw new Error("Topology initial density must preserve every passive structural interface cell");
  }
  if ([...protectedCells].some((cell) => density[cell] !== 0)) {
    throw new Error("Topology initial density must preserve every protected void cell");
  }
  return new Float32Array(density);
}
