import { z } from "zod";

const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const id = z.string().min(1);
const vec3 = z.tuple([finite, finite, finite]);
const typedArray = <Value extends ArrayBufferView>(tag: string) => z.custom<Value>(
  (value) => Object.prototype.toString.call(value) === `[object ${tag}]`,
  `Expected ${tag}`,
);

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

export const SemanticMeshPayloadSchema = z.object({
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
  if (mesh.positionsM.length % 3 !== 0 || mesh.normals.length !== mesh.positionsM.length) {
    context.addIssue({ code: "custom", message: "Semantic mesh vertex buffers are inconsistent" });
  }
  if (mesh.indices.length % 3 !== 0 || mesh.triangleFaceIndices.length !== mesh.indices.length / 3) {
    context.addIssue({ code: "custom", message: "Semantic mesh triangle ownership is inconsistent" });
  }
  if ([...mesh.indices].some((index) => index >= mesh.positionsM.length / 3)
    || [...mesh.triangleFaceIndices].some((index) => index >= mesh.faces.length)) {
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
  if ([...mesh.polylineEdgeIndices].some((index) => index >= mesh.edges.length)) {
    context.addIssue({ code: "custom", message: "Semantic edge ownership is unavailable" });
  }
});

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

function framed(
  chunks: Uint8Array<ArrayBufferLike>[],
  label: string,
  bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(),
): void {
  chunks.push(encoder.encode(`${label}:${bytes.byteLength}:`), bytes);
}

function appendCanonical(value: unknown, chunks: Uint8Array<ArrayBufferLike>[]): void {
  if (value === null) return framed(chunks, "null");
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return framed(chunks, typeof value, encoder.encode(Object.is(value, -0) ? "-0" : String(value)));
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return framed(chunks, value.constructor.name, bytes);
  }
  if (Array.isArray(value)) {
    framed(chunks, `array-${value.length}`);
    for (const item of value) appendCanonical(item, chunks);
    return;
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    framed(chunks, `object-${keys.length}`);
    for (const key of keys) {
      framed(chunks, "key", encoder.encode(key));
      appendCanonical(record[key], chunks);
    }
    return;
  }
  throw new TypeError("CAD output payload is not transferable canonical data");
}

export async function digestCadOutputPayload(payload: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto SHA-256 is unavailable");
  const chunks: Uint8Array<ArrayBufferLike>[] = [];
  appendCanonical(payload, chunks);
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
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
