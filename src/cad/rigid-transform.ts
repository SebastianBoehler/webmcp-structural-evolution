import type { DesignDocument } from "./document-schema";

export type Vec3Tuple = readonly [number, number, number];
export type Matrix3 = readonly [number, number, number, number, number, number, number, number, number];
export interface RigidTransform {
  readonly positionM: Vec3Tuple;
  readonly rotation: Matrix3;
}

export const IDENTITY_TRANSFORM: RigidTransform = Object.freeze({
  positionM: [0, 0, 0] as const, rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] as const,
});

export function rotationFromEuler(roll: number, pitch: number, yaw: number): Matrix3 {
  const [cr, sr, cp, sp, cy, sy] = [
    Math.cos(roll), Math.sin(roll), Math.cos(pitch), Math.sin(pitch), Math.cos(yaw), Math.sin(yaw),
  ];
  return [
    cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr,
    sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr,
    -sp, cp * sr, cp * cr,
  ];
}

export function multiplyMatrix(left: Matrix3, right: Matrix3): Matrix3 {
  const result = new Array<number>(9);
  for (let row = 0; row < 3; row += 1) for (let column = 0; column < 3; column += 1) {
    let value = 0;
    for (let index = 0; index < 3; index += 1) {
      value += left[row * 3 + index]! * right[index * 3 + column]!;
    }
    result[row * 3 + column] = value;
  }
  return result as unknown as Matrix3;
}

export function transpose(matrix: Matrix3): Matrix3 {
  return [matrix[0], matrix[3], matrix[6], matrix[1], matrix[4], matrix[7], matrix[2], matrix[5], matrix[8]];
}

export function applyDirection(transform: Pick<RigidTransform, "rotation">, vector: Vec3Tuple): Vec3Tuple {
  const matrix = transform.rotation;
  return [
    matrix[0] * vector[0] + matrix[1] * vector[1] + matrix[2] * vector[2],
    matrix[3] * vector[0] + matrix[4] * vector[1] + matrix[5] * vector[2],
    matrix[6] * vector[0] + matrix[7] * vector[1] + matrix[8] * vector[2],
  ];
}

export function applyPoint(transform: RigidTransform, point: Vec3Tuple): Vec3Tuple {
  const rotated = applyDirection(transform, point);
  return rotated.map((value, index) => value + transform.positionM[index]!) as unknown as Vec3Tuple;
}

export function composeTransforms(parent: RigidTransform, child: RigidTransform): RigidTransform {
  return {
    positionM: applyPoint(parent, child.positionM),
    rotation: multiplyMatrix(parent.rotation, child.rotation),
  };
}

export function inverseTransform(transform: RigidTransform): RigidTransform {
  const rotation = transpose(transform.rotation);
  const direction = applyDirection({ rotation }, transform.positionM);
  return { positionM: [-direction[0], -direction[1], -direction[2]], rotation };
}

export function quaternionFromMatrix(matrix: Matrix3): readonly [number, number, number, number] {
  const trace = matrix[0] + matrix[4] + matrix[8];
  let quaternion: [number, number, number, number];
  if (trace > 0) {
    const scale = 2 * Math.sqrt(trace + 1);
    quaternion = [(matrix[7] - matrix[5]) / scale, (matrix[2] - matrix[6]) / scale,
      (matrix[3] - matrix[1]) / scale, scale / 4];
  } else if (matrix[0] > matrix[4] && matrix[0] > matrix[8]) {
    const scale = 2 * Math.sqrt(1 + matrix[0] - matrix[4] - matrix[8]);
    quaternion = [scale / 4, (matrix[1] + matrix[3]) / scale,
      (matrix[2] + matrix[6]) / scale, (matrix[7] - matrix[5]) / scale];
  } else if (matrix[4] > matrix[8]) {
    const scale = 2 * Math.sqrt(1 + matrix[4] - matrix[0] - matrix[8]);
    quaternion = [(matrix[1] + matrix[3]) / scale, scale / 4,
      (matrix[5] + matrix[7]) / scale, (matrix[2] - matrix[6]) / scale];
  } else {
    const scale = 2 * Math.sqrt(1 + matrix[8] - matrix[0] - matrix[4]);
    quaternion = [(matrix[2] + matrix[6]) / scale, (matrix[5] + matrix[7]) / scale,
      scale / 4, (matrix[3] - matrix[1]) / scale];
  }
  const magnitude = Math.hypot(...quaternion);
  const normalized = quaternion.map((value) => value / magnitude) as typeof quaternion;
  const leading = [normalized[3], normalized[0], normalized[1], normalized[2]].find((value) => value !== 0);
  return (leading !== undefined && leading < 0 ? normalized.map((value) => -value) : normalized)
    .map((value) => Object.is(value, -0) ? 0 : value) as typeof quaternion;
}

export function resolveDocumentFrame(document: Pick<DesignDocument, "frames">, frameId: string): RigidTransform {
  const frames = new Map(document.frames.map((frame) => [frame.id, frame]));
  const cache = new Map<string, RigidTransform>();
  const resolve = (id: string): RigidTransform => {
    const cached = cache.get(id);
    if (cached) return cached;
    const frame = frames.get(id);
    if (!frame) throw new Error(`Document frame is unresolved: ${id}`);
    const local: RigidTransform = {
      positionM: [frame.transform.position.x.value, frame.transform.position.y.value, frame.transform.position.z.value],
      rotation: rotationFromEuler(frame.transform.orientation.roll.value,
        frame.transform.orientation.pitch.value, frame.transform.orientation.yaw.value),
    };
    const resolved = frame.parentId === undefined ? local : composeTransforms(resolve(frame.parentId), local);
    cache.set(id, resolved);
    return resolved;
  };
  return resolve(frameId);
}

export function occtMatrix(transform: RigidTransform): number[] {
  const { rotation: r, positionM: p } = transform;
  return [r[0], r[1], r[2], p[0], r[3], r[4], r[5], p[1], r[6], r[7], r[8], p[2]];
}
