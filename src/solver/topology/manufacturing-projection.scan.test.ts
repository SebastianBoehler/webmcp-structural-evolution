import { beforeEach, describe, expect, it, vi } from "vitest";

const instrumentation = vi.hoisted(() => ({ globalScans: 0 }));
vi.mock("./minimum-feature", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./minimum-feature")>();
  return { ...actual, topologyMinimumFeatureOffenders: (...args: Parameters<
    typeof actual.topologyMinimumFeatureOffenders
  >) => {
    instrumentation.globalScans += 1;
    return actual.topologyMinimumFeatureOffenders(...args);
  } };
});

import { projectManufacturingMask } from "./manufacturing-projection";

beforeEach(() => { instrumentation.globalScans = 0; });

describe("manufacturing projection scan cost", () => {
  it("globally scans for initial offenders only, not after each deletion", () => {
    const dimensions = [3, 3, 2] as const, count = 18;
    const requiredInterfaces = [
      { id: "left", cellIndices: new Uint32Array([3, 12]) },
      { id: "right", cellIndices: new Uint32Array([5, 14]) },
    ];
    const required = new Set(requiredInterfaces.flatMap(({ cellIndices }) => [...cellIndices]));
    const scores = new Float32Array(count).fill(.8);
    scores[0] = 0; scores[2] = .1;

    const mask = projectManufacturingMask({
      scores, previousMask: new Uint8Array(count).fill(1),
      designDomain: new Uint32Array(count).fill(1), required,
      protectedCells: new Set(), removalQuota: 2, moveBudget: 2,
      dimensions, minimumFeatureM: .02, cellSizeM: .01, requiredInterfaces,
    });

    expect(mask.reduce((sum, value) => sum + value, 0)).toBe(16);
    expect(instrumentation.globalScans).toBe(1);
  });
});
