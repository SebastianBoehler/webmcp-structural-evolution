import type { DesignDocument } from "../cad/document-schema";
import {
  applyPoint, multiplyMatrix, quaternionFromMatrix, resolveDocumentFrame, transpose,
  type Matrix3, type Vec3Tuple,
} from "../cad/rigid-transform";
import type { SemanticMeshPayload, SemanticTopology } from "../cad/rebuild-payload";

type Scalar = number | { readonly parameterId: string };

function scalar(document: DesignDocument, value: Scalar, kind: "length" | "angle"): number {
  if (typeof value === "number") return value;
  const parameter = document.parameters.find(({ id }) => id === value.parameterId);
  if (!parameter || parameter.value.kind !== kind) {
    throw new Error(`Mechanism geometry parameter is unresolved or has the wrong unit: ${value.parameterId}`);
  }
  return parameter.value.value.value;
}

export function indexBodyMeshes(mesh: SemanticMeshPayload, bodyIds: readonly string[]) {
  const requested = new Set(bodyIds);
  const states = new Map(bodyIds.map((bodyId) => [bodyId, {
    remap: new Map<number, number>(), verticesM: [] as Vec3Tuple[], triangles: [] as [number, number, number][],
  }]));
  for (let triangle = 0; triangle < mesh.triangleFaceIndices.length; triangle += 1) {
    const face = mesh.faces[mesh.triangleFaceIndices[triangle]!]!;
    if (!requested.has(face.bodyId)) continue;
    const state = states.get(face.bodyId)!;
    const local = [0, 1, 2].map((corner) => {
      const source = mesh.indices[triangle * 3 + corner]!;
      let target = state.remap.get(source);
      if (target === undefined) {
        target = state.verticesM.length;
        state.remap.set(source, target);
        state.verticesM.push([
          mesh.positionsM[source * 3]!, mesh.positionsM[source * 3 + 1]!, mesh.positionsM[source * 3 + 2]!,
        ]);
      }
      return target;
    });
    state.triangles.push(local as [number, number, number]);
  }
  for (const [bodyId, state] of states) if (state.triangles.length === 0) {
    throw new Error(`Semantic collision geometry is missing for body: ${bodyId}`);
  }
  return new Map([...states].map(([bodyId, { verticesM, triangles }]) => [bodyId, { verticesM, triangles }]));
}

function semicircleIsConvex(document: DesignDocument, sketch: DesignDocument["sketches"][number]): boolean {
  if (sketch.entities.length !== 2) return false;
  const arc = sketch.entities.find(({ kind }) => kind === "arc");
  const line = sketch.entities.find(({ kind }) => kind === "line");
  if (!arc || arc.kind !== "arc" || !line || line.kind !== "line") return false;
  const center = arc.centerM.map((value) => scalar(document, value, "length"));
  const radius = scalar(document, arc.radiusM, "length");
  const start = scalar(document, arc.startAngleRad, "angle");
  const end = scalar(document, arc.endAngleRad, "angle");
  const sweep = end - start;
  if (!(sweep > 0) || sweep > Math.PI + 1e-12) return false;
  const endpoints = [start, end].map((angle) => [
    center[0]! + radius * Math.cos(angle), center[1]! + radius * Math.sin(angle),
  ]);
  const lineStart = line.startM.map((value) => scalar(document, value, "length"));
  const lineEnd = line.endM.map((value) => scalar(document, value, "length"));
  const same = (left: readonly number[], right: readonly number[]) =>
    Math.hypot(left[0]! - right[0]!, left[1]! - right[1]!) <= 1e-12;
  return same(lineStart, endpoints[1]!) && same(lineEnd, endpoints[0]!);
}

function polygonIsConvex(document: DesignDocument, sketch: DesignDocument["sketches"][number]): boolean {
  if (sketch.entities.length < 3 || sketch.entities.some(({ kind }) => kind !== "line")) return false;
  const lines = sketch.entities as readonly Extract<typeof sketch.entities[number], { kind: "line" }>[];
  const points = lines.map(({ startM }) => startM.map((value) => scalar(document, value, "length")) as [number, number]);
  const endpoint = lines.at(-1)!.endM.map((value) => scalar(document, value, "length")) as [number, number];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const end = lines[index]!.endM.map((value) => scalar(document, value, "length"));
    const next = lines[index + 1]!.startM.map((value) => scalar(document, value, "length"));
    if (end.some((value, axis) => value !== next[axis])) return false;
  }
  if (endpoint.some((value, axis) => value !== points[0]![axis])) return false;
  let sign = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!, b = points[(index + 1) % points.length]!, c = points[(index + 2) % points.length]!;
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross === 0) continue;
    const current = Math.sign(cross);
    if (sign !== 0 && current !== sign) return false;
    sign = current;
  }
  return sign !== 0;
}

