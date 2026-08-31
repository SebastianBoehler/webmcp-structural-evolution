import { digestArtifactPayload } from "../../engineering/artifact-store";
import type { StructuralRasterizedSelection, StructuralVoxelPayload } from "./structural-contract";

export interface SelectionGroup extends StructuralRasterizedSelection {
  readonly cellIndices: Uint32Array;
  readonly nodeIndices: Uint32Array;
}

function decodedTopologyIds(payload: StructuralVoxelPayload): readonly string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload.selectionTopologyIdsUtf8));
  } catch {
    throw new Error("Structural selection topology table is not valid UTF-8 JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0
    || parsed.some((value) => typeof value !== "string" || value.length === 0)
    || new Set(parsed).size !== parsed.length) {
    throw new Error("Structural selection topology table must contain unique topology IDs");
  }
  return parsed as string[];
}

function sliceGroup(
  values: Uint32Array,
  offsets: Uint32Array,
  index: number,
  topologyCount: number,
  label: string,
): Uint32Array {
  if (offsets.length !== topologyCount + 1 || offsets[0] !== 0
    || offsets[offsets.length - 1] !== values.length) {
    throw new Error(`Structural selection ${label} offsets are inconsistent`);
  }
  const start = offsets[index]!;
  const end = offsets[index + 1]!;
  if (end < start) throw new Error(`Structural selection ${label} offsets are not monotonic`);
  const result = values.slice(start, end);
  for (let cursor = 0; cursor < result.length; cursor += 1) {
    if (cursor > 0 && result[cursor - 1]! >= result[cursor]!) {
      throw new Error(`Structural selection ${label} indices must be sorted and unique`);
    }
  }
  return result;
}

export async function selectionGroups(
  payload: StructuralVoxelPayload,
  selected: readonly Readonly<{ selectionId: string; topologyId: string }>[],
  cellCount: number,
  nodeCount: number,
  active: Uint32Array,
  cellDimensions: readonly [number, number, number],
): Promise<readonly SelectionGroup[]> {
  const topologyIds = decodedTopologyIds(payload);
  const topologyIndex = new Map(topologyIds.map((id, index) => [id, index]));
  const groups: SelectionGroup[] = [];
  for (const selection of selected) {
    const index = topologyIndex.get(selection.topologyId);
    if (index === undefined) throw new Error(`Structural selection topology is absent: ${selection.topologyId}`);
    const cellIndices = sliceGroup(
      payload.selectionCellIndices, payload.selectionCellOffsets, index, topologyIds.length, "cell",
    );
    const nodeIndices = sliceGroup(
      payload.selectionNodeIndices, payload.selectionNodeOffsets, index, topologyIds.length, "node",
    );
    if (cellIndices.length === 0) throw new Error(`${selection.selectionId} rasterized to zero cells`);
    if (nodeIndices.length === 0) throw new Error(`${selection.selectionId} rasterized to zero nodes`);
    if (cellIndices.some((value) => value >= cellCount || active[value] !== 1)) {
      throw new Error(`${selection.selectionId} references an inactive or unavailable cell`);
    }
    if (nodeIndices.some((value) => value >= nodeCount)) {
      throw new Error(`${selection.selectionId} references an unavailable node`);
    }
    const ownedNodes = new Set<number>();
    const [width, height] = cellDimensions;
    const nodeWidth = width + 1;
    const nodePlane = nodeWidth * (height + 1);
    for (const cell of cellIndices) {
      const z = Math.floor(cell / (width * height));
      const rest = cell - z * width * height;
      const y = Math.floor(rest / width);
      const x = rest - y * width;
      const base = x + y * nodeWidth + z * nodePlane;
      for (const dz of [0, 1]) for (const dy of [0, 1]) for (const dx of [0, 1]) {
        ownedNodes.add(base + dx + dy * nodeWidth + dz * nodePlane);
      }
    }
    if (nodeIndices.some((value) => !ownedNodes.has(value))) {
      throw new Error(`${selection.selectionId} contains a node outside its rasterized cells`);
    }
    groups.push({
      ...selection, cellIndices, nodeIndices,
      cellCount: cellIndices.length, nodeCount: nodeIndices.length,
      cellHash: await digestArtifactPayload({ indices: cellIndices }),
      nodeHash: await digestArtifactPayload({ indices: nodeIndices }),
    });
  }
  return groups;
}
