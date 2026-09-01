import type {
  CompiledStructuralSystem,
  StructuralGrid,
  StructuralResult,
} from "../solver/structural/structural-contract";
import type { ResultLayerPayloads } from "./result-layers";

const MM_PER_M = 1_000;

function sameGrid(left: StructuralGrid, right: StructuralGrid): boolean {
  return left.cellSizeM === right.cellSizeM
    && left.cellDimensions.every((value, index) => value === right.cellDimensions[index])
    && left.nodeDimensions.every((value, index) => value === right.nodeDimensions[index])
    && left.originM.every((value, index) => value === right.originM[index]);
}

function nodesForCell(cell: number, grid: StructuralGrid): readonly number[] {
  const [width, height] = grid.cellDimensions;
  const [nodeWidth, nodeHeight] = grid.nodeDimensions;
  const x = cell % width;
  const y = Math.floor(cell / width) % height;
  const z = Math.floor(cell / (width * height));
  const lower = x + nodeWidth * (y + nodeHeight * z);
  const upper = lower + nodeWidth * nodeHeight;
  return [lower, lower + 1, lower + nodeWidth, lower + nodeWidth + 1,
    upper, upper + 1, upper + nodeWidth, upper + nodeWidth + 1];
}

export function structuralDisplacementLayer(
  result: StructuralResult,
  system: CompiledStructuralSystem,
): ResultLayerPayloads["displacement"] {
  if (!sameGrid(result.grid, system.grid)) {
    throw new Error("Structural result grid does not match its compiled system.");
  }
  const [width, height, depth] = result.grid.cellDimensions;
  const [nodeWidth, nodeHeight, nodeDepth] = result.grid.nodeDimensions;
  const cellCount = width * height * depth;
  const nodeDofs = nodeWidth * nodeHeight * nodeDepth * 3;
  if (system.activeCells.length !== cellCount || system.fixedDofs.length !== nodeDofs
    || result.displacementM.length !== nodeDofs) {
    throw new Error("Structural displacement length does not match the Hex8 grid.");
  }
  if (!result.displacementM.every(Number.isFinite)) {
    throw new Error("Structural displacement values must be finite.");
  }
  if (system.activeCells.some((value) => value !== 0 && value !== 1)) {
    throw new Error("Structural active cells must be binary.");
  }
  const vectors = new Float32Array(cellCount * 3);
  const values = new Float32Array(cellCount);
  let maximum = 0;
  for (let cell = 0; cell < cellCount; cell += 1) {
    const sum = [0, 0, 0];
    for (const node of nodesForCell(cell, result.grid)) {
      sum[0]! += result.displacementM[node * 3]!;
      sum[1]! += result.displacementM[node * 3 + 1]!;
      sum[2]! += result.displacementM[node * 3 + 2]!;
    }
    const offset = cell * 3;
    vectors[offset] = Math.fround(sum[0]! / 8 * MM_PER_M);
    vectors[offset + 1] = Math.fround(sum[1]! / 8 * MM_PER_M);
    vectors[offset + 2] = Math.fround(sum[2]! / 8 * MM_PER_M);
    const magnitude = Math.hypot(vectors[offset]!, vectors[offset + 1]!, vectors[offset + 2]!);
    if (!Number.isFinite(magnitude)) throw new Error("Structural scene displacement must be finite.");
    values[cell] = magnitude;
    maximum = Math.max(maximum, magnitude);
  }
  const cellSize = result.grid.cellSizeM * MM_PER_M;
  const origin = result.grid.originM.map((value) => value * MM_PER_M);
  return { dimensions: [...result.grid.cellDimensions], cellSize: [cellSize, cellSize, cellSize],
    origin: [origin[0]!, origin[1]!, origin[2]!], active: Uint8Array.from(system.activeCells),
    values, maximum: Math.max(maximum, Number.EPSILON), vectors,
    displacementUnit: "mm", sourceDisplacementUnit: "m" };
}
