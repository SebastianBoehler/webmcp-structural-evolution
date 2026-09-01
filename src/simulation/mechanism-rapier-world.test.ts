import * as RAPIER from "@dimforge/rapier3d-deterministic-compat";
import { beforeAll, describe, expect, test, vi } from "vitest";

import {
  captureClearanceSamples, captureContactEvents, captureInitialContactEvents,
} from "./mechanism-rapier-contacts";
import { createRapierState, type RapierState } from "./mechanism-rapier-world";
import { mechanismSolverInput } from "./mechanism-solver.test-support";

beforeAll(async () => { await RAPIER.init(); });

describe("Rapier mechanism world mapping", () => {
  test("preserves full uint32 collision masks with worker physics hooks", async () => {
    const input = await mechanismSolverInput({
      colliders: [
        { ...(await mechanismSolverInput()).colliders[0], membershipMask: 0x1_0000, filterMask: 0x1_0000 },
        { ...(await mechanismSolverInput()).colliders[1], membershipMask: 0x2_0000, filterMask: 0x2_0000 },
      ],
    });
    const state = createRapierState(RAPIER, input);
    try {
      const ground = state.colliders.get("ground-collider")!;
      const link = state.colliders.get("link-collider")!;
      expect(state.physicsHooks.filterContactPair(ground.handle, link.handle, 0, 0)).toBeNull();
      expect(() => state.physicsHooks.filterContactPair(ground.handle, 999_999, 0, 0))
        .toThrow("unknown collider mask");
      expect(ground.activeHooks()).toBe(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
      expect(ground.collisionGroups()).toBe(0xffff_ffff);
    } finally { state.world.free(); }
  });

  test("fails closed when Rapier contact traversal returns an unknown collider handle", async () => {
    const base = await mechanismSolverInput();
    const input = await mechanismSolverInput({ bodies: [
      { ...base.bodies[0], transform: { positionM: [0, -0.5, 0], orientation: [0, 0, 0, 1] } },
      { ...base.bodies[1], transform: { positionM: [0, 0.24, 0], orientation: [0, 0, 0, 1] } },
    ] });
    const state = createRapierState(RAPIER, input);
    try {
      vi.spyOn(state.world, "contactPairsWith").mockImplementation((_collider, callback) => {
        callback({ handle: 999_999 } as RAPIER.Collider);
      });
      expect(() => captureContactEvents({ ...state, colliderIdsByHandle: new Map() }, 1, new Map(), []))
        .toThrow("unknown collider handle");
    } finally { state.world.free(); }
  });

  test("canonicalizes collider order and normal when numeric handles are reversed", () => {
    const first = { handle: 20, contactCollider: () => ({ distance: -0.1,
      point1: { x: 1, y: 0, z: 0 }, normal1: { x: 1, y: 0, z: 0 } }) } as unknown as RAPIER.Collider;
    const second = { handle: 10, contactCollider: () => ({ distance: -0.1,
      point1: { x: 2, y: 0, z: 0 }, normal1: { x: -1, y: 0, z: 0 } }) } as unknown as RAPIER.Collider;
    const world = { timestep: 1, contactPairsWith: (collider: RAPIER.Collider,
      callback: (other: RAPIER.Collider) => void) => callback(collider.handle === first.handle ? second : first),
    contactPair: (_first: RAPIER.Collider, _second: RAPIER.Collider,
      callback: (manifold: { numContacts(): number }) => void) => callback({ numContacts: () => 0 }) };
    const state = { world, colliders: new Map([["a", first], ["b", second]]),
      colliderIdsByHandle: new Map([[20, "a"], [10, "b"]]),
      collisionMasks: new Map([[20, { membership: 1, filter: 1 }], [10, { membership: 1, filter: 1 }]]) };
    const events: Parameters<typeof captureContactEvents>[3] = [];
    captureContactEvents(state as unknown as RapierState, 1, new Map(), events);
    expect(events).toEqual([expect.objectContaining({ firstColliderId: "a", secondColliderId: "b",
      pointM: [1, 0, 0], normalWorld: [1, 0, 0] })]);
  });

  test("uses a finite f32 prediction that resolves far-separated clearance", async () => {
    const base = await mechanismSolverInput();
    const input = await mechanismSolverInput({ bodies: [base.bodies[0], { ...base.bodies[1],
      transform: { positionM: [1e6, 1, 0], orientation: [0, 0, 0, 1] } }],
      clearancePairs: [{ id: "far", sourceQueryId: "gap",
        firstColliderId: "ground-collider", secondColliderId: "link-collider" }] });
    const state = createRapierState(RAPIER, input), samples: Parameters<typeof captureClearanceSamples>[3] = [];
    try {
      const query = vi.spyOn(state.colliders.get("ground-collider")!, "contactCollider");
      captureClearanceSamples(input, state, 0, samples);
      expect(Number.isFinite(Math.fround(query.mock.calls[0]![1]))).toBe(true);
      expect(samples[0]!.distanceM).toBeGreaterThan(9e5);
    } finally { state.world.free(); }
  });

  test("bounds step-zero pairwise contact queries before quadratic expansion", () => {
    const entries = Array.from({ length: 364 }, (_value, index) => {
      const id = `collider-${index.toString().padStart(3, "0")}`;
      return [id, { handle: index, contactCollider: () => null }] as const;
    });
    const state = { colliders: new Map(entries),
      colliderBodyIds: new Map(entries.map(([id], index) => [id, index < 182 ? "first" : "second"])),
      collisionMasks: new Map(entries.map(([, collider]) => [collider.handle, { membership: 1, filter: 1 }])) };
    expect(() => captureInitialContactEvents(state as unknown as RapierState, []))
      .toThrow("step-zero contact-pair budget exceeded");
  });

  test("rebases independently rotated local joint axes into one world-aligned Rapier axis", async () => {
    const base = await mechanismSolverInput();
    const quarterTurn = [0, 0, Math.SQRT1_2, Math.SQRT1_2] as const;
    const input = await mechanismSolverInput({
      bodies: [
        { ...base.bodies[0], transform: { positionM: [0, 0, 0], orientation: quarterTurn } },
        { ...base.bodies[1], transform: { positionM: [0, 0, 0], orientation: [0, 0, 0, 1] } },
      ],
      joints: [{ id: "slide", kind: "prismatic", firstBodyId: "ground", secondBodyId: "link",
        firstAnchorLocalM: [0, 0, 0], secondAnchorLocalM: [0, 0, 0],
        firstAxisLocal: [1, 0, 0], secondAxisLocal: [0, 1, 0], lowerM: -0.1, upperM: 0.2 }],
    });
    const state = createRapierState(RAPIER, input);
    try {
      const joint = state.joints.get("slide") as RAPIER.PrismaticImpulseJoint;
      expect(joint.type()).toBe(RAPIER.JointType.Prismatic);
      expect(joint.limitsEnabled()).toBe(true);
      expect(joint.limitsMin()).toBeCloseTo(-0.1);
      expect(joint.limitsMax()).toBeCloseTo(0.2);
      expect(joint.frameX1()).toMatchObject(joint.frameX2());
    } finally { state.world.free(); }
  });

  test("maps exact mass properties and the compiler-provided cylinder orientation without collider mass", async () => {
    const base = await mechanismSolverInput();
    const { geometryDigest: _digest, truthLevel: _truth, ...linkCollider } = base.colliders[1];
    const quarterTurn = [0, 0, Math.SQRT1_2, Math.SQRT1_2] as const;
    const cylinderTurn = [Math.SQRT1_2, 0, 0, Math.SQRT1_2] as const;
    const input = await mechanismSolverInput({
      bodies: [base.bodies[0], { ...base.bodies[1],
        transform: { positionM: [0, 1, 0], orientation: quarterTurn },
        principalInertiaFrameToBody: [0, 0, 0, 1] }],
      colliders: [base.colliders[0], { ...linkCollider,
        bodyLocalTransform: { positionM: [0, 0, 0], orientation: cylinderTurn },
        shape: { kind: "cylinder", halfHeightM: 0.5, radiusM: 0.25 } }],
    });
    const state = createRapierState(RAPIER, input);
    try {
      const body = state.bodies.get("link")!, collider = state.colliders.get("link-collider")!;
      expect(body.mass()).toBeCloseTo(2);
      expect(body.localCom().x).toBeCloseTo(0);
      expect(body.localCom().y).toBeCloseTo(0.25);
      expect(body.localCom().z).toBeCloseTo(0);
      const inertia = body.effectiveAngularInertia();
      expect(inertia.m11).toBeCloseTo(1.5);
      expect(inertia.m22).toBeCloseTo(1);
      expect(inertia.m33).toBeCloseTo(2);
      expect([inertia.m12, inertia.m13, inertia.m23]).toEqual([0, 0, 0]);
      expect(collider.mass()).toBe(0);
      expect(collider.rotation()).toMatchObject({ x: 0.5, y: 0.5, z: 0.5, w: 0.5 });
    } finally { state.world.free(); }
  });

  test.each([
    ["overflow", { transform: { positionM: [1e40, 1, 0], orientation: [0, 0, 0, 1] } }],
    ["positive underflow", { massKg: 1e-40 }],
  ])("fails closed before Rapier rounds %s engineering magnitudes", async (_label, replacement) => {
    const base = await mechanismSolverInput();
    const input = await mechanismSolverInput({ bodies: [base.bodies[0], { ...base.bodies[1],
      ...replacement }] });
    expect(() => createRapierState(RAPIER, input)).toThrow("representable range");
  });

  test.each(["rigid", "revolute"] as const)("constructs a bounded %s impulse joint", async (kind) => {
    const base = await mechanismSolverInput();
    const joint = kind === "rigid"
      ? { id: "joint", kind, firstBodyId: "ground", secondBodyId: "link",
        firstAnchorLocalM: [0, 0, 0], secondAnchorLocalM: [0, 0, 0],
        firstFrameOrientationBody: [0, 0, 0, 1], secondFrameOrientationBody: [0, 0, 0, 1] }
      : { id: "joint", kind, firstBodyId: "ground", secondBodyId: "link",
        firstAnchorLocalM: [0, 0, 0], secondAnchorLocalM: [0, 0, 0],
        firstAxisLocal: [0, 0, 1], secondAxisLocal: [0, 0, 1], lowerRad: -0.5, upperRad: 0.75 };
    const input = await mechanismSolverInput({
      bodies: [base.bodies[0], { ...base.bodies[1], transform: base.bodies[0].transform }], joints: [joint],
    });
    const state = createRapierState(RAPIER, input);
    try {
      expect(state.joints.get("joint")!.type()).toBe(kind === "rigid" ? RAPIER.JointType.Fixed : RAPIER.JointType.Revolute);
      if (kind === "revolute") {
        const runtime = state.joints.get("joint") as RAPIER.RevoluteImpulseJoint;
        expect(runtime.limitsMin()).toBeCloseTo(-0.5); expect(runtime.limitsMax()).toBeCloseTo(0.75);
      }
    } finally { state.world.free(); }
  });

  test("constructs dynamic convex-hull and fixed trimesh contracts", async () => {
    const base = await mechanismSolverInput();
    const tetra = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]] as const;
    const stripped = base.colliders.map(({ geometryDigest: _digest, truthLevel: _truth, ...collider }) => collider);
    const input = await mechanismSolverInput({ colliders: [
      { ...stripped[0], approximation: { kind: "fixed-trimesh", maximumSurfaceDeviationM: 0.001 },
        shape: { kind: "fixed-trimesh", verticesM: tetra, triangles: [[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]] } },
      { ...stripped[1], approximation: { kind: "convex-hull", maximumSurfaceDeviationM: 0.001 },
        shape: { kind: "convex-hull", verticesM: tetra } },
    ] });
    const state = createRapierState(RAPIER, input);
    try {
      expect(state.colliders.get("ground-collider")!.shapeType()).toBe(RAPIER.ShapeType.TriMesh);
      expect(state.colliders.get("link-collider")!.shapeType()).toBe(RAPIER.ShapeType.ConvexPolyhedron);
    } finally { state.world.free(); }
  });
});
