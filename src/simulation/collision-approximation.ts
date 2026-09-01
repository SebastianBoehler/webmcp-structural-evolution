import { SEMANTIC_LINEAR_DEFLECTION_M } from "../cad/kernel/semantic-tessellation";
import type { Vec3Tuple } from "../cad/rigid-transform";

interface BodyMesh {
  readonly verticesM: readonly Vec3Tuple[];
  readonly triangles: readonly (readonly [number, number, number])[];
}
type Primitive =
  | { readonly kind: "box"; readonly halfExtentsM: Vec3Tuple }
  | { readonly kind: "cylinder"; readonly halfHeightM: number; readonly radiusM: number };
interface ColliderTransform {
  readonly positionM: Vec3Tuple;
  readonly orientation: readonly [number, number, number, number];
}

interface CollisionInput {
  readonly bodyKind: "fixed" | "dynamic";
  readonly toleranceM: number;
  readonly mesh: BodyMesh;
  readonly primitive?: { readonly shape: Primitive; readonly bodyLocalTransform: ColliderTransform };
  readonly convexStraightExtrusion: boolean;
}

function meshDeviationM(mesh: BodyMesh): number {
  let quantizationSquared = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    let maximum = 0;
    for (const vertex of mesh.verticesM) maximum = Math.max(maximum, Math.abs(vertex[axis]!));
    const bound = Math.max(maximum * 2 ** -24, 2 ** -149);
    quantizationSquared += bound * bound;
  }
  return SEMANTIC_LINEAR_DEFLECTION_M + Math.sqrt(quantizationSquared);
}

export function compileCollisionShape(input: CollisionInput) {
  if (input.primitive) return {
    shape: input.primitive.shape,
    bodyLocalTransform: input.primitive.bodyLocalTransform,
    approximation: { kind: "exact-primitive" as const, maximumSurfaceDeviationM: 0 },
  };
  const maximumSurfaceDeviationM = meshDeviationM(input.mesh);
  if (input.toleranceM < maximumSurfaceDeviationM) {
    throw new Error("Collision approximation exceeds the mechanism study tolerance");
  }
  const identity = { positionM: [0, 0, 0] as const, orientation: [0, 0, 0, 1] as const };
  if (input.bodyKind === "dynamic") {
    if (!input.convexStraightExtrusion) {
      throw new Error("Unsupported dynamic collision geometry requires a proven convex approximation");
    }
    if (input.mesh.verticesM.length > 256) throw new Error("Dynamic convex hull exceeds the 256 vertex budget");
    return {
      shape: { kind: "convex-hull" as const, verticesM: input.mesh.verticesM },
      bodyLocalTransform: identity,
      approximation: { kind: "convex-hull" as const, maximumSurfaceDeviationM },
    };
  }
  if (input.mesh.verticesM.length > 4_096 || input.mesh.triangles.length > 8_192) {
    throw new Error("Fixed collision trimesh exceeds the supported mesh budget");
  }
  return {
    shape: { kind: "fixed-trimesh" as const, verticesM: input.mesh.verticesM, triangles: input.mesh.triangles },
    bodyLocalTransform: identity,
    approximation: { kind: "fixed-trimesh" as const, maximumSurfaceDeviationM },
  };
}
