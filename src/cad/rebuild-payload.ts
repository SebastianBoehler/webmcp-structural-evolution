import { z } from "zod";

import {
  assertCadResourceLimit,
  assertSemanticMeshUsage,
  CAD_RESOURCE_LIMITS,
  CadResourceLimitError,
} from "./cad-resource-limits";

const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const id = z.string().min(1);
const vec3 = z.tuple([finite, finite, finite]);
const typedArray = <Value extends ArrayBufferView>(tag: string) => z.custom<Value>(
  (value) => Object.prototype.toString.call(value) === `[object ${tag}]`,
  `Expected ${tag}`,
);
const someValue = (values: ArrayLike<number>, predicate: (value: number) => boolean) => {
  for (let index = 0; index < values.length; index += 1) {
    if (predicate(values[index]!)) return true;
  }
  return false;
};

type RawRecord = Record<string, unknown>;

function rawRecord(value: unknown): RawRecord | undefined {
  return value && typeof value === "object" ? value as RawRecord : undefined;
}

function addUtf8StringBytes(total: number, value: unknown): number {
  if (typeof value !== "string") return total;
  let next = total;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) next += 1;
    else if (code < 0x800) next += 2;
    else if (code >= 0xd800 && code <= 0xdbff
      && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      next += 4;
      index += 1;
    } else next += 3;
    assertCadResourceLimit(
      "semantic topology string bytes", next, CAD_RESOURCE_LIMITS.semanticMeshTopologyStringBytes,
    );
  }
  return next;
}

export function assertSemanticMeshPayloadLimits(value: unknown): void {
  const mesh = rawRecord(value);
  if (!mesh || !Array.isArray(mesh.faces) || !Array.isArray(mesh.edges)) return;
  assertCadResourceLimit(
    "semantic topology records", mesh.faces.length + mesh.edges.length,
    CAD_RESOURCE_LIMITS.semanticMeshTopologyRecords,
  );
  let adjacencyEntries = 0;
  let stringBytes = 0;
  const inspectTopology = (topology: unknown) => {
    const record = rawRecord(topology);
    if (!record) return;
    stringBytes = addUtf8StringBytes(stringBytes, record.id);
    stringBytes = addUtf8StringBytes(stringBytes, record.bodyId);
    const signature = rawRecord(record.signature);
    if (!signature) return;
    stringBytes = addUtf8StringBytes(stringBytes, signature.ownerFeatureId);
    stringBytes = addUtf8StringBytes(stringBytes, signature.kind);
    stringBytes = addUtf8StringBytes(stringBytes, signature.geometry);
    if (!Array.isArray(signature.adjacentKinds)) return;
    adjacencyEntries += signature.adjacentKinds.length;
    assertCadResourceLimit(
      "semantic topology adjacency entries", adjacencyEntries,
      CAD_RESOURCE_LIMITS.semanticMeshTopologyAdjacencyEntries,
    );
    for (const kind of signature.adjacentKinds) {
      stringBytes = addUtf8StringBytes(stringBytes, kind);
    }
  };
  for (const topology of mesh.faces) inspectTopology(topology);
  for (const topology of mesh.edges) inspectTopology(topology);
}

export const OpaqueBytesPayloadSchema = z.object({
  bytes: typedArray<Uint8Array>("Uint8Array"),
}).strict();

export const TopologySignaturePayloadSchema = z.object({
  ownerFeatureId: id,
  kind: z.enum(["face", "edge"]),
  geometry: z.enum(["plane", "cylinder", "cone", "sphere", "curve", "other"]),
  centroidM: vec3,
  measureSI: nonnegative,
  adjacentKinds: z.array(z.string()),
}).strict();

const SemanticTopologySchema = z.object({
  id,
  bodyId: id,
  signature: TopologySignaturePayloadSchema,
}).strict();

const SemanticMeshPayloadObjectSchema = z.object({
  positionsM: typedArray<Float32Array>("Float32Array"),
  normals: typedArray<Float32Array>("Float32Array"),
  indices: typedArray<Uint32Array>("Uint32Array"),
  faces: z.array(SemanticTopologySchema),
  triangleFaceIndices: typedArray<Uint32Array>("Uint32Array"),
  edgePointsM: typedArray<Float32Array>("Float32Array"),
  edgePointRanges: typedArray<Uint32Array>("Uint32Array"),
  edges: z.array(SemanticTopologySchema),
  polylineEdgeIndices: typedArray<Uint32Array>("Uint32Array"),
}).strict().superRefine((mesh, context) => {
  try {
    assertSemanticMeshUsage({
      vertices: mesh.positionsM.length / 3,
      triangles: mesh.indices.length / 3,
      edgePoints: mesh.edgePointsM.length / 3,
      topologyRecords: mesh.faces.length + mesh.edges.length,
      bytes: mesh.positionsM.byteLength + mesh.normals.byteLength + mesh.indices.byteLength
        + mesh.triangleFaceIndices.byteLength + mesh.edgePointsM.byteLength
        + mesh.edgePointRanges.byteLength + mesh.polylineEdgeIndices.byteLength,
    });
  } catch (error) {
    if (error instanceof CadResourceLimitError) {
      context.addIssue({ code: "custom", message: error.message });
    } else throw error;
  }
  if (mesh.positionsM.length % 3 !== 0 || mesh.normals.length !== mesh.positionsM.length) {
    context.addIssue({ code: "custom", message: "Semantic mesh vertex buffers are inconsistent" });
  }
  if (mesh.indices.length % 3 !== 0 || mesh.triangleFaceIndices.length !== mesh.indices.length / 3) {
    context.addIssue({ code: "custom", message: "Semantic mesh triangle ownership is inconsistent" });
  }
  if (someValue(mesh.indices, (index) => index >= mesh.positionsM.length / 3)
    || someValue(mesh.triangleFaceIndices, (index) => index >= mesh.faces.length)) {
    context.addIssue({ code: "custom", message: "Semantic mesh references an unavailable vertex or face" });
  }
  if (mesh.faces.some(({ signature }) => signature.kind !== "face")
    || mesh.edges.some(({ signature }) => signature.kind !== "edge")) {
    context.addIssue({ code: "custom", message: "Semantic topology kind does not match its collection" });
  }
  if (mesh.edgePointsM.length % 3 !== 0 || mesh.edgePointRanges.length % 2 !== 0
    || mesh.polylineEdgeIndices.length !== mesh.edgePointRanges.length / 2) {
    context.addIssue({ code: "custom", message: "Semantic edge buffers are inconsistent" });
  }
  const pointCount = mesh.edgePointsM.length / 3;
  for (let index = 0; index < mesh.edgePointRanges.length; index += 2) {
    if (mesh.edgePointRanges[index]! + mesh.edgePointRanges[index + 1]! > pointCount) {
      context.addIssue({ code: "custom", message: "Semantic edge range is outside the point buffer" });
    }
  }
  if (someValue(mesh.polylineEdgeIndices, (index) => index >= mesh.edges.length)) {
    context.addIssue({ code: "custom", message: "Semantic edge ownership is unavailable" });
  }
});

