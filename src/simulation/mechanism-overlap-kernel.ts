import type { OcctKernel, ShapeHandle } from "occt-wasm";

import { occtMatrix } from "../cad/rigid-transform";
import { MAX_EXACT_INITIAL_OVERLAP_BODY_PAIRS } from "./mechanism-limits";
import type { ExactPlacedInstance, ExactSourceBody } from "./mechanism-overlap-protocol";

export { MAX_EXACT_INITIAL_OVERLAP_BODY_PAIRS } from "./mechanism-limits";
const abortIfRequested = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException("Mechanism compilation was cancelled", "AbortError");
};
export function preflightExactOverlapPairs(instances: readonly ExactPlacedInstance[]): number {
  let pairCount = 0;
  for (let first = 0; first < instances.length; first += 1) {
    for (let second = first + 1; second < instances.length; second += 1) {
      pairCount += instances[first]!.bodyIds.length * instances[second]!.bodyIds.length;
      if (pairCount > MAX_EXACT_INITIAL_OVERLAP_BODY_PAIRS) {
        throw new Error("Exact initial-overlap body-pair budget exceeded");
      }
    }
  }
  return pairCount;
}

function disjoint(
  first: ReturnType<OcctKernel["getBoundingBox"]>,
  second: ReturnType<OcctKernel["getBoundingBox"]>,
): boolean {
  return first.xmax < second.xmin || second.xmax < first.xmin
    || first.ymax < second.ymin || second.ymax < first.ymin
    || first.zmax < second.zmin || second.zmax < first.zmin;
}

export async function checkExactInitialOverlapsWithKernel(
  kernel: OcctKernel,
  sourceBodies: readonly ExactSourceBody[],
  instances: readonly ExactPlacedInstance[],
  signal: AbortSignal,
): Promise<void> {
  abortIfRequested(signal);
  preflightExactOverlapPairs(instances);
  const shapes = new Map<string, ShapeHandle>();
  for (const body of sourceBodies) {
    abortIfRequested(signal);
    shapes.set(body.bodyId, kernel.fromBREPBinary(body.brepBytes));
  }
  for (let first = 0; first < instances.length; first += 1) {
    for (let second = first + 1; second < instances.length; second += 1) {
      const left = instances[first]!, right = instances[second]!;
      for (const leftBodyId of left.bodyIds) for (const rightBodyId of right.bodyIds) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        abortIfRequested(signal);
        const mark = kernel.checkpoint();
        try {
          const leftWorld = kernel.located(shapes.get(leftBodyId)!, occtMatrix(left.transform));
          const rightWorld = kernel.located(shapes.get(rightBodyId)!, occtMatrix(right.transform));
          if (disjoint(kernel.getBoundingBox(leftWorld), kernel.getBoundingBox(rightWorld))) continue;
          const common = kernel.common(leftWorld, rightWorld);
          const volume = kernel.isNull(common) ? 0 : kernel.getVolume(common);
          if (!Number.isFinite(volume) || volume > 0) {
            throw new Error(`Initial positive-volume overlap between ${left.instanceId} and ${right.instanceId}`);
          }
        } finally {
          kernel.releaseSince(mark);
        }
      }
    }
  }
}
