import { describe, expect, it } from "vitest";

import { minimumComplianceDirection } from "./topology-gpu";

describe("topology GPU numerical envelope", () => {
  it("retains material in the higher element-strain-energy region", () => {
    const direction = minimumComplianceDirection(
      new Float32Array([1, 9]), new Uint32Array([1, 1]),
    );
    expect(direction[0]).toBeLessThan(0);
    expect(direction[1]).toBeGreaterThan(0);
  });

  it("scans the full structural cell limit without spreading the sensitivity array", async () => {
    const count = 262_144;
    expect(() => minimumComplianceDirection(
      new Float32Array(count).fill(1), new Uint32Array(count).fill(1),
    )).not.toThrow();
  });
});