export const SemanticMeshPayloadSchema = z.unknown().transform((value, context) => {
  try {
    assertSemanticMeshPayloadLimits(value);
    return value;
  } catch (error) {
    if (error instanceof CadResourceLimitError) {
      context.addIssue({ code: "custom", message: error.message });
      return z.NEVER;
    }
    throw error;
  }
}).pipe(SemanticMeshPayloadObjectSchema);

export const MassPropertiesPayloadSchema = z.object({
  densityKgM3: finite.positive(),
  volumeM3: nonnegative,
  surfaceAreaM2: nonnegative,
  massKg: nonnegative,
  centerOfMassM: vec3,
  inertiaKgM2: z.tuple([finite, finite, finite, finite, finite, finite, finite, finite, finite]),
}).strict();

export const SectionCurvesPayloadSchema = z.object({
  pointsM: typedArray<Float32Array>("Float32Array"),
  curvePointRanges: typedArray<Uint32Array>("Uint32Array"),
  curveIds: z.array(id),
}).strict().superRefine((curves, context) => {
  if (curves.pointsM.length % 3 !== 0 || curves.curvePointRanges.length !== curves.curveIds.length * 2) {
    context.addIssue({ code: "custom", message: "Section curve buffers are inconsistent" });
  }
});

const encoder = new TextEncoder();

interface CanonicalChunks {
  readonly chunks: Uint8Array<ArrayBufferLike>[];
  byteLength: number;
  nodes: number;
}

function pushBounded(context: CanonicalChunks, bytes: Uint8Array<ArrayBufferLike>): void {
  const nextByteLength = context.byteLength + bytes.byteLength;
  assertCadResourceLimit(
    "canonical digest bytes", nextByteLength, CAD_RESOURCE_LIMITS.canonicalDigestBytes,
  );
  context.chunks.push(bytes);
  context.byteLength = nextByteLength;
}

function encodedByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff
      && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function encodeCanonicalText(value: string): Uint8Array {
  assertCadResourceLimit(
    "canonical text bytes", encodedByteLength(value), CAD_RESOURCE_LIMITS.canonicalDigestBytes,
  );
  return encoder.encode(value);
}

function framed(
  context: CanonicalChunks,
  label: string,
  bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(),
): void {
  pushBounded(context, encoder.encode(`${label}:${bytes.byteLength}:`));
  pushBounded(context, bytes);
}

function appendCanonical(value: unknown, context: CanonicalChunks): void {
  context.nodes += 1;
  assertCadResourceLimit(
    "canonical digest nodes", context.nodes, CAD_RESOURCE_LIMITS.canonicalDigestNodes,
  );
  if (value === null) return framed(context, "null");
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return framed(context, typeof value, encodeCanonicalText(Object.is(value, -0) ? "-0" : String(value)));
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return framed(context, value.constructor.name, bytes);
  }
  if (Array.isArray(value)) {
    framed(context, `array-${value.length}`);
    for (const item of value) appendCanonical(item, context);
    return;
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    const keys: string[] = [];
    for (const key in record) if (Object.hasOwn(record, key)) {
      assertCadResourceLimit(
        "canonical digest nodes", context.nodes + keys.length + 1,
        CAD_RESOURCE_LIMITS.canonicalDigestNodes,
      );
      keys.push(key);
    }
    keys.sort();
    framed(context, `object-${keys.length}`);
    for (const key of keys) {
      framed(context, "key", encodeCanonicalText(key));
      appendCanonical(record[key], context);
    }
    return;
  }
  throw new TypeError("CAD output payload is not transferable canonical data");
}

export async function digestCadOutputPayload(payload: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto SHA-256 is unavailable");
  const context: CanonicalChunks = { chunks: [], byteLength: 0, nodes: 0 };
  appendCanonical(payload, context);
  const bytes = new Uint8Array(context.byteLength);
  let offset = 0;
  for (const chunk of context.chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type OpaqueBytesPayload = z.infer<typeof OpaqueBytesPayloadSchema>;
export type SemanticMeshPayload = z.infer<typeof SemanticMeshPayloadSchema>;
export type MassPropertiesPayload = z.infer<typeof MassPropertiesPayloadSchema>;
export type SectionCurvesPayload = z.infer<typeof SectionCurvesPayloadSchema>;
export type SemanticTopology = z.infer<typeof SemanticTopologySchema>;
