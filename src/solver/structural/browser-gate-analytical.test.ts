import { describe, expect, it } from "vitest";

import { analyticalEvidence } from "./browser-gate-analytical";

const encoded = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));

function fixture(nodes = Uint32Array.from([1, 3])) {
  const expected = 1_000 * .1 / (70e9 * .01 * .01);
  const displacementM = new Float32Array(12);
  displacementM[0] = 1; // A larger unrelated global maximum must not affect the measurement.
  displacementM[3] = expected * .99;
  displacementM[9] = expected * 1.01;
  const face = (id: string) => ({
    id, bodyId: "body", signature: {
      ownerFeatureId: "extrude", kind: "face", geometry: "plane",
      centroidM: [0, 0, 0], measureSI: 1, adjacentKinds: [],
    },
  });
  const document = {
    namedSelections: ["fixed", "loaded"].map((id) => ({
      id, reference: {
        bodyId: "body", ownerFeatureId: "extrude", expectedKind: "face",
        stableId: `${id}-face`, signature: face(`${id}-face`).signature,
      },
    })),
    materials: [{ id: "material", kind: "isotropic", youngsModulusPa: 70e9 }],
    studies: [{
      id: "structural", kind: "structural-linear", materialId: "material",
      supports: ["fixed"], loads: [{ selectionId: "loaded", forceN: [1_000, 0, 0] }],
    }],
  };
  return {
    benchmark: {
      definition: { id: "axial", sizeM: [.1, .01, .01], cellSizeM: .005, forceN: [1_000, 0, 0] },
      structuralRequest: { studyId: "structural", document, input: {
        semanticMeshPayload: { faces: [face("fixed-face"), face("loaded-face")] },
        voxelPayload: {
          selectionTopologyIdsUtf8: encoded(["fixed-face", "loaded-face"]),
          selectionNodeOffsets: Uint32Array.from([0, 1, 1 + nodes.length]),
          selectionNodeIndices: Uint32Array.from([0, ...nodes]),
        },
      } },
    } as never,
    result: { displacementM } as never,
    expected,
  };
}

describe("live analytical structural evidence", () => {
  it("averages only the canonical loaded-end displacement component", () => {
    const { benchmark, result, expected } = fixture();
    expect(analyticalEvidence(benchmark, result)).toMatchObject({
      component: "x", loadedNodeCount: 2,
      measuredDisplacementM: expect.closeTo(expected, 8), relativeError: expect.closeTo(0, 6),
    });
  });

  it("fails closed when the revision-owned loaded selection has no solver nodes", () => {
    const { benchmark, result } = fixture(new Uint32Array());
    expect(() => analyticalEvidence(benchmark, result)).toThrow(/no solver nodes/i);
  });
});
