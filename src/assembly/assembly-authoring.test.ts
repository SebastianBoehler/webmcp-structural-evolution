import { describe, expect, it } from "vitest";

import { defineAssemblyDraft } from "../domain/assembly-model";
import { REFERENCE_DRONE_CATALOG, referenceComponent } from "../samples/reference-drone-catalog";
import {
  applyAssemblyAction,
  createAssemblyAuthoringState,
  solveAssemblyConstraints,
} from "./assembly-authoring";

const m = (value: number) => ({ value, unit: "m" as const });
const rad = (value: number) => ({ value, unit: "rad" as const });
const point = (x: number, y: number, z: number) => ({ x: m(x), y: m(y), z: m(z) });
const transform = (x: number, y: number, z: number, yaw = 0) => ({
  position: point(x, y, z),
  orientation: { roll: rad(0), pitch: rad(0), yaw: rad(yaw) },
});
const box = (id: string) => ({
  kind: "box" as const, id, center: point(0, 0, 0), size: point(0.24, 0.24, 0.024),
  orientation: { roll: rad(0), pitch: rad(0), yaw: rad(0) },
});

async function constrainedState() {
  const motor = referenceComponent("motor-2207");
  const armMount = referenceComponent("body-interface");
  const draft = await defineAssemblyDraft({
    id: "concentric-motor-mate",
    geometryCoordinates: "assembly",
    components: [
      { instanceId: "motor", componentRevision: motor.revision, quantity: 1, transform: transform(0, 0, 0) },
      { instanceId: "arm-mount", componentRevision: armMount.revision, quantity: 1, transform: transform(0.105, 0, 0.006, 0.25) },
    ],
    targetEnvelope: box("target"), preservedMounts: [], obstacleVolumes: [], accessVolumes: [],
    missingComponents: [], incompatibleComponents: [], ambiguousComponents: [],
  });
  const state = await createAssemblyAuthoringState(draft, REFERENCE_DRONE_CATALOG);
  return applyAssemblyAction(state, {
    kind: "constrain", parentRevision: state.revision,
    constraint: {
      id: "motor-axis-to-arm-mount", kind: "concentric",
      moving: { instanceId: "motor", interfaceId: "anchor" },
      fixed: { instanceId: "arm-mount", interfaceId: "anchor" },
    },
  });
}

async function applyConstraints(
  state: Awaited<ReturnType<typeof createAssemblyAuthoringState>>,
  constraints: readonly { readonly id: string; readonly moving: string; readonly fixed: string }[],
) {
  let next = state;
  for (const constraint of constraints) next = await applyAssemblyAction(next, {
    kind: "constrain", parentRevision: next.revision,
    constraint: {
      id: constraint.id, kind: "concentric",
      moving: { instanceId: constraint.moving, interfaceId: "anchor" },
      fixed: { instanceId: constraint.fixed, interfaceId: "anchor" },
    },
  });
  return next;
}

async function anchorDraft(id: string, positions: Readonly<Record<string, readonly [number, number, number]>>) {
  const mount = referenceComponent("body-interface");
  return defineAssemblyDraft({
    id, geometryCoordinates: "assembly",
    components: Object.entries(positions).map(([instanceId, position]) => ({
      instanceId, componentRevision: mount.revision, quantity: 1, transform: transform(...position),
    })),
    targetEnvelope: box("target"), preservedMounts: [], obstacleVolumes: [], accessVolumes: [],
    missingComponents: [], incompatibleComponents: [], ambiguousComponents: [],
  });
}

