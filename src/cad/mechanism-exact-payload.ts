import { CAD_RESOURCE_LIMITS } from "./cad-resource-limits";
import { assertFixedOwnedPayload, assertFixedOwnedView } from "./fixed-owned-payload";

export const MECHANISM_EXACT_OUTPUTS = Object.freeze([
  "brep", "semantic-mesh", "body-dynamics",
] as const);

function rawRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

export function isMechanismExactOutputs(value: unknown): boolean {
  return Array.isArray(value) && value.length === MECHANISM_EXACT_OUTPUTS.length
    && MECHANISM_EXACT_OUTPUTS.every((output, index) => value[index] === output);
}

function assertPayloadViewKinds(brepValue: unknown, semanticValue: unknown): void {
  const brep = rawRecord(brepValue);
  const semantic = rawRecord(semanticValue);
  if (!brep || !semantic) throw new TypeError("Exact output payloads must be records");
  assertFixedOwnedView(brep.bytes, "Uint8Array");
  for (const field of ["positionsM", "normals", "edgePointsM"] as const) {
    assertFixedOwnedView(semantic[field], "Float32Array");
  }
  for (const field of [
    "indices", "triangleFaceIndices", "edgePointRanges", "polylineEdgeIndices",
  ] as const) {
    assertFixedOwnedView(semantic[field], "Uint32Array");
  }
}

export function assertMechanismExactSuccessPayloads(value: unknown): void {
  const results = rawRecord(value)?.results;
  if (!Array.isArray(results)) {
    throw new Error("Exact mechanism rebuild success omitted result payloads");
  }
  if (results.length !== MECHANISM_EXACT_OUTPUTS.length || results.some((candidate) => {
    const output = rawRecord(candidate)?.output;
    return typeof output !== "string"
      || !MECHANISM_EXACT_OUTPUTS.some((expected) => expected === output);
  })) {
    throw new Error("Exact mechanism rebuild success contained unexpected result payloads");
  }
  const payloads = MECHANISM_EXACT_OUTPUTS.map((output) => {
    const matches = results.filter((candidate) => rawRecord(candidate)?.output === output);
    const result = matches.length === 1 ? rawRecord(matches[0]) : undefined;
    if (!result || !Object.hasOwn(result, "payload")) {
      throw new Error(`Exact mechanism rebuild requires one ${output} payload`);
    }
    return result.payload;
  });
  assertPayloadViewKinds(payloads[0], payloads[1]);
  assertFixedOwnedPayload(payloads, {
    resource: "mechanism exact source bytes",
    limit: CAD_RESOURCE_LIMITS.mechanismExactSourceBytes,
  });
}