export function exactPrimitiveOrConvexProof(document: DesignDocument, bodyId: string) {
  const body = document.bodies.find(({ id }) => id === bodyId);
  const feature = body && document.features.find(({ id }) => id === body.featureId);
  if (!body || !feature || feature.kind !== "extrude") return { convexStraightExtrusion: false };
  const sketch = document.sketches.find(({ id }) => id === feature.sketchId);
  if (!sketch) throw new Error(`Mechanism body sketch is unresolved: ${bodyId}`);
  const distanceM = scalar(document, feature.distanceM, "length");
  const frame = resolveDocumentFrame(document, sketch.plane.slice("frame:".length));
  const entity = sketch.entities.length === 1 ? sketch.entities[0] : undefined;
  if (entity?.kind === "rectangle") {
    const center = entity.centerM.map((value) => scalar(document, value, "length")) as [number, number];
    const size = entity.sizeM.map((value) => scalar(document, value, "length")) as [number, number];
    return { convexStraightExtrusion: true, primitive: {
      shape: { kind: "box" as const, halfExtentsM: [size[0] / 2, size[1] / 2, distanceM / 2] as Vec3Tuple },
      bodyLocalTransform: { positionM: applyPoint(frame, [center[0], center[1], distanceM / 2]),
        orientation: quaternionFromMatrix(frame.rotation) },
    }, inertiaRotation: frame.rotation };
  }
  if (entity?.kind === "circle") {
    const center = entity.centerM.map((value) => scalar(document, value, "length")) as [number, number];
    return { convexStraightExtrusion: true, primitive: {
      shape: { kind: "cylinder" as const, halfHeightM: distanceM / 2,
        radiusM: scalar(document, entity.radiusM, "length") },
      bodyLocalTransform: { positionM: applyPoint(frame, [center[0], center[1], distanceM / 2]),
        orientation: quaternionFromMatrix([
          frame.rotation[0], frame.rotation[2], -frame.rotation[1],
          frame.rotation[3], frame.rotation[5], -frame.rotation[4],
          frame.rotation[6], frame.rotation[8], -frame.rotation[7],
        ]) },
    }, inertiaRotation: frame.rotation };
  }
  return { convexStraightExtrusion: polygonIsConvex(document, sketch) || semicircleIsConvex(document, sketch) };
}

export function assertPrimitiveDynamics(
  proof: ReturnType<typeof exactPrimitiveOrConvexProof>,
  dynamics: { readonly volumeM3: number; readonly centerOfMassM: Vec3Tuple;
    readonly centroidalInertiaUnitDensityKgM2: Matrix3 },
  faces: readonly SemanticTopology[],
): void {
  if (!proof.primitive) return;
  const shape = proof.primitive.shape;
  const geometries = faces.map(({ signature }) => signature.geometry).sort();
  const topologyMatches = shape.kind === "box"
    ? faces.length === 6 && geometries.every((geometry) => geometry === "plane")
      && faces.every(({ surfaceEvidence }) => surfaceEvidence?.kind === "plane")
    : faces.length === 3 && geometries.join(",") === "cylinder,plane,plane"
      && faces.every(({ signature, surfaceEvidence }) => signature.geometry === surfaceEvidence?.kind);
  if (!topologyMatches) throw new Error("Exact semantic topology does not match the proven primitive");
  const expectedVolume = shape.kind === "box"
    ? 8 * shape.halfExtentsM[0] * shape.halfExtentsM[1] * shape.halfExtentsM[2]
    : Math.PI * shape.radiusM ** 2 * shape.halfHeightM * 2;
  const volumeTolerance = Math.max(expectedVolume, dynamics.volumeM3) * 1e-9;
  if (Math.abs(expectedVolume - dynamics.volumeM3) > volumeTolerance) {
    throw new Error("Exact BREP mass evidence does not match the proven primitive volume");
  }
  const scale = shape.kind === "box" ? Math.max(...shape.halfExtentsM) : Math.max(shape.radiusM, shape.halfHeightM);
  const centerTolerance = Math.max(scale * 1e-9, 1e-12);
  if (dynamics.centerOfMassM.some((value, axis) =>
    Math.abs(value - proof.primitive!.bodyLocalTransform.positionM[axis]!) > centerTolerance)) {
    throw new Error("Exact BREP mass evidence does not match the proven primitive center");
  }
  const local = primitiveInertia(shape, expectedVolume);
  const expected = multiplyMatrix(multiplyMatrix(proof.inertiaRotation!, local), transpose(proof.inertiaRotation!));
  const tensorScale = Math.max(...expected.map(Math.abs), ...dynamics.centroidalInertiaUnitDensityKgM2.map(Math.abs));
  if (!(tensorScale > 0) || dynamics.centroidalInertiaUnitDensityKgM2.some((value, index) =>
    Math.abs(value - expected[index]!) / tensorScale > 1e-8)) {
    throw new Error("Exact BREP inertia evidence does not match the proven primitive");
  }
}

function primitiveInertia(
  shape: NonNullable<ReturnType<typeof exactPrimitiveOrConvexProof>["primitive"]>["shape"],
  mass: number,
): Matrix3 {
  if (shape.kind === "box") {
    const [x, y, z] = shape.halfExtentsM.map((half) => 2 * half);
    return [mass * (y * y + z * z) / 12, 0, 0,
      0, mass * (x * x + z * z) / 12, 0,
      0, 0, mass * (x * x + y * y) / 12];
  }
  const height = 2 * shape.halfHeightM;
  const radial = mass * (3 * shape.radiusM ** 2 + height ** 2) / 12;
  return [radial, 0, 0, 0, radial, 0, 0, 0, mass * shape.radiusM ** 2 / 2];
}
