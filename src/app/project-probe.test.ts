import { expect, it } from "vitest";

import type { ProbeResult } from "../gpu/compute-probe";
import { storeProbeResult } from "./project-probe";

it("stores signed per-case displacement vectors without retaining worker buffers", () => {
  const displacementVectorsM = new Float32Array([-0.001, 0, 0.002]);
  const source: ProbeResult = {
    status: "estimate",
    truthLevel: "interactive-estimate",
    output: new Float32Array([1]),
    elapsedMs: 1,
    relativeL2: 0,
    tolerance: 0,
    analysis: {
      displacement: new Float32Array([0.002]),
      stress: new Float32Array([1]),
      cases: {
        load: {
          displacement: new Float32Array([0.002]),
          displacementVectorsM,
          stress: new Float32Array([1]),
        },
      },
    },
  };

  const stored = storeProbeResult(source);
  expect(stored.status === "estimate" && stored.analysis?.cases?.load?.displacementVectorsM)
    .toEqual(new Float32Array([-0.001, 0, 0.002]));
  expect(stored.status === "estimate" && stored.analysis?.cases?.load?.displacementVectorsM)
    .not.toBe(displacementVectorsM);
  displacementVectorsM[0] = 9;
  expect(stored.status === "estimate" && stored.analysis?.cases?.load?.displacementVectorsM[0])
    .toBeCloseTo(-0.001);
});
