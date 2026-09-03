import { describe, expect, it } from "vitest";

import { analysisRenderField } from "./analysis-render-field";

const analysis = {
  displacement: new Float32Array([0, 4]),
  stress: new Float32Array([0, 40]),
  cases: {
    "roll-differential": {
      displacement: new Float32Array([0, 2]),
      displacementVectorsM: new Float32Array([0, 0, 0, .001, -.002, .003]),
      stress: new Float32Array([0, 10]),
    },
  },
};

const topology = {
  solver: "sparse-simp-lattice-wasm" as const,
  initialCompliance: 10,
  finalCompliance: 4,
  maxDisplacement: 4,
  maxStress: 40,
  minimumSafetyFactor: 2,
  materialFraction: 0.5,
  iterations: 8,
};

describe("analysisRenderField", () => {
  it("preserves one physical scale across the envelope and every load case", () => {
    const stress = analysisRenderField(analysis, topology, "stress");
    const displacement = analysisRenderField(analysis, topology, "displacement");
    const safety = analysisRenderField(analysis, topology, "safety");

    expect(displacement.kind).toBe("displacement-magnitude");
    expect(displacement.maximum).toBe(4);
    expect(displacement.cases?.["roll-differential"]?.maximum).toBe(4);
    expect(stress.cases?.["roll-differential"]?.maximum).toBe(40);
    expect(stress.cases?.["roll-differential"]?.deformation).toMatchObject({
      displacementUnit: "mm", sourceDisplacementUnit: "m",
      maximum: expect.closeTo(Math.hypot(1, -2, 3)),
    });
    expect([...stress.cases!["roll-differential"]!.deformation!.vectors])
      .toEqual([0, 0, 0, 1, -2, 3]);
    expect(safety.cases?.["roll-differential"]?.maximum).toBe(1);
    expect(safety.cases?.["roll-differential"]?.values[1]).toBe(0.125);
  });
});
