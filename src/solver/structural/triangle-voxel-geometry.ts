import type { SemanticMeshPayload } from "../../cad/rebuild-payload";

export type Point3 = readonly [number, number, number];
export interface OwnedTriangle {
  readonly a: Point3;
  readonly b: Point3;
  readonly c: Point3;
  readonly bodyId: string;
  readonly topologyId: string;
}

const subtract = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Point3, b: Point3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Point3, b: Point3): Point3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const lengthSquared = (value: Point3) => dot(value, value);

function point(mesh: SemanticMeshPayload, vertex: number): Point3 {
  const offset = vertex * 3;
  return [mesh.positionsM[offset]!, mesh.positionsM[offset + 1]!, mesh.positionsM[offset + 2]!];
}

export function ownedTriangles(
  mesh: SemanticMeshPayload,
  bodyIds: ReadonlySet<string>,
): readonly OwnedTriangle[] {
  const triangles: OwnedTriangle[] = [];
  for (let triangle = 0; triangle < mesh.indices.length / 3; triangle += 1) {
    const face = mesh.faces[mesh.triangleFaceIndices[triangle]!]!;
    if (!bodyIds.has(face.bodyId)) continue;
    triangles.push({
      a: point(mesh, mesh.indices[triangle * 3]!),
      b: point(mesh, mesh.indices[triangle * 3 + 1]!),
      c: point(mesh, mesh.indices[triangle * 3 + 2]!),
      bodyId: face.bodyId,
      topologyId: face.id,
    });
  }
  return triangles;
}

function pointKey(value: Point3, toleranceM: number): string {
  const decimalPlaces = Math.max(0, Math.min(15, Math.ceil(-Math.log10(toleranceM))));
  return value.map((coordinate) => (Object.is(coordinate, -0) ? 0 : coordinate).toFixed(decimalPlaces)).join(",");
}

export function validateClosedTriangleBodies(
  triangles: readonly OwnedTriangle[],
  bodyIds: readonly string[],
  toleranceM: number,
): void {
  for (const bodyId of bodyIds) {
    const body = triangles.filter((triangle) => triangle.bodyId === bodyId);
    if (body.length < 4) throw new Error(`Exact semantic body is not a closed triangle surface: ${bodyId}`);
    const edges = new Map<string, { count: number; balance: number }>();
    for (const triangle of body) {
      for (const [start, end] of [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]] as const) {
        const left = pointKey(start, toleranceM), right = pointKey(end, toleranceM);
        if (left === right) throw new Error(`Exact semantic body contains a degenerate triangle edge: ${bodyId}`);
        const key = left < right ? `${left}|${right}` : `${right}|${left}`;
        const edge = edges.get(key) ?? { count: 0, balance: 0 };
        edge.count += 1;
        edge.balance += left < right ? 1 : -1;
        edges.set(key, edge);
      }
    }
    if ([...edges.values()].some(({ count, balance }) => count !== 2 || balance !== 0)) {
      throw new Error(`Exact semantic body is not a closed consistently oriented triangle surface: ${bodyId}`);
    }
  }
}

const RAY: Point3 = [1, 0.3713906763541037, 0.19245008972987526];

function rayTriangle(origin: Point3, triangle: OwnedTriangle): number | undefined {
  const edge1 = subtract(triangle.b, triangle.a), edge2 = subtract(triangle.c, triangle.a);
  const p = cross(RAY, edge2), determinant = dot(edge1, p);
  if (Math.abs(determinant) < 1e-14) return undefined;
  const inverse = 1 / determinant, translated = subtract(origin, triangle.a);
  const u = dot(translated, p) * inverse;
  if (u < -1e-10 || u > 1 + 1e-10) return undefined;
  const q = cross(translated, edge1), v = dot(RAY, q) * inverse;
  if (v < -1e-10 || u + v > 1 + 1e-10) return undefined;
  const distance = dot(edge2, q) * inverse;
  return distance > 1e-10 ? distance : undefined;
}

export function pointInsideClosedBody(point: Point3, triangles: readonly OwnedTriangle[]): boolean {
  const hits = triangles.map((triangle) => rayTriangle(point, triangle))
    .filter((value): value is number => value !== undefined)
    .sort((left, right) => left - right);
  let unique = 0, previous = Number.NEGATIVE_INFINITY;
  for (const hit of hits) {
    if (Math.abs(hit - previous) > 1e-8 * Math.max(1, Math.abs(hit))) {
      unique += 1;
      previous = hit;
    }
  }
  return unique % 2 === 1;
}

export function signedTriangleVolumeM3(triangles: readonly OwnedTriangle[]): number {
  return triangles.reduce((sum, triangle) => sum + dot(triangle.a, cross(triangle.b, triangle.c)) / 6, 0);
}

function segmentDistanceSquared(point: Point3, start: Point3, end: Point3): number {
  const edge = subtract(end, start), relative = subtract(point, start);
  const t = Math.max(0, Math.min(1, dot(relative, edge) / lengthSquared(edge)));
  return lengthSquared(subtract(point, [
    start[0] + edge[0] * t, start[1] + edge[1] * t, start[2] + edge[2] * t,
  ]));
}

export function pointTriangleDistanceSquared(point: Point3, triangle: OwnedTriangle): number {
  const edge1 = subtract(triangle.b, triangle.a), edge2 = subtract(triangle.c, triangle.a);
  const normal = cross(edge1, edge2), normalLength = lengthSquared(normal);
  if (!(normalLength > 0)) return Number.POSITIVE_INFINITY;
  const relative = subtract(point, triangle.a), signed = dot(relative, normal);
  const projected: Point3 = [
    point[0] - normal[0] * signed / normalLength,
    point[1] - normal[1] * signed / normalLength,
    point[2] - normal[2] * signed / normalLength,
  ];
  const c0 = dot(cross(subtract(triangle.b, triangle.a), subtract(projected, triangle.a)), normal);
  const c1 = dot(cross(subtract(triangle.c, triangle.b), subtract(projected, triangle.b)), normal);
  const c2 = dot(cross(subtract(triangle.a, triangle.c), subtract(projected, triangle.c)), normal);
  if (c0 >= -1e-14 && c1 >= -1e-14 && c2 >= -1e-14) return signed * signed / normalLength;
  return Math.min(
    segmentDistanceSquared(point, triangle.a, triangle.b),
    segmentDistanceSquared(point, triangle.b, triangle.c),
    segmentDistanceSquared(point, triangle.c, triangle.a),
  );
}
