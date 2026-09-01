import { assertCadResourceLimit } from "./cad-resource-limits";

type IntrinsicGetter = (this: object) => unknown;

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayBuffer = getter(typedArrayPrototype, "buffer");
const typedArrayByteLength = getter(typedArrayPrototype, "byteLength");
const typedArrayByteOffset = getter(typedArrayPrototype, "byteOffset");
const typedArrayTag = getter(typedArrayPrototype, Symbol.toStringTag);
const arrayBufferByteLength = getter(ArrayBuffer.prototype, "byteLength");
const arrayBufferResizable = optionalGetter(ArrayBuffer.prototype, "resizable");
const arrayBufferSlice = ArrayBuffer.prototype.slice;
const sharedBufferByteLength = typeof SharedArrayBuffer === "undefined"
  ? undefined
  : getter(SharedArrayBuffer.prototype, "byteLength");

function getter(prototype: object, key: PropertyKey): IntrinsicGetter {
  const candidate = Object.getOwnPropertyDescriptor(prototype, key)?.get;
  if (!candidate) throw new Error(`Missing intrinsic getter: ${String(key)}`);
  return candidate as IntrinsicGetter;
}

function optionalGetter(prototype: object, key: PropertyKey): IntrinsicGetter | undefined {
  return Object.getOwnPropertyDescriptor(prototype, key)?.get as IntrinsicGetter | undefined;
}

function isShared(buffer: object): boolean {
  if (!sharedBufferByteLength) return false;
  try {
    sharedBufferByteLength.call(buffer);
    return true;
  } catch {
    return false;
  }
}

function isArrayBuffer(value: object): boolean {
  try {
    arrayBufferByteLength.call(value);
    return true;
  } catch {
    return false;
  }
}

function fixedBufferLength(buffer: object): number {
  if (isShared(buffer)) throw new TypeError("Exact payload views cannot use shared backing memory");
  let byteLength: number;
  try {
    byteLength = arrayBufferByteLength.call(buffer) as number;
  } catch {
    throw new TypeError("Exact payload views require ArrayBuffer backing");
  }
  if (arrayBufferResizable?.call(buffer) === true) {
    throw new TypeError("Exact payload views cannot use resizable backing buffers");
  }
  try {
    arrayBufferSlice.call(buffer as ArrayBuffer, 0, 0);
  } catch {
    throw new TypeError("Exact payload views cannot use detached backing buffers");
  }
  return byteLength;
}

interface FixedView {
  readonly buffer: ArrayBuffer;
  readonly byteLength: number;
  readonly tag: string;
}

function fixedView(value: unknown): FixedView {
  if (!value || typeof value !== "object" || !ArrayBuffer.isView(value)) {
    throw new TypeError("Exact payload value must be a typed array view");
  }
  let tag: string;
  let buffer: object;
  let byteLength: number;
  let byteOffset: number;
  try {
    tag = typedArrayTag.call(value) as string;
    buffer = typedArrayBuffer.call(value) as object;
    byteLength = typedArrayByteLength.call(value) as number;
    byteOffset = typedArrayByteOffset.call(value) as number;
  } catch {
    throw new TypeError("Exact payload value must be a supported typed array");
  }
  const bufferLength = fixedBufferLength(buffer);
  if (byteOffset !== 0 || byteLength !== bufferLength) {
    throw new TypeError("Exact payload views must own their entire backing buffer");
  }
  return { buffer: buffer as ArrayBuffer, byteLength, tag };
}

export function assertFixedOwnedView(value: unknown, expectedTag: string): void {
  const view = fixedView(value);
  if (view.tag !== expectedTag) {
    throw new TypeError(`Exact payload view must be ${expectedTag}`);
  }
}

export function inspectFixedOwnedPayload(value: unknown): number {
  const seen = new WeakSet<object>();
  const buffers = new Set<ArrayBuffer>();
  let byteLength = 0;
  const visit = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object") return;
    if (ArrayBuffer.isView(candidate)) {
      const view = fixedView(candidate);
      if (buffers.has(view.buffer)) throw new TypeError("Exact payload views cannot alias backing buffers");
      buffers.add(view.buffer);
      byteLength += view.byteLength;
      if (!Number.isSafeInteger(byteLength)) throw new TypeError("Exact payload byte usage is invalid");
      return;
    }
    if (isShared(candidate) || isArrayBuffer(candidate)) {
      throw new TypeError("Exact payloads must expose bytes through typed views");
    }
    if (seen.has(candidate)) return;
    seen.add(candidate);
    for (const child of Object.values(candidate)) visit(child);
  };
  visit(value);
  return byteLength;
}

export function assertFixedOwnedPayload(
  value: unknown,
  budget?: { readonly resource: string; readonly limit: number },
): void {
  const byteLength = inspectFixedOwnedPayload(value);
  if (budget) assertCadResourceLimit(budget.resource, byteLength, budget.limit);
}

function freezeMetadata(value: unknown, seen = new WeakSet<object>()): void {
  if (!value || typeof value !== "object" || seen.has(value) || ArrayBuffer.isView(value)) return;
  seen.add(value);
  for (const child of Object.values(value)) freezeMetadata(child, seen);
  Object.freeze(value);
}

export function captureFixedOwnedPayload<Value>(
  value: Value,
  budget?: { readonly resource: string; readonly limit: number },
): Value {
  assertFixedOwnedPayload(value, budget);
  const owned = structuredClone(value);
  freezeMetadata(owned);
  return owned;
}
