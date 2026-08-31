import type { EngineeringSolveRequest } from "../cad/engineering-job-contract";

function isSharedBuffer(value: unknown): value is SharedArrayBuffer {
  return typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer;
}

function containsSharedMemory(value: unknown, seen = new WeakSet<object>()): boolean {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  if (isSharedBuffer(value)) return true;
  if (ArrayBuffer.isView(value) && isSharedBuffer(value.buffer)) return true;
  seen.add(value);
  if (value instanceof Map) {
    for (const [key, entry] of value) {
      if (containsSharedMemory(key, seen) || containsSharedMemory(entry, seen)) return true;
    }
  }
  if (value instanceof Set) {
    for (const entry of value) if (containsSharedMemory(entry, seen)) return true;
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor)) return true;
    if (containsSharedMemory(descriptor.value, seen)) return true;
  }
  return false;
}

function freezeOwned(value: unknown, seen = new WeakSet<object>()): void {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return;
  for (const child of Object.values(value)) freezeOwned(child, seen);
  Object.freeze(value);
}

export function captureEngineeringSolveRequest<Input>(
  request: EngineeringSolveRequest<Input>,
): EngineeringSolveRequest<Input> {
  if (containsSharedMemory(request)) {
    throw new Error("Solve request state cannot contain SharedArrayBuffer-backed memory");
  }
  const snapshot = structuredClone(request) as EngineeringSolveRequest<Input>;
  freezeOwned(snapshot);
  return snapshot;
}

export function hasBoundDocumentRevision(request: EngineeringSolveRequest<unknown>): boolean {
  return request.document.revision === request.sourceRevision;
}
