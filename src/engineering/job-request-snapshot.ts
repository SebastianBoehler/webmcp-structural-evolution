import type { EngineeringSolveRequest } from "../cad/engineering-job-contract";

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
  const snapshot = structuredClone(request) as EngineeringSolveRequest<Input>;
  freezeOwned(snapshot);
  return snapshot;
}

export function hasBoundDocumentRevision(request: EngineeringSolveRequest<unknown>): boolean {
  return request.document.revision === request.sourceRevision;
}
