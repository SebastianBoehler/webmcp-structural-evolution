interface GridGeometry {
  readonly cellDimensions: readonly [number, number, number];
  readonly nodeDimensions: readonly [number, number, number];
  readonly originM: readonly [number, number, number];
  readonly cellSizeM: number;
}

const INVALID_GEOMETRY = "Structural grid derived coordinates and extents must be finite and resolvable";

function requireFinite(values: readonly number[]): void {
  if (values.some((value) => !Number.isFinite(value))) throw new Error(INVALID_GEOMETRY);
}

function validateGeometry(geometry: GridGeometry): void {
  requireFinite([...geometry.originM, geometry.cellSizeM]);
  if (geometry.cellSizeM <= 0) throw new Error(INVALID_GEOMETRY);
  for (let axis = 0; axis < 3; axis += 1) {
    const extent = geometry.cellDimensions[axis]! * geometry.cellSizeM;
    const end = geometry.originM[axis]! + extent;
    requireFinite([extent, end]);
    if (extent <= 0 || end <= geometry.originM[axis]!) throw new Error(INVALID_GEOMETRY);
  }
}

function rank(rows: readonly number[][]): number {
  if (rows.some((row) => row.length !== 6 || row.some((value) => !Number.isFinite(value)))) {
    throw new Error("Structural rigid restraint matrix rows must be finite");
  }
  const matrix = rows.map((row) => [...row]);
  let pivotRow = 0;
  for (let column = 0; column < 6 && pivotRow < matrix.length; column += 1) {
    let pivot = pivotRow;
    for (let row = pivotRow + 1; row < matrix.length; row += 1) {
      const candidate = Math.abs(matrix[row]![column]!);
      const current = Math.abs(matrix[pivot]![column]!);
      requireFinite([candidate, current]);
      if (candidate > current) pivot = row;
    }
    const pivotMagnitude = Math.abs(matrix[pivot]![column]!);
    requireFinite([pivotMagnitude]);
    if (pivotMagnitude <= 1e-10) continue;
    [matrix[pivotRow], matrix[pivot]] = [matrix[pivot]!, matrix[pivotRow]!];
    const divisor = matrix[pivotRow]![column]!;
    for (let cursor = column; cursor < 6; cursor += 1) {
      matrix[pivotRow]![cursor]! /= divisor;
      requireFinite([matrix[pivotRow]![cursor]!]);
    }
    for (let row = pivotRow + 1; row < matrix.length; row += 1) {
      const factor = matrix[row]![column]!;
      for (let cursor = column; cursor < 6; cursor += 1) {
        matrix[row]![cursor]! -= factor * matrix[pivotRow]![cursor]!;
        requireFinite([matrix[row]![cursor]!]);
      }
    }
    pivotRow += 1;
  }
  return pivotRow;
}

function cellCoordinates(cell: number, dimensions: readonly [number, number, number]) {
  const [width, height] = dimensions;
  const plane = width * height;
  const z = Math.floor(cell / plane);
  const rest = cell - z * plane;
  const y = Math.floor(rest / width);
  return [rest - y * width, y, z] as const;
}

function cellNodes(cell: number, geometry: GridGeometry): readonly number[] {
  const [x, y, z] = cellCoordinates(cell, geometry.cellDimensions);
  const [width, height] = geometry.nodeDimensions;
  const base = x + y * width + z * width * height;
  return [
    base, base + 1, base + width, base + width + 1,
    base + width * height, base + width * height + 1,
    base + width * height + width, base + width * height + width + 1,
  ];
}

function constraintRows(
  nodes: ReadonlySet<number>,
  bounds: readonly [number, number, number, number, number, number],
  fixedDofs: Uint32Array,
  nodeDimensions: readonly [number, number, number],
): number[][] {
  const center = [
    bounds[0] + (bounds[3] - bounds[0]) * 0.5,
    bounds[1] + (bounds[4] - bounds[1]) * 0.5,
    bounds[2] + (bounds[5] - bounds[2]) * 0.5,
  ];
  const extents = [bounds[3] - bounds[0], bounds[4] - bounds[1], bounds[5] - bounds[2]];
  const scale = Math.max(...extents);
  requireFinite([...bounds, ...center, ...extents, scale]);
  if (scale <= 0) throw new Error(INVALID_GEOMETRY);
  const [width, height] = nodeDimensions;
  const rows: number[][] = [];
  for (const node of nodes) {
    const z = Math.floor(node / (width * height));
    const rest = node - z * width * height;
    const y = Math.floor(rest / width);
    const x = rest - y * width;
    const rx = (x - center[0]!) / scale;
    const ry = (y - center[1]!) / scale;
    const rz = (z - center[2]!) / scale;
    requireFinite([rx, ry, rz]);
    if (fixedDofs[node * 3]) rows.push([1, 0, 0, 0, rz, -ry]);
    if (fixedDofs[node * 3 + 1]) rows.push([0, 1, 0, -rz, 0, rx]);
    if (fixedDofs[node * 3 + 2]) rows.push([0, 0, 1, ry, -rx, 0]);
  }
  return rows;
}

export function validateRigidModeRestraints(
  active: Uint32Array,
  components: Int32Array,
  fixedDofs: Uint32Array,
  geometry: GridGeometry,
): void {
  validateGeometry(geometry);
  let componentCount = 0;
  for (const component of components) componentCount = Math.max(componentCount, component + 1);
  const bounds = Array.from({ length: componentCount }, () => [
    Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY,
  ] as [number, number, number, number, number, number]);
  const restrainedNodes = new Map<number, Set<number>>();
  for (let cell = 0; cell < active.length; cell += 1) {
    if (!active[cell]) continue;
    const component = components[cell]!;
    const [x, y, z] = cellCoordinates(cell, geometry.cellDimensions);
    const box = bounds[component]!;
    box[0] = Math.min(box[0], x);
    box[1] = Math.min(box[1], y);
    box[2] = Math.min(box[2], z);
    box[3] = Math.max(box[3], x + 1);
    box[4] = Math.max(box[4], y + 1);
    box[5] = Math.max(box[5], z + 1);
    for (const node of cellNodes(cell, geometry)) {
      if (fixedDofs[node * 3] || fixedDofs[node * 3 + 1] || fixedDofs[node * 3 + 2]) {
        const nodes = restrainedNodes.get(component) ?? new Set<number>();
        nodes.add(node);
        restrainedNodes.set(component, nodes);
      }
    }
  }
  for (let component = 0; component < componentCount; component += 1) {
    requireFinite(bounds[component]!);
    const restraintRank = rank(constraintRows(
      restrainedNodes.get(component) ?? new Set<number>(), bounds[component]!,
      fixedDofs, geometry.nodeDimensions,
    ));
    if (restraintRank < 6) {
      throw new Error(`Active component ${component} has rigid restraint rank ${restraintRank}, less than 6`);
    }
  }
}
