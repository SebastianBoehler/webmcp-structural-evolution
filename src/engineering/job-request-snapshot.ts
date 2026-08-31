import type { EngineeringSolveRequest } from "../cad/engineering-job-contract";

type IntrinsicGetter = (this: object) => unknown;
type IntrinsicMethod = (this: object) => object;
type IntrinsicNext = (this: object) => IteratorResult<unknown>;

const ownKeys = Reflect.ownKeys;
const getDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const clone = structuredClone;
const objectValues = Object.values;
const freeze = Object.freeze;
const arrayBufferIsView = ArrayBuffer.isView;
const arrayBufferByteLength = getter(ArrayBuffer.prototype, "byteLength");
const typedArrayBuffer = getter(getPrototypeOf(Uint8Array.prototype), "buffer");
const dataViewBuffer = getter(DataView.prototype, "buffer");
const sharedBufferByteLength = typeof SharedArrayBuffer === "undefined"
  ? undefined
  : getter(SharedArrayBuffer.prototype, "byteLength");
const mapEntries = Map.prototype.entries as unknown as IntrinsicMethod;
const setValues = Set.prototype.values as unknown as IntrinsicMethod;
const mapIteratorNext = iteratorNext(mapEntries.call(new Map()));
const setIteratorNext = iteratorNext(setValues.call(new Set()));

function getter(prototype: object, key: PropertyKey): IntrinsicGetter {
  const descriptor = getDescriptor(prototype, key);
  if (!descriptor?.get) throw new Error(`Missing intrinsic getter: ${String(key)}`);
  return descriptor.get as IntrinsicGetter;
}

function iteratorNext(iterator: object): IntrinsicNext {
  const descriptor = getDescriptor(getPrototypeOf(iterator), "next");
  if (typeof descriptor?.value !== "function") throw new Error("Missing intrinsic iterator next");
  return descriptor.value as IntrinsicNext;
}

function isObject(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

function isSharedBuffer(value: object): boolean {
  if (!sharedBufferByteLength) return false;
  try {
    sharedBufferByteLength.call(value);
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

function isSharedView(value: object): boolean {
  if (!arrayBufferIsView(value)) return false;
  try {
    const backing = typedArrayBuffer.call(value);
    return isObject(backing) && isSharedBuffer(backing);
  } catch {
    try {
      const backing = dataViewBuffer.call(value);
      return isObject(backing) && isSharedBuffer(backing);
    } catch {
      return true;
    }
  }
}

function mapIterator(value: object): object | undefined {
  try {
    return mapEntries.call(value);
  } catch {
    return undefined;
  }
}

function setIterator(value: object): object | undefined {
  try {
    return setValues.call(value);
  } catch {
    return undefined;
  }
}

function containsMapSharedMemory(value: object, seen: WeakSet<object>): boolean | undefined {
  const iterator = mapIterator(value);
  if (!iterator) return undefined;
  while (true) {
    const step = mapIteratorNext.call(iterator);
    if (step.done) return false;
    const pair = step.value as { readonly 0: unknown; readonly 1: unknown };
    if (containsSharedMemory(pair[0], seen) || containsSharedMemory(pair[1], seen)) return true;
  }
}

function containsSetSharedMemory(value: object, seen: WeakSet<object>): boolean | undefined {
  const iterator = setIterator(value);
  if (!iterator) return undefined;
  while (true) {
    const step = setIteratorNext.call(iterator);
    if (step.done) return false;
    if (containsSharedMemory(step.value, seen)) return true;
  }
}

function containsSharedMemory(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!isObject(value) || seen.has(value)) return false;
  if (isSharedBuffer(value) || isSharedView(value)) return true;
  seen.add(value);
  const mapResult = containsMapSharedMemory(value, seen);
  if (mapResult === true) return true;
  if (mapResult === undefined && containsSetSharedMemory(value, seen) === true) return true;
  for (const key of ownKeys(value)) {
    const descriptor = getDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return true;
    if (containsSharedMemory(descriptor.value, seen)) return true;
  }
  return false;
}

function freezeOwned(value: unknown, seen = new WeakSet<object>()): void {
  if (!isObject(value) || seen.has(value)) return;
  seen.add(value);
  if (isArrayBuffer(value) || arrayBufferIsView(value)) return;
  for (const child of objectValues(value)) freezeOwned(child, seen);
  freeze(value);
}

export function captureEngineeringSolveRequest<Input>(
  request: EngineeringSolveRequest<Input>,
): EngineeringSolveRequest<Input> {
  if (containsSharedMemory(request)) {
    throw new Error("Solve request state cannot contain SharedArrayBuffer-backed memory");
  }
  const snapshot = clone(request) as EngineeringSolveRequest<Input>;
  if (containsSharedMemory(snapshot)) {
    throw new Error("Solve request snapshot cannot retain SharedArrayBuffer-backed memory");
  }
  freezeOwned(snapshot);
  return snapshot;
}

export function hasBoundDocumentRevision(request: EngineeringSolveRequest<unknown>): boolean {
  return request.document.revision === request.sourceRevision;
}
