import { describe, expect, it } from "vitest";

import { compileThermalStudy } from "./compile-thermal-study";
import { createThermalAnalyticalRequest } from "./thermal-analytical-request";

const compile = (request: Awaited<ReturnType<typeof createThermalAnalyticalRequest>>) => compileThermalStudy(
  request, { maxCells: 262_144, maxBoundaryFaces: 1_048_576, maxRelativeAreaError: 0.01 },
);

describe("thermal body ownership compilation", () => {
  it("derives conductivity from exact per-body material assignments", async () => {
    const request = await createThermalAnalyticalRequest({
      dimensions: [11, 1, 1], cellSizeM: 0.1,
      bodies: [
        { id: "conductive", materialId: "k10", conductivityWmK: 10 },
        { id: "insulating", materialId: "k1", conductivityWmK: 1 },
      ],
      cellBodyIndices: new Uint32Array([0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1]),
      boundaries: [
        { id: "cold", cellIndex: 0, axis: 0, direction: -1, areaM2: 0.01, temperatureK: 300 },
        { id: "hot", cellIndex: 10, axis: 0, direction: 1, areaM2: 0.01, temperatureK: 400 },
      ],
    });
    expect(Array.from((await compile(request)).conductivityWmK))
      .toEqual([10, 10, 10, 10, 10, 1, 1, 1, 1, 1, 1]);
  });

  it("rejects a stale table when a declared body owns no active voxel", async () => {
    const request = await createThermalAnalyticalRequest({
      dimensions: [2, 1, 1], cellSizeM: 0.1,
      bodies: [
        { id: "represented", materialId: "represented-material", conductivityWmK: 10 },
        { id: "missing", materialId: "missing-material", conductivityWmK: 1 },
      ],
      cellBodyIndices: new Uint32Array([0, 0]),
      boundaries: [
        { id: "cold", cellIndex: 0, axis: 0, direction: -1, areaM2: 0.01, temperatureK: 300 },
        { id: "hot", cellIndex: 1, axis: 0, direction: 1, areaM2: 0.01, temperatureK: 400 },
      ],
    });
    await expect(compile(request)).rejects.toThrow(/owns no active voxel/);
  });
});
