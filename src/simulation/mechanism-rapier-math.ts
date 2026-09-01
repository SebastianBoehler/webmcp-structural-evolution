export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

export const vectorObject = ([x, y, z]: Vec3) => ({ x, y, z });
export const quaternionObject = ([x, y, z, w]: Quat) => ({ x, y, z, w });
export const canonicalScalar = (value: number) => Object.is(value, -0) ? 0 : value;

export function multiplyQuaternion(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

export function rotateVector(q: Quat, [x, y, z]: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  return [x + qw * tx + qy * tz - qz * ty,
    y + qw * ty + qz * tx - qx * tz,
    z + qw * tz + qx * ty - qy * tx];
}

export function canonicalVector(value: { readonly x: number; readonly y: number; readonly z: number }): [number, number, number] {
  return [value.x, value.y, value.z].map(canonicalScalar) as [number, number, number];
}

export function canonicalQuaternion(value: { readonly x: number; readonly y: number; readonly z: number; readonly w: number }): [number, number, number, number] {
  let result = [value.x, value.y, value.z, value.w] as [number, number, number, number];
  const magnitude = Math.hypot(...result);
  result = result.map((entry) => entry / magnitude) as typeof result;
  const leading = [result[3], result[0], result[1], result[2]].find((entry) => entry !== 0);
  if (leading !== undefined && leading < 0) result = result.map((entry) => -entry) as typeof result;
  return result.map(canonicalScalar) as typeof result;
}