describe("assembly authoring", () => {
  it("mates a motor axis to the arm mount without guessed coordinates", async () => {
    const solved = solveAssemblyConstraints(await constrainedState());

    expect(solved.instances.motor?.transform.positionMm).toEqual([105, 0, 6]);
    expect(solved.instances.motor?.transform.orientationRad).toEqual([0, 0, 0.25]);
    expect(solved.unresolvedDegreesOfFreedom.motor).toEqual([]);
  });

  it("rejects an action whose parent revision is stale", async () => {
    const state = await constrainedState();

    await expect(applyAssemblyAction(state, {
      kind: "protect", parentRevision: "0".repeat(64),
      region: { id: "rotor-clearance", kind: "keep-out", volume: box("rotor-clearance") },
    })).rejects.toThrow(/parent revision is stale/i);
  });

  it("derives a new immutable revision when a protected region is added", async () => {
    const state = await constrainedState();
    const next = await applyAssemblyAction(state, {
      kind: "protect", parentRevision: state.revision,
      region: { id: "rotor-clearance", kind: "keep-out", volume: box("rotor-clearance") },
    });

    expect(next.revision).not.toBe(state.revision);
    expect(next.protectedRegions).toHaveLength(1);
    expect(next.branch).toMatchObject({ status: "staged", parentRevision: state.revision, revision: next.revision });
    expect(Object.isFrozen(next)).toBe(true);
  });

  it("propagates a mate chain even when dependent constraints sort first", async () => {
    const state = await createAssemblyAuthoringState(await anchorDraft("mate-chain", {
      root: [0.105, 0, 0.006], middle: [0, 0, 0], leaf: [0, 0, 0],
    }), REFERENCE_DRONE_CATALOG);
    const solved = solveAssemblyConstraints(await applyConstraints(state, [
      { id: "a-leaf-follows-middle", moving: "leaf", fixed: "middle" },
      { id: "z-middle-follows-root", moving: "middle", fixed: "root" },
    ]));

    expect(solved.instances.middle?.transform.positionMm).toEqual([105, 0, 6]);
    expect(solved.instances.leaf?.transform.positionMm).toEqual([105, 0, 6]);
  });

  it("reports conflicting and cyclic mates instead of claiming them solved", async () => {
    const state = await createAssemblyAuthoringState(await anchorDraft("invalid-mates", {
      left: [0.1, 0, 0], right: [0.2, 0, 0], moving: [0, 0, 0], "cycle-a": [0, 0, 0], "cycle-b": [0, 0, 0],
    }), REFERENCE_DRONE_CATALOG);
    const solved = solveAssemblyConstraints(await applyConstraints(state, [
      { id: "moving-to-left", moving: "moving", fixed: "left" },
      { id: "moving-to-right", moving: "moving", fixed: "right" },
      { id: "cycle-a", moving: "cycle-a", fixed: "cycle-b" },
      { id: "cycle-b", moving: "cycle-b", fixed: "cycle-a" },
    ]));

    expect(solved.constraintConflicts.map(({ kind }) => kind)).toEqual(["constraint-conflict", "constraint-cycle"]);
    expect(solved.unresolvedDegreesOfFreedom.moving).toEqual(["x", "y", "z", "roll", "pitch", "yaw"]);
  });

  it("gives equivalent constraint insertion orders one canonical revision", async () => {
    const draft = await anchorDraft("canonical-constraints", { root: [0.105, 0, 0.006], middle: [0, 0, 0], leaf: [0, 0, 0] });
    const first = await applyConstraints(await createAssemblyAuthoringState(draft, REFERENCE_DRONE_CATALOG), [
      { id: "a-leaf-follows-middle", moving: "leaf", fixed: "middle" },
      { id: "z-middle-follows-root", moving: "middle", fixed: "root" },
    ]);
    const second = await applyConstraints(await createAssemblyAuthoringState(draft, REFERENCE_DRONE_CATALOG), [
      { id: "z-middle-follows-root", moving: "middle", fixed: "root" },
      { id: "a-leaf-follows-middle", moving: "leaf", fixed: "middle" },
    ]);

    expect(first.revision).toBe(second.revision);
    expect(first.constraints.map(({ id }) => id)).toEqual(["a-leaf-follows-middle", "z-middle-follows-root"]);
  });
});
