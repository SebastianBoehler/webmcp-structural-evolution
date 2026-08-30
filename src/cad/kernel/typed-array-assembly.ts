export interface OffsetUint32Part {
  readonly values: Uint32Array;
  readonly offset: number;
}

export function concatFloat32(parts: readonly Float32Array[], length: number): Float32Array {
  const result = new Float32Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function concatUint32(parts: readonly Uint32Array[], length: number): Uint32Array {
  const result = new Uint32Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function concatOffsetUint32(
  parts: readonly OffsetUint32Part[],
  length: number,
): Uint32Array {
  const result = new Uint32Array(length);
  let target = 0;
  for (const { values, offset } of parts) {
    for (let index = 0; index < values.length; index += 1) {
      result[target++] = values[index]! + offset;
    }
  }
  return result;
}

export function containsUint32(values: Uint32Array, predicate: (value: number) => boolean): boolean {
  for (let index = 0; index < values.length; index += 1) {
    if (predicate(values[index]!)) return true;
  }
  return false;
}
