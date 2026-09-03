import { describe, expect, it } from "vitest";

import { initialDroneWorkspace } from "../assembly/drone-workspace";
import { compileLiveTopologyContext } from "./assembly-topology-input";

describe("compileLiveTopologyContext", () => {
  it("derives the physical FPV solver domain, supports, loads, and keep-outs from the live assembly", () => {
    const context = compileLiveTopologyContext(initialDroneWorkspace);

    expect(context.grid.dimensions).toEqual({ width: 128, height: 128, depth: 16 });
    expect(context.input.motorMounts).toHaveLength(4);
    expect(context.input.supports).not.toHaveLength(0);
    expect(context.input.requiredSolids).toContainEqual(expect.objectContaining({
      kind: "box", centerM: [-0.001524, -0.001524, -0.0015], sizeM: [0.084, 0.06, 0.003],
    }));
    expect(context.input.protectedVoids).not.toHaveLength(0);
    const expectedProtectedVolumes = initialDroneWorkspace.draft.components.reduce((count, instance) => {
      const definition = initialDroneWorkspace.catalog.find(({ revision }) => revision === instance.componentRevision)!;
      if (definition.category === "body-interface") return count;
      expect(definition.collisionVolumes.length + definition.protectedVolumes.length).toBeGreaterThan(0);
      return count + definition.collisionVolumes.length + definition.protectedVolumes.length;
    }, 0);
    expect(context.input.protectedVoids).toHaveLength(expectedProtectedVolumes);
    expect(context.input.accessVoids).toHaveLength(30);
    expect(context.input.accessVoids.slice(0, 16).every((volume) =>
      volume.kind === "cylinder" && volume.radiusM === 0.00334 && volume.heightM === 0.024,
    )).toBe(true);
    expect(context.input.motorMounts.map(({ centerM }) => centerM)).toContainEqual([0.105, 0, 0]);
    const motorInterfaces = context.input.requiredSolids.filter((volume) =>
      volume.kind === "cylinder" && volume.heightM === 0.005
      && context.input.motorMounts.some((mount) => mount.centerM.every((value, axis) =>
        value === volume.centerM[axis] && mount.radiusM === volume.radiusM)),
    );
    expect(motorInterfaces).toHaveLength(4);
    expect(context.input.material).toEqual({ youngsModulusPa: 3_500_000_000, failureStressPa: 50_000_000 });
    expect(context.input.minimumLoadPathWidthM).toBe(0.005);
    expect(context.input.minimumFrameThicknessM).toBe(0.005);
    expect(context.input.loadPathGuides).toHaveLength(16);
    expect(context.input.loadPathGuides.every(({ pointsM }) => pointsM.length === 4)).toBe(true);
    expect(context.input.loadPathGuides.some(({ pointsM }) => pointsM.some(([, , z]) => z >= 0.01))).toBe(true);
    const strapSlots = context.input.accessVoids.filter((volume) =>
      volume.kind === "box" && volume.sizeM?.[0] === 0.022 && volume.sizeM[1] === 0.005625,
    );
    expect(strapSlots).toHaveLength(4);
    const expectedSlotCenters = [
      [0, -0.023024],
      [0, 0.019976],
      [-0.031524, -0.023024],
      [-0.031524, 0.019976],
    ];
    strapSlots.forEach(({ centerM }, index) => {
      expect(centerM[0]).toBeCloseTo(expectedSlotCenters[index]![0]!, 12);
      expect(centerM[1]).toBeCloseTo(expectedSlotCenters[index]![1]!, 12);
    });
    expect(strapSlots.every((slot) => slot.sizeM?.[2] === 0.024 && slot.centerM[2] === 0)).toBe(true);
    const boardStackHoles = context.input.accessVoids.filter((volume) =>
      volume.kind === "cylinder"
      && volume.centerM[2] === 0
      && Math.abs(volume.centerM[0]) === 0.01525
      && Math.abs(volume.centerM[1]) === 0.01525,
    );
    expect(boardStackHoles).toHaveLength(4);
    expect(boardStackHoles.every((hole) =>
      hole.radiusM === 0.0028125 && hole.heightM === 0.024,
    )).toBe(true);
    const vtxMountHoles = context.input.accessVoids.filter((volume) =>
      volume.kind === "cylinder"
      && Math.hypot(volume.centerM[0] + 0.043, volume.centerM[1] + 0.043) > 0.013
      && Math.hypot(volume.centerM[0] + 0.043, volume.centerM[1] + 0.043) < 0.015,
    );
    expect(vtxMountHoles).toHaveLength(4);
    expect(context.input.requiredSolids).toContainEqual(expect.objectContaining({
      kind: "box", sizeM: [0.036, 0.036, 0.003], yawRad: Math.PI / 4,
    }));
    expect(context.input.requiredSolids).toContainEqual(expect.objectContaining({
      kind: "box", sizeM: [0.021, 0.021, 0.001], yawRad: Math.PI * 3 / 4,
    }));
    expect(context.input.requiredSolids.filter((volume) =>
      volume.kind === "box" && volume.sizeM?.[0] === 0.012 && volume.sizeM[1] === 0.003,
    )).toHaveLength(0);
    const cameraMountRails = context.input.requiredSolids.filter((volume) =>
      volume.kind === "box" && volume.sizeM?.[0] === 0.046 && volume.sizeM[2] === 0.020,
    );
    expect(cameraMountRails).toHaveLength(2);
    expect(context.input.requiredSolids).toContainEqual(expect.objectContaining({
      kind: "box", sizeM: [0.008, 0.030, 0.020], yawRad: Math.PI / 4,
    }));
    const strapTopClearance = context.input.protectedVoids.find((volume) =>
      volume.kind === "box" && volume.sizeM?.[0] === 0.022 && volume.centerM[0] === 0,
    );
    expect(strapTopClearance?.centerM[0]).toBeCloseTo(0, 9);
    expect(strapTopClearance?.centerM[1]).toBeCloseTo(-0.001524, 9);
    expect(strapTopClearance?.centerM[2]).toBeCloseTo(-0.0015, 9);
    expect(context.input.assemblyMassKg).toBeCloseTo(0.538444, 6);
    expect(context.input.inertialMasses.reduce((sum, item) => sum + item.massKg, 0)).toBeCloseTo(context.input.assemblyMassKg, 12);
    const batteryMass = context.input.inertialMasses.find(({ id }) => id === "battery");
    expect(batteryMass?.massKg).toBeCloseTo(0.254, 12);
    expect(batteryMass?.inertiaTensorKgM2[2][2]).toBeGreaterThan(0);
    expect(["fpv-camera", "video-transmitter", "video-antenna", "radio-receiver"].every((id) =>
      context.input.inertialMasses.some((mass) => mass.id === id && mass.massKg > 0))).toBe(true);
    expect(Math.hypot(context.input.centerOfMassM[0], context.input.centerOfMassM[1])).toBeLessThan(0.002);
  });
});
