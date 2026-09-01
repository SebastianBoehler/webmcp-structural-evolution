import { resolveNamedSelections } from "../../cad/kernel/named-selection-resolution";
import type { EngineeringSolveRequest } from "../../engineering/solver-adapter";
import {
  type ThermalCompileLimits,
  type ThermalDirichletCell,
  type ThermalInput,
  type ThermalNeumannFace,
  type ThermalRasterizedSelection,
  type ThermalSolveInput,
  type ThermalVoxelPayload,
} from "./thermal-contract";
import { validateThermalGeometry } from "./thermal-geometry-binding";

type ThermalStudy = Extract<EngineeringSolveRequest<ThermalSolveInput>["document"]["studies"][number], { kind: "thermal-steady" }>;
type Face = Readonly<{ cellIndex: number; axis: 0 | 1 | 2; direction: -1 | 1; areaM2: number }>;

function study(request: EngineeringSolveRequest<ThermalSolveInput>): ThermalStudy {
  const value = request.document.studies.find(({ id }) => id === request.studyId);
  if (!value || value.kind !== "thermal-steady") throw new Error(`Thermal study is unresolved or has the wrong kind: ${request.studyId}`);
  return value;
}

function grid(payload: ThermalVoxelPayload, limits: ThermalCompileLimits) {
  if (payload.dimensions.length !== 3 || payload.dimensions.some((value) => value < 1)) throw new Error("Thermal voxel dimensions must contain three positive integers");
  const dimensions = [payload.dimensions[0]!, payload.dimensions[1]!, payload.dimensions[2]!] as const;
  const count = dimensions[0] * dimensions[1] * dimensions[2];
  if (!Number.isSafeInteger(count) || count > limits.maxCells) throw new Error(`Thermal grid cell limit exceeded: ${count} > ${limits.maxCells}`);
  if (payload.cellSizeM.length !== 3 || payload.cellSizeM.some((value) => !Number.isFinite(value) || value <= 0)
    || payload.cellSizeM.some((value) => Math.abs(value - payload.cellSizeM[0]!) > payload.cellSizeM[0]! * 1e-12)) throw new Error("Thermal adapter supports only finite uniform cubic cells");
  const faceAreaM2 = payload.cellSizeM[0]! * payload.cellSizeM[0]!;
  if (!Number.isFinite(faceAreaM2) || faceAreaM2 <= 0) throw new Error("Thermal voxel face area must be positive finite");
  if (payload.originM.length !== 3 || payload.originM.some((value) => !Number.isFinite(value))) throw new Error("Thermal voxel origin must contain three finite SI coordinates");
  if (payload.activeCells.length !== count || payload.activeCells.some((value) => value !== 0 && value !== 1)) throw new Error("Thermal active-cell mask must contain one binary value per grid cell");
  const active = new Uint32Array(payload.activeCells);
  if (!active.some(Boolean)) throw new Error("Thermal voxel domain contains no active cells");
  const toleranceM = payload.rasterizationToleranceM[0];
  if (payload.rasterizationToleranceM.length !== 1 || !Number.isFinite(toleranceM) || toleranceM! <= 0 || toleranceM! > payload.cellSizeM[0]! * .5) throw new Error("Thermal rasterization tolerance must be finite, positive, and at most half a cell");
  return { dimensions, count, active, cellSizeM: payload.cellSizeM[0]!, faceAreaM2, originM: [payload.originM[0]!, payload.originM[1]!, payload.originM[2]!] as const, toleranceM: toleranceM! };
}

function topologyIds(payload: ThermalVoxelPayload): readonly string[] {
  try {
    const ids: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload.selectionTopologyIdsUtf8));
    if (!Array.isArray(ids) || ids.some((value) => typeof value !== "string" || value.length === 0) || new Set(ids).size !== ids.length) throw new Error();
    return ids as string[];
  } catch { throw new Error("Thermal selection topology table must contain unique topology IDs"); }
}

