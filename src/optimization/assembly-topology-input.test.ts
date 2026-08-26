import { describe, expect, it } from "vitest";

import { initialDroneWorkspace } from "../assembly/drone-workspace";
import { compileLiveTopologyContext } from "./assembly-topology-input";

describe("compileLiveTopologyContext", () => {
  it("derives the physical FPV solver domain, supports, loads, and keep-outs from the live assembly", () => {
    const context = compileLiveTopologyContext(initialDroneWorkspace);

    expect(context.grid.dimensions).toEqual({ width: 48, height: 48, depth: 12 });
    expect(context.input.motorMounts).toHaveLength(4);
    expect(context.input.supports).not.toHaveLength(0);
    expect(context.input.protectedVoids).not.toHaveLength(0);
    expect(context.input.motorMounts.map(({ centerM }) => centerM)).toContainEqual([0.105, 0, 0.003]);
    expect(context.input.material).toEqual({ youngsModulusPa: 3_500_000_000, failureStressPa: 50_000_000 });
  });
});
