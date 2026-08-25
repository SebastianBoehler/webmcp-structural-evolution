type ReferenceModule = typeof import("./pkg/webmcp_reference.js");

let referencePromise: Promise<ReferenceModule> | undefined;

function loadReference(): Promise<ReferenceModule> {
  referencePromise ??= import("./pkg/webmcp_reference.js").then(async (reference) => {
    await reference.default();
    return reference;
  });
  return referencePromise;
}

function requireFloat32Array(value: unknown, name: string): asserts value is Float32Array {
  if (!(value instanceof Float32Array)) {
    throw new TypeError(`${name} must be a Float32Array`);
  }
}

export async function relativeL2(
  expected: Float32Array,
  actual: Float32Array,
): Promise<number> {
  requireFloat32Array(expected, "expected");
  requireFloat32Array(actual, "actual");

  const reference = await loadReference();
  return reference.relative_l2(expected, actual);
}