function boundaryFaces(payload: ThermalVoxelPayload, topologyIndex: number, topologyCount: number, active: Uint32Array, dimensions: readonly [number, number, number], faceAreaM2: number, remainingBudget: number, seen: Set<string>): readonly Face[] {
  if (payload.selectionFaceOffsets.length !== topologyCount + 1 || payload.selectionFaceOffsets[0] !== 0 || payload.selectionFaceOffsets[topologyCount] !== payload.selectionFaceCells.length) throw new Error("Thermal selection face offsets are inconsistent");
  const values = [payload.selectionFaceAxes, payload.selectionFaceDirections, payload.selectionFaceAreasM2];
  if (values.some(({ length }) => length !== payload.selectionFaceCells.length)) throw new Error("Thermal selection face buffers are inconsistent");
  const start = payload.selectionFaceOffsets[topologyIndex]!, end = payload.selectionFaceOffsets[topologyIndex + 1]!;
  if (end < start) throw new Error("Thermal selection face offsets are not monotonic");
  if (end - start > remainingBudget) throw new Error("Thermal boundary face limit exceeded");
  const result: Face[] = [];
  for (let index = start; index < end; index += 1) {
    const cellIndex = payload.selectionFaceCells[index]!, axis = payload.selectionFaceAxes[index]!, direction = payload.selectionFaceDirections[index]!, areaM2 = payload.selectionFaceAreasM2[index]!;
    const key = `${cellIndex}:${axis}:${direction}`;
    const coordinate = axis === 0 ? cellIndex % dimensions[0] : axis === 1 ? Math.floor(cellIndex / dimensions[0]) % dimensions[1] : Math.floor(cellIndex / (dimensions[0] * dimensions[1]));
    const neighbor = coordinate + direction;
    const areaEpsilonM2 = Number.EPSILON * faceAreaM2 * 32 || Number.MIN_VALUE;
    if (cellIndex >= active.length || active[cellIndex] !== 1 || axis > 2 || (direction !== -1 && direction !== 1) || !Number.isFinite(areaM2) || areaM2 <= 0 || seen.has(key) || areaM2 > faceAreaM2 + areaEpsilonM2 || (neighbor >= 0 && neighbor < dimensions[axis]! && active[cellIndex + direction * (axis === 0 ? 1 : axis === 1 ? dimensions[0] : dimensions[0] * dimensions[1])])) throw new Error("Thermal boundary raster contains an unavailable, duplicate, internal, or incoherent face");
    seen.add(key);
    result.push({ cellIndex, axis: axis as 0 | 1 | 2, direction: direction as -1 | 1, areaM2 });
  }
  return result;
}

function components(active: Uint32Array, dimensions: readonly [number, number, number]): Int32Array {
  const labels = new Int32Array(active.length).fill(-1), [width, height] = dimensions, plane = width * height;
  let component = 0;
  for (let seed = 0; seed < active.length; seed += 1) {
    if (!active[seed] || labels[seed] !== -1) continue;
    const queue = [seed]; labels[seed] = component;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const cell = queue[cursor]!, z = Math.floor(cell / plane), rem = cell - z * plane, y = Math.floor(rem / width), x = rem - y * width;
      for (const neighbor of [x && cell - 1, x + 1 < width && cell + 1, y && cell - width, y + 1 < height && cell + width, z && cell - plane, z + 1 < dimensions[2] && cell + plane]) {
        if (typeof neighbor === "number" && active[neighbor] && labels[neighbor] === -1) { labels[neighbor] = component; queue.push(neighbor); }
      }
    }
    component += 1;
  }
  return labels;
}

