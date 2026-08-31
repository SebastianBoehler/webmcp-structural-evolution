import { ArtifactRecordSchema, type ArtifactRecord } from "../cad/artifact-contract";

export type ArtifactPayload = ArrayBuffer | Readonly<Record<string, ArrayBufferView>>;

export type ArtifactStoreErrorCode =
  | "content-digest-mismatch"
  | "duplicate-artifact-id"
  | "invalid-artifact-record"
  | "unsafe-payload";

export class ArtifactStoreError extends Error {
  readonly code: ArtifactStoreErrorCode;

  constructor(code: ArtifactStoreErrorCode, message: string) {
    super(message);
    this.name = "ArtifactStoreError";
    this.code = code;
  }
}

export interface ArtifactStore {
  put(record: ArtifactRecord, payload: ArtifactPayload): Promise<void>;
  get(id: string): Promise<ArtifactPayload | undefined>;
  delete(ids: readonly string[]): Promise<void>;
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

type StoredView = Readonly<{
  key: string;
  kind: ViewKind;
  value: ArrayBufferView;
}>;
type StoredPayload =
  | Readonly<{ kind: "bytes"; bytes: ArrayBuffer }>
  | Readonly<{ kind: "views"; views: readonly StoredView[] }>;
type StoredArtifact = Readonly<{
  record: ArtifactRecord;
  payload: StoredPayload;
  payloadDigest: string;
}>;

const encoder = new TextEncoder();

function resizable(buffer: ArrayBuffer): boolean {
  return (buffer as ArrayBuffer & { readonly resizable?: boolean }).resizable === true;
}

function viewKind(value: ArrayBufferView): ViewKind {
  if (value instanceof DataView) return "DataView";
  if (value instanceof Int8Array) return "Int8Array";
  if (value instanceof Uint8Array) return "Uint8Array";
  if (value instanceof Uint8ClampedArray) return "Uint8ClampedArray";
  if (value instanceof Int16Array) return "Int16Array";
  if (value instanceof Uint16Array) return "Uint16Array";
  if (value instanceof Int32Array) return "Int32Array";
  if (value instanceof Uint32Array) return "Uint32Array";
  if (typeof Float16Array !== "undefined" && value instanceof Float16Array) return "Float16Array";
  if (value instanceof Float32Array) return "Float32Array";
  if (value instanceof Float64Array) return "Float64Array";
  if (value instanceof BigInt64Array) return "BigInt64Array";
  if (value instanceof BigUint64Array) return "BigUint64Array";
  throw new ArtifactStoreError("unsafe-payload", "Artifact payload contains an unsupported typed view");
}

function payloadBuffer(view: ArrayBufferView): ArrayBuffer {
  if (!(view.buffer instanceof ArrayBuffer)) {
    throw new ArtifactStoreError("unsafe-payload", "Artifact payload views cannot use shared backing buffers");
  }
  if (resizable(view.buffer)) {
    throw new ArtifactStoreError("unsafe-payload", "Artifact payload views cannot use resizable backing buffers");
  }
  return view.buffer;
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

function normalizePayload(payload: ArtifactPayload): StoredPayload {
  if (payload instanceof ArrayBuffer) {
    if (resizable(payload)) {
      throw new ArtifactStoreError("unsafe-payload", "Artifact payload cannot use a resizable backing buffer");
    }
    return { kind: "bytes", bytes: payload.slice(0) };
  }
  if (!payload || typeof payload !== "object" || Object.getPrototypeOf(payload) !== Object.prototype) {
    throw new ArtifactStoreError("unsafe-payload", "Artifact payload must be an ArrayBuffer or a plain structured view map");
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
    const value = descriptor.value;
    const buffer = payloadBuffer(value);
    if (buffers.has(buffer)) {
      throw new ArtifactStoreError("unsafe-payload", "Artifact payload views cannot alias one backing buffer");
    }
    buffers.add(buffer);
    const kind = viewKind(value);
    views.push({ key, kind, value: copyView(value, kind) });
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
  const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

async function digestStoredPayload(payload: StoredPayload): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto SHA-256 is unavailable");
  const input = payload.kind === "bytes" ? payload.bytes : canonicalViewMapBytes(payload.views);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", input));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function copyStoredPayload(payload: StoredPayload): ArtifactPayload {
  if (payload.kind === "bytes") return payload.bytes.slice(0);
  const result: Record<string, ArrayBufferView> = {};
  for (const view of payload.views) result[view.key] = copyView(view.value, view.kind);
  return Object.freeze(result);
}

export async function digestArtifactPayload(payload: ArtifactPayload): Promise<string> {
  return digestStoredPayload(normalizePayload(payload));
}

export function createArtifactStore(): ArtifactStore {
  const artifacts = new Map<string, StoredArtifact>();
  return {
    async put(record, payload): Promise<void> {
      let verified: ArtifactRecord;
      try {
        verified = await ArtifactRecordSchema.parseAsync(record);
      } catch {
        throw new ArtifactStoreError("invalid-artifact-record", "Artifact metadata failed canonical identity verification");
      }
      const owned = normalizePayload(payload);
      const payloadDigest = await digestStoredPayload(owned);
      if (payloadDigest !== verified.contentDigest) {
        throw new ArtifactStoreError("content-digest-mismatch", "Artifact payload does not match its content digest");
      }
      const existing = artifacts.get(verified.id);
      if (existing) {
        if (existing.payloadDigest !== payloadDigest || existing.record.contentDigest !== verified.contentDigest) {
          throw new ArtifactStoreError("duplicate-artifact-id", `Artifact ID already stores different payload bytes: ${verified.id}`);
        }
        return;
      }
      artifacts.set(verified.id, { record: verified, payload: owned, payloadDigest });
    },
    async get(id): Promise<ArtifactPayload | undefined> {
      const stored = artifacts.get(id);
      return stored === undefined ? undefined : copyStoredPayload(stored.payload);
    },
    async delete(ids): Promise<void> {
      for (const id of new Set(ids)) artifacts.delete(id);
    },
  };
}

export async function synchronizeArtifactStoreInvalidation(
  store: ArtifactStore,
  invalidation: Readonly<{ invalidatedIds: readonly string[] }>,
): Promise<void> {
  await store.delete([...new Set(invalidation.invalidatedIds)].sort());
}
