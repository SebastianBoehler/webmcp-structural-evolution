import { describe, expect, it } from "vitest";

import { serializeAcceptedTopologyStl } from "./topology-stl";

describe("serializeAcceptedTopologyStl", () => {
  it("blocks an eligible Task 4 preview until Task 5 promotion", () => {
    const candidate = {
      acceptance: {
        eligible: true, accepted: false, exportable: false,
        promotionRequired: "task-5-live-gate", reasons: [],
      },
    };
    expect(() => serializeAcceptedTopologyStl(candidate as never)).toThrow(/promoted accepted/i);
  });

  it("rejects caller-forged acceptance flags without Task 5 evidence", () => {
    const forged = {
      acceptance: {
        eligible: true, accepted: true, exportable: true,
        promotionRequired: "task-5-live-gate", reasons: [],
      },
      manufacturingMesh: {
        positionsM: new Float32Array([0, 0, 0]),
        triangles: new Uint32Array(), isoValue: 0.5, toleranceM: 1e-6,
      },
    };
    expect(() => serializeAcceptedTopologyStl(forged as never)).toThrow(/Task 5 promotion/i);
  });
});
