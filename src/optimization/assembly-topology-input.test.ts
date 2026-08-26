import { describe, expect, it } from "vitest";

import { initialDroneWorkspace } from "../assembly/drone-workspace";
import { compileLiveTopologyContext } from "./assembly-topology-input";

describe("compileLiveTopologyContext", () => {
  it("derives the physical FPV solver domain, supports, loads, and keep-outs from the live assembly", () => {
    const context = compileLiveTopologyContext(initialDroneWorkspace);

    expect(context.grid.dimensions).toEqual({ width: 128, height: 128, depth: 32 });
    expect(context.input.motorMounts).toHaveLength(4);
    expect(context.input.supports).not.toHaveLength(0);
    expect(context.input.requiredSolids).toContainEqual(expect.objectContaining({ kind: "box", sizeM: [0.084, 0.05, 0.003] }));
    expect(context.input.protectedVoids).not.toHaveLength(0);
    const expectedProtectedVolumes = initialDroneWorkspace.draft.components.reduce((count, instance) => {
      const definition = initialDroneWorkspace.catalog.find(({ revision }) => revision === instance.componentRevision)!;
      if (definition.category === "body-interface") return count;
      expect(definition.collisionVolumes.length + definition.protectedVolumes.length).toBeGreaterThan(0);
      return count + definition.collisionVolumes.length + definition.protectedVolumes.length;
    }, 0);
    expect(context.input.protectedVoids).toHaveLength(expectedProtectedVolumes);
    expect(context.input.accessVoids).toHaveLength(22);
    expect(context.input.accessVoids.slice(0, 16).every((volume) =>
      volume.kind === "cylinder" && volume.radiusM === 0.00334 && volume.heightM === 0.024,
    )).toBe(true);
    expect(context.input.motorMounts.map(({ centerM }) => centerM)).toContainEqual([0.105, 0, 0]);
    expect(context.input.material).toEqual({ youngsModulusPa: 3_500_000_000, failureStressPa: 50_000_000 });
    expect(context.input.minimumLoadPathWidthM).toBe(0.005);
    expect(context.input.minimumFrameThicknessM).toBe(0.005);
    expect(context.input.loadPathGuides).toHaveLength(16);
    expect(context.input.loadPathGuides.every(({ pointsM }) => pointsM.length === 4)).toBe(true);
    expect(context.input.loadPathGuides.some(({ pointsM }) => pointsM.some(([, , z]) => z >= 0.01))).toBe(true);
    expect(context.input.accessVoids.filter((volume) =>
      volume.kind === "box" && volume.sizeM?.[0] === 0.024 && volume.sizeM[1] === 0.006,
    )).toHaveLength(4);
    const strapTopClearance = context.input.protectedVoids.find((volume) =>
      volume.kind === "box" && volume.sizeM?.[0] === 0.022 && volume.centerM[0] > 0,
    );
    expect(strapTopClearance?.centerM[0]).toBeCloseTo(0.022476, 9);
    expect(strapTopClearance?.centerM[1]).toBeCloseTo(-0.001524, 9);
    expect(strapTopClearance?.centerM[2]).toBeCloseTo(-0.0015, 9);
    expect(context.input.assemblyMassKg).toBeCloseTo(0.515, 3);
    expect(Math.hypot(context.input.centerOfMassM[0], context.input.centerOfMassM[1])).toBeLessThan(0.001);
  });
});