export async function compileThermalStudy(request: EngineeringSolveRequest<ThermalSolveInput>, limits: ThermalCompileLimits): Promise<ThermalInput> {
  if (!Number.isSafeInteger(limits.maxCells) || !Number.isSafeInteger(limits.maxBoundaryFaces) || limits.maxCells < 1 || limits.maxBoundaryFaces < 1) throw new Error("Thermal capability limits must be positive safe integers");
  if (!Number.isFinite(limits.maxRelativeAreaError) || limits.maxRelativeAreaError < 0) throw new Error("Thermal rasterization area-error capability must be finite and nonnegative");
  const thermal = study(request);
  await validateThermalGeometry(request, thermal.bodyIds);
  const domain = grid(request.input.voxelPayload, limits);
  const material = request.document.materials.find(({ id }) => id === thermal.materialId);
  if (!material || !Number.isFinite(material.thermalConductivityWmK) || material.thermalConductivityWmK! <= 0) throw new Error("Thermal material conductivity must be positive and finite");
  if (!Number.isFinite(Math.fround(material.thermalConductivityWmK!)) || Math.fround(material.thermalConductivityWmK!) <= 0) throw new Error("Thermal material conductivity must be positive finite f32");
  const boundaries = thermal.boundaries ?? { temperatures: [], heatFluxes: [] };
  if (boundaries.temperatures.length === 0) throw new Error("Steady thermal study requires at least one temperature boundary");
  const requested = [...boundaries.temperatures, ...boundaries.heatFluxes];
  for (const boundary of requested) {
    const selection = request.document.namedSelections.find(({ id }) => id === boundary.selectionId);
    if (!selection) throw new Error(`Thermal boundary selection is unresolved: ${boundary.selectionId}`);
    if (selection.reference.expectedKind !== "face") throw new Error(`Thermal boundary selection must resolve to an exact face: ${boundary.selectionId}`);
    if (!thermal.bodyIds.includes(selection.reference.bodyId)) throw new Error(`Thermal boundary selection is incompatible with study bodies: ${boundary.selectionId}`);
  }
  const resolved = new Map(resolveNamedSelections(request.document, request.input.semanticMeshPayload.faces).map((item) => [item.selectionId, item.topologyId]));
  const topology = topologyIds(request.input.voxelPayload), topologyIndex = new Map(topology.map((id, index) => [id, index]));
  const rasterization: ThermalRasterizedSelection[] = [], dirichlet = new Map<number, number>(), neumann: ThermalNeumannFace[] = [], seen = new Set<string>(), temperaturesByTopology = new Map<string, number>();
  let boundaryFaceCount = 0;
  for (const boundary of requested) {
    const topologyId = resolved.get(boundary.selectionId);
    if (!topologyId) throw new Error(`Thermal boundary selection is unresolved: ${boundary.selectionId}`);
    const faceIndex = request.input.semanticMeshPayload.faces.findIndex(({ id }) => id === topologyId);
    if (faceIndex < 0 || !request.input.semanticMeshPayload.triangleFaceIndices.includes(faceIndex)) throw new Error(`Thermal selected face has no exact semantic triangle ownership: ${topologyId}`);
    const index = topologyIndex.get(topologyId);
    if (index === undefined) throw new Error(`Thermal selection topology is absent: ${topologyId}`);
    if ("temperatureK" in boundary) {
      const previous = temperaturesByTopology.get(topologyId);
      if (previous !== undefined && previous !== boundary.temperatureK) {
        throw new Error(`Thermal fixed-temperature boundaries conflict at cell ${request.input.voxelPayload.selectionFaceCells[request.input.voxelPayload.selectionFaceOffsets[index]!]}`);
      }
      temperaturesByTopology.set(topologyId, boundary.temperatureK);
    }
    const faces = boundaryFaces(request.input.voxelPayload, index, topology.length, domain.active, domain.dimensions, domain.faceAreaM2, limits.maxBoundaryFaces - boundaryFaceCount, seen);
    boundaryFaceCount += faces.length;
    if (boundaryFaceCount > limits.maxBoundaryFaces) throw new Error("Thermal boundary face limit exceeded");
    if (faces.length === 0) throw new Error(`Thermal boundary ${boundary.selectionId} rasterized to zero faces`);
    const selectedAreaM2 = request.input.semanticMeshPayload.faces[faceIndex]!.signature.measureSI;
    if (!Number.isFinite(selectedAreaM2) || selectedAreaM2 <= 0) throw new Error("Thermal selected exact face area is invalid");
    const representedAreaM2 = faces.reduce((sum, face) => sum + face.areaM2, 0), relativeAreaError = Math.abs(representedAreaM2 - selectedAreaM2) / selectedAreaM2;
    if (relativeAreaError > limits.maxRelativeAreaError) throw new Error(`Thermal boundary ${boundary.selectionId} exceeds rasterization area tolerance`);
    rasterization.push({ selectionId: boundary.selectionId, topologyId, faceCount: faces.length, selectedAreaM2, representedAreaM2, relativeAreaError });
    if ("temperatureK" in boundary) for (const face of faces) {
      const previous = dirichlet.get(face.cellIndex);
      if (previous !== undefined && previous !== boundary.temperatureK) throw new Error(`Thermal fixed-temperature boundaries conflict at cell ${face.cellIndex}`);
      dirichlet.set(face.cellIndex, boundary.temperatureK);
    } else for (const face of faces) neumann.push({ ...face, heatFluxWm2: boundary.heatFluxWm2 });
  }
  const labels = components(domain.active, domain.dimensions), anchored = new Set([...dirichlet.keys()].map((cell) => labels[cell]!));
  for (let cell = 0; cell < labels.length; cell += 1) if (labels[cell]! >= 0 && !anchored.has(labels[cell]!)) throw new Error(`Thermal active material island ${labels[cell]} has no temperature boundary`);
  return { sourceRevision: request.sourceRevision, studyId: thermal.id, bodyIds: [...thermal.bodyIds], consumedArtifactIds: [request.input.exactBrepArtifactId, request.input.semanticMeshArtifactId, request.input.thermalVoxelArtifactId], grid: { cellDimensions: domain.dimensions, originM: domain.originM, cellSizeM: domain.cellSizeM }, activeCells: domain.active, activeCellCount: domain.active.filter(Boolean).length, conductivityWmK: Float32Array.from(domain.active, (value) => value ? material.thermalConductivityWmK! : 0), dirichletCells: [...dirichlet].map(([cellIndex, temperatureK]) => ({ cellIndex, temperatureK })), neumannFaces: neumann, rasterization: { toleranceM: domain.toleranceM, selections: rasterization }, capability: limits };
}
