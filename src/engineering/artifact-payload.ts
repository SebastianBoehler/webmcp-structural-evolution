export type ArtifactPayload = ArrayBuffer | ArrayBufferView | Readonly<Record<string, ArrayBufferView>>;

export type ArtifactStoreErrorCode =
  | "content-digest-mismatch"
  | "duplicate-artifact-id"
  | "invalid-artifact-record"
  | "unsafe-payload"
  | "commit-guard-rejected"
  | "commit-failed";

export class ArtifactStoreError extends Error {
  readonly code: ArtifactStoreErrorCode;

  constructor(code: ArtifactStoreErrorCode, message: string) {
    super(message);
    this.name = "ArtifactStoreError";
    this.code = code;
  }
}

type ViewKind =
  | "DataView"
  | "Int8Array"
  | "Uint8Array"
  | "Uint8ClampedArray"
  | "Int16Array"
  | "Uint16Array"
  | "Int32Array"
  | "Uint32Array"
  | "Float16Array"
  | "Float32Array"
  | "Float64Array"
  | "BigInt64Array"
  | "BigUint64Array";

type StoredView = Readonly<{ key: string; kind: ViewKind; value: ArrayBufferView }>;
export type StoredArtifactPayload =
  | Readonly<{ kind: "bytes"; bytes: ArrayBuffer }>
  | Readonly<{ kind: "view"; viewKind: ViewKind; value: ArrayBufferView }>
  | Readonly<{ kind: "views"; views: readonly StoredView[] }>;

const encoder = new TextEncoder();

function resizable(buffer: ArrayBuffer): boolean {
  return (buffer as ArrayBuffer & { readonly resizable?: boolean }).resizable === true;
}

function viewKind(value: ArrayBufferView): ViewKind {
  const tag = Object.prototype.toString.call(value).slice(8, -1) as ViewKind;
  if ([
    "DataView", "Int8Array", "Uint8Array", "Uint8ClampedArray", "Int16Array", "Uint16Array",
    "Int32Array", "Uint32Array", "Float16Array", "Float32Array", "Float64Array",
    "BigInt64Array", "BigUint64Array",
  ].includes(tag)) return tag;
  throw new ArtifactStoreError("unsafe-payload", "Artifact payload contains an unsupported typed view");
}

function payloadBuffer(view: ArrayBufferView): ArrayBuffer {
  if (Object.prototype.toString.call(view.buffer) !== "[object ArrayBuffer]") {
    throw new ArtifactStoreError("unsafe-payload", "Artifact payload views cannot use shared backing buffers");
  }
  const buffer = view.buffer as ArrayBuffer;
  if (resizable(buffer)) {
    throw new ArtifactStoreError("unsafe-payload", "Artifact payload views cannot use resizable backing buffers");
  }
  return buffer;
}

function copyView(value: ArrayBufferView, kind = viewKind(value)): ArrayBufferView {
  const source = payloadBuffer(value);
  const copy = new ArrayBuffer(value.byteOffset + value.byteLength);
  new Uint8Array(copy, value.byteOffset, value.byteLength)
    .set(new Uint8Array(source, value.byteOffset, value.byteLength));
  const length = value.byteLength;
  switch (kind) {
    case "DataView": return new DataView(copy, value.byteOffset, length);
    case "Int8Array": return new Int8Array(copy, value.byteOffset, length);
    case "Uint8Array": return new Uint8Array(copy, value.byteOffset, length);
    case "Uint8ClampedArray": return new Uint8ClampedArray(copy, value.byteOffset, length);
    case "Int16Array": return new Int16Array(copy, value.byteOffset, length / Int16Array.BYTES_PER_ELEMENT);
    case "Uint16Array": return new Uint16Array(copy, value.byteOffset, length / Uint16Array.BYTES_PER_ELEMENT);
    case "Int32Array": return new Int32Array(copy, value.byteOffset, length / Int32Array.BYTES_PER_ELEMENT);
    case "Uint32Array": return new Uint32Array(copy, value.byteOffset, length / Uint32Array.BYTES_PER_ELEMENT);
    case "Float16Array": return new Float16Array(copy, value.byteOffset, length / Float16Array.BYTES_PER_ELEMENT);
    case "Float32Array": return new Float32Array(copy, value.byteOffset, length / Float32Array.BYTES_PER_ELEMENT);
    case "Float64Array": return new Float64Array(copy, value.byteOffset, length / Float64Array.BYTES_PER_ELEMENT);
    case "BigInt64Array": return new BigInt64Array(copy, value.byteOffset, length / BigInt64Array.BYTES_PER_ELEMENT);
    case "BigUint64Array": return new BigUint64Array(copy, value.byteOffset, length / BigUint64Array.BYTES_PER_ELEMENT);
  }
}

