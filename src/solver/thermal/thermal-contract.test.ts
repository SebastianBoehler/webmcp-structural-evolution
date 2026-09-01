import { describe, expect, it } from "vitest";

import {
  DEFAULT_THERMAL_COMPILE_LIMITS,
  harmonicConductivityWmK,
  THERMAL_VOXEL_MEDIA_TYPE,
  THERMAL_VOXEL_PRODUCER,
} from "./thermal-contract";

describe("thermal contract", () => {
  it("declares exact-grid media types and bounded compile limits", () => {
    expect(THERMAL_VOXEL_MEDIA_TYPE).toBe("application/vnd.structural-evolution.thermal-voxel-domain-v1");
    expect(THERMAL_VOXEL_PRODUCER).toEqual({ name: "thermal-voxelizer", version: "1" });
    expect(DEFAULT_THERMAL_COMPILE_LIMITS).toMatchObject({ maxCells: expect.any(Number) });
  });

  it("uses harmonic conductivity at a material interface", () => {
    expect(harmonicConductivityWmK(200, 20)).toBeCloseTo(36.36363636, 8);
  });
});