function normalize(payload: ArtifactPayload): StoredArtifactPayload {
  if (payload instanceof ArrayBuffer) {
    if (resizable(payload)) throw new ArtifactStoreError("unsafe-payload", "Artifact payload cannot use a resizable backing buffer");
    return { kind: "bytes", bytes: payload.slice(0) };
  }
  if (ArrayBuffer.isView(payload)) {
    const kind = viewKind(payload);
    return { kind: "view", viewKind: kind, value: copyView(payload, kind) };
  }
  if (!payload || typeof payload !== "object" || Object.getPrototypeOf(payload) !== Object.prototype) {
    throw new ArtifactStoreError("unsafe-payload",
      "Artifact payload must be an ArrayBuffer, typed view, or plain structured view map");
  }
  const keys = Object.keys(payload).sort();
  if (Object.getOwnPropertyNames(payload).length !== keys.length || Object.getOwnPropertySymbols(payload).length > 0) {
    throw new ArtifactStoreError("unsafe-payload", "Artifact payload maps cannot contain hidden or symbol keys");
  }
  const buffers = new Set<ArrayBuffer>();
  const views: StoredView[] = [];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(payload, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor) || !ArrayBuffer.isView(descriptor.value)) {
      throw new ArtifactStoreError("unsafe-payload", `Artifact payload key must contain a typed view: ${key}`);
    }
    const buffer = payloadBuffer(descriptor.value);
    if (buffers.has(buffer)) throw new ArtifactStoreError("unsafe-payload", "Artifact payload views cannot alias one backing buffer");
    buffers.add(buffer);
    const kind = viewKind(descriptor.value);
    views.push({ key, kind, value: copyView(descriptor.value, kind) });
  }
  return { kind: "views", views };
}

function framedChunks(label: string, bytes: Uint8Array): readonly Uint8Array[] {
  return [encoder.encode(`${label}:${bytes.byteLength}:`), bytes];
}

function canonicalViewMapBytes(views: readonly StoredView[]): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  const append = (label: string, value: Uint8Array) => chunks.push(...framedChunks(label, value));
  append("artifact-view-map", encoder.encode(String(views.length)));
  for (const view of views) {
    append("key", encoder.encode(view.key));
    append("view-type", encoder.encode(view.kind));
    append("byte-offset", encoder.encode(String(view.value.byteOffset)));
    append("byte-length", encoder.encode(String(view.value.byteLength)));
    append("bytes", new Uint8Array(view.value.buffer, view.value.byteOffset, view.value.byteLength));
  }
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

async function digest(payload: StoredArtifactPayload): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto SHA-256 is unavailable");
  let input: ArrayBuffer | Uint8Array<ArrayBuffer>;
  if (payload.kind === "bytes") input = payload.bytes;
  else if (payload.kind === "view") {
    input = new Uint8Array(payloadBuffer(payload.value), payload.value.byteOffset, payload.value.byteLength);
  } else input = canonicalViewMapBytes(payload.views);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", input));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function representation(payload: StoredArtifactPayload): string {
  if (payload.kind === "bytes") return "raw:ArrayBuffer";
  if (payload.kind === "view") {
    return `raw:${payload.viewKind}:${payload.value.byteOffset}:${payload.value.byteLength}`;
  }
  return JSON.stringify(payload.views.map((view) => [
    view.key, view.kind, view.value.byteOffset, view.value.byteLength,
  ]));
}

function copy(payload: StoredArtifactPayload): ArtifactPayload {
  if (payload.kind === "bytes") return payload.bytes.slice(0);
  if (payload.kind === "view") return copyView(payload.value, payload.viewKind);
  const result: Record<string, ArrayBufferView> = {};
  for (const view of payload.views) {
    Object.defineProperty(result, view.key, {
      value: copyView(view.value, view.kind), enumerable: true, writable: false, configurable: false,
    });
  }
  return Object.freeze(result);
}

export const artifactPayloadInternals = Object.freeze({ normalize, digest, representation, copy });
