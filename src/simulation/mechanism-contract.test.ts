import { describe, expect, it } from "vitest";

import { revisionId } from "../domain/revisions";
import { defineMechanismInput } from "./mechanism-contract";

const digest = (character: string) => character.repeat(64);
const transform = (orientation: readonly [number, number, number, number] = [0, 0, 0, 1]) => ({
  positionM: [0, 0, 0] as const, orientation,
});

async function collider(id: string, bodyId: string, sourceBodyId: string, membershipMask: number) {
  const shapePayload = {
    bodyLocalTransform: transform(),
    approximation: { kind: "exact-primitive" as const, maximumSurfaceDeviationM: 0 },
    shape: { kind: "box" as const, halfExtentsM: [0.05, 0.01, 0.01] as const },
  };
  return {
    id, bodyId, sourceBodyId, sourceArtifactIds: [digest(bodyId === "link" ? "b" : "c")],
    ...shapePayload, geometryDigest: await revisionId(shapePayload),
    membershipMask, filterMask: membershipMask === 1 ? 2 : 1,
  };
}

export async function inputCandidate() {
  return {
    sourceRevision: digest("a"), studyId: "arm-motion",
    bodies: [
      {
        id: "link", kind: "dynamic" as const, sourceBodyIds: ["link-design"], transform: transform([0, -0, 0, 2]), massKg: 2,
        centerOfMassM: [0.05, 0, 0] as const, principalInertiaKgM2: [0.01, 0.02, 0.03] as const,
        principalInertiaFrameToBody: [0, 0, 1, 1] as const,
        initialLinearVelocityMps: [0, 0, 0] as const, initialAngularVelocityRadS: [0, 0, 0] as const,
      },
      { id: "base", kind: "fixed" as const, sourceBodyIds: ["base-design"], transform: transform() },
    ],
    colliders: [
      await collider("link-collider", "link", "link-design", 2),
      await collider("base-collider", "base", "base-design", 1),
    ],
    joints: [{
      id: "hinge", kind: "revolute" as const, firstBodyId: "base", secondBodyId: "link",
      firstAnchorLocalM: [0, 0, 0] as const, secondAnchorLocalM: [-0.05, 0, 0] as const,
      firstAxisLocal: [0, 0, 4] as const, secondAxisLocal: [0, 0, 2] as const,
      lowerRad: -1.2, upperRad: 1.2,
    }],
    gravityWorldMps2: [0, -9.81, 0] as const,
    pointForces: [{ bodyId: "link", pointLocalM: [0.1, 0, 0] as const, forceWorldN: [0, 5, 0] as const }],
    durationSteps: 480, outputStrideSteps: 4,
    clearancePairs: [{ id: "base-link-clearance", sourceQueryId: "base-link-clearance", firstColliderId: "base-collider", secondColliderId: "link-collider" }],
  };
}

describe("mechanism input contract", () => {
  it("defines a digest-bound, code-unit-sorted input and normalizes orientations and axes", async () => {
    const input = await defineMechanismInput(await inputCandidate());
    expect(input.truthLevel).toBe("unverified-mechanism-input");
    expect(input.bodies.map(({ id }) => id)).toEqual(["base", "link"]);
    expect(input.colliders.map(({ id }) => id)).toEqual(["base-collider", "link-collider"]);
    expect(input.bodies[1]?.transform.orientation).toEqual([0, 0, 0, 1]);
    const dynamic = input.bodies.find(({ kind }) => kind === "dynamic")!;
    if (dynamic.kind !== "dynamic") throw new Error("expected dynamic body");
    expect(dynamic.principalInertiaFrameToBody[2]).toBeCloseTo(Math.SQRT1_2, 15);
    expect(dynamic.principalInertiaFrameToBody[3]).toBeCloseTo(Math.SQRT1_2, 15);
    const [x, y, z, w] = dynamic.principalInertiaFrameToBody;
    const principalXAxisInBody = [
      1 - 2 * (y * y + z * z),
      2 * (x * y + w * z),
      2 * (x * z - w * y),
    ];
    expect(principalXAxisInBody[0]).toBeCloseTo(0, 15);
    expect(principalXAxisInBody[1]).toBeCloseTo(1, 15);
    expect(principalXAxisInBody[2]).toBeCloseTo(0, 15);
    expect(input.joints[0]).toMatchObject({
      kind: "revolute", firstAxisLocal: [0, 0, 1], secondAxisLocal: [0, 0, 1],
      lowerRad: -1.2, upperRad: 1.2,
    });
    expect(input.mechanismInputDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizes huge and subnormal quaternion and direction components without overflow or underflow", async () => {
    const candidate = await inputCandidate();
    const huge = Number.MAX_VALUE;
    const tiny = Number.MIN_VALUE;
    const input = await defineMechanismInput({
      ...candidate,
      bodies: candidate.bodies.map((body) => body.kind === "dynamic" ? {
        ...body, principalInertiaFrameToBody: [huge, huge, 0, 0],
      } : body),
      joints: [{ ...candidate.joints[0], firstAxisLocal: [huge, huge, 0], secondAxisLocal: [tiny, 0, 0] }],
    });
    const body = input.bodies.find(({ kind }) => kind === "dynamic")!;
    if (body.kind !== "dynamic") throw new Error("expected dynamic body");
    expect(body.principalInertiaFrameToBody[0]).toBeCloseTo(Math.SQRT1_2, 15);
    expect(body.principalInertiaFrameToBody[1]).toBeCloseTo(Math.SQRT1_2, 15);
    const joint = input.joints[0];
    if (!joint || joint.kind === "rigid") throw new Error("expected axial joint");
    expect(joint.firstAxisLocal[0]).toBeCloseTo(Math.SQRT1_2, 15);
    expect(joint.firstAxisLocal[1]).toBeCloseTo(Math.SQRT1_2, 15);
    expect(joint.secondAxisLocal).toEqual([1, 0, 0]);
  });

  it("issues recursively frozen input detached from caller-owned nested arrays", async () => {
    const candidate = await inputCandidate();
    const input = await defineMechanismInput(candidate);
    candidate.bodies[0]!.sourceBodyIds[0] = "mutated-source";
    expect(input.bodies[1]?.sourceBodyIds).toEqual(["link-design"]);
    expect(Object.isFrozen(input)).toBe(true);
    expect(Object.isFrozen(input.bodies)).toBe(true);
    expect(Object.isFrozen(input.bodies[0]?.transform.positionM)).toBe(true);
    expect(Object.isFrozen(input.joints)).toBe(true);
    expect(Object.isFrozen(input.colliders[0]?.sourceArtifactIds)).toBe(true);
    expect(() => (input.bodies as unknown as unknown[]).push({})).toThrow();
    expect(() => (input.joints[0]!.firstAnchorLocalM as unknown as number[])[0] = 99).toThrow();
  });

  it("supports explicit prismatic metre limits and rigid local anchors", async () => {
    const candidate = await inputCandidate();
    const common = {
      firstBodyId: "base", secondBodyId: "link",
      firstAnchorLocalM: [0, 0, 0] as const, secondAnchorLocalM: [0, 0, 0] as const,
    };
    await expect(defineMechanismInput({
      ...candidate,
      joints: [{ id: "slide", kind: "prismatic", ...common, firstAxisLocal: [2, 0, 0], secondAxisLocal: [4, 0, 0], lowerM: 0, upperM: 0.1 }],
    })).resolves.toMatchObject({ joints: [{ kind: "prismatic", firstAxisLocal: [1, 0, 0], secondAxisLocal: [1, 0, 0], lowerM: 0, upperM: 0.1 }] });
    await expect(defineMechanismInput({
      ...candidate, joints: [{
        id: "weld", kind: "rigid", ...common,
        firstFrameOrientationBody: [0, 0, 0, 2], secondFrameOrientationBody: [0, 0, 0, -2],
      }],
    })).resolves.toMatchObject({
      joints: [{ kind: "rigid", firstFrameOrientationBody: [0, 0, 0, 1], secondFrameOrientationBody: [0, 0, 0, 1] }],
    });
  });

  it("requires every body to have a collider and rejects dynamic trimesh", async () => {
    const candidate = await inputCandidate();
    await expect(defineMechanismInput({
      ...candidate, colliders: candidate.colliders.filter(({ bodyId }) => bodyId !== "link"),
    })).rejects.toThrow("Mechanism body has no collider: link");
    const linkCollider = candidate.colliders.find(({ bodyId }) => bodyId === "link")!;
    await expect(defineMechanismInput({
      ...candidate,
      colliders: candidate.colliders.map((value) => value === linkCollider ? {
        ...value,
        approximation: { kind: "fixed-trimesh", maximumSurfaceDeviationM: 0.001 },
        shape: { kind: "fixed-trimesh", verticesM: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], triangles: [[0, 1, 2]] },
      } : value),
    })).rejects.toThrow("Dynamic mechanism bodies cannot use fixed trimesh colliders");
    const baseCollider = candidate.colliders.find(({ bodyId }) => bodyId === "base")!;
    await expect(defineMechanismInput({
      ...candidate,
      colliders: candidate.colliders.map((value) => value.bodyId === "link"
        ? { ...baseCollider, id: "link-collider", bodyId: "link" }
        : value),
    })).rejects.toThrow("Collider source body is not declared by mechanism body: link-collider");
    await expect(defineMechanismInput({
      ...candidate,
      bodies: candidate.bodies.map((body) => body.id === "link"
        ? { ...body, sourceBodyIds: [...body.sourceBodyIds, "link-second-design"] }
        : body),
    })).rejects.toThrow("Mechanism source body has no collider: link-second-design");
  });

  it("rejects old ambiguous joint fields and invalid explicit limits", async () => {
    const candidate = await inputCandidate();
    await expect(defineMechanismInput({
      ...candidate,
      joints: [{ ...candidate.joints[0], lowerRad: 2, upperRad: -2 }],
    })).rejects.toThrow(/lowerRad.*upperRad/i);
    const { lowerRad: _lower, upperRad: _upper, ...hinge } = candidate.joints[0]!;
    await expect(defineMechanismInput({
      ...candidate, joints: [{ ...hinge, limits: { lower: -1, upper: 1 } }],
    })).rejects.toThrow();
    await expect(defineMechanismInput({
      ...candidate, joints: [hinge],
    })).rejects.toThrow(/lowerRad|upperRad/i);
    const { secondAxisLocal: _secondAxis, ...oneSidedAxis } = candidate.joints[0]!;
    await expect(defineMechanismInput({
      ...candidate, joints: [oneSidedAxis],
    })).rejects.toThrow(/secondAxisLocal/i);
  });

  it("rejects physically impossible principal inertia", async () => {
    const candidate = await inputCandidate();
    await expect(defineMechanismInput({
      ...candidate,
      bodies: candidate.bodies.map((body) => body.kind === "dynamic"
        ? { ...body, principalInertiaKgM2: [1, 1, 3] }
        : body),
    })).rejects.toThrow("Principal inertia must satisfy triangle inequalities");
  });

  it("canonicalizes every signed-zero mechanism number before digesting", async () => {
    const negativeZero = await inputCandidate();
    const zero = structuredClone(negativeZero);
    const replaceSignedZero = (value: unknown): void => {
      if (Array.isArray(value)) for (let index = 0; index < value.length; index += 1) {
        if (Object.is(value[index], -0)) value[index] = 0;
        else replaceSignedZero(value[index]);
      } else if (value && typeof value === "object") {
        for (const child of Object.values(value)) replaceSignedZero(child);
      }
    };
    replaceSignedZero(zero);
    const first = await defineMechanismInput(negativeZero);
    const second = await defineMechanismInput(zero);
    expect(first.mechanismInputDigest).toBe(second.mechanismInputDigest);
    const containsSignedZero = (value: unknown): boolean => Object.is(value, -0)
      || (Array.isArray(value) && value.some(containsSignedZero))
      || Boolean(value && typeof value === "object" && Object.values(value).some(containsSignedZero));
    expect(containsSignedZero(first)).toBe(false);
  });

  it("rejects replay products that exceed bounded frame, sample, or state budgets", async () => {
    const candidate = await inputCandidate();
    await expect(defineMechanismInput({
      ...candidate, durationSteps: 70_000, outputStrideSteps: 1, clearancePairs: [],
    })).rejects.toThrow("Mechanism replay frame budget exceeded");
    await expect(defineMechanismInput({
      ...candidate, durationSteps: 60_000, outputStrideSteps: 1,
    })).rejects.toThrow("Mechanism replay body-state budget exceeded");
    await expect(defineMechanismInput({
      ...candidate, durationSteps: 40_000, outputStrideSteps: 1, clearancePairs: [],
    })).rejects.toThrow("Mechanism replay joint-state budget exceeded");
    const sourceBodyIds = ["base-design", "base-second-design", "base-third-design"];
    const colliders = await Promise.all(sourceBodyIds.map((sourceBodyId, index) =>
      collider(`base-collider-${index}`, "base", sourceBodyId, 1)));
    await expect(defineMechanismInput({
      ...candidate,
      bodies: [{ id: "base", kind: "fixed", sourceBodyIds, transform: transform() }],
      colliders, joints: [], pointForces: [], durationSteps: 60_000, outputStrideSteps: 1,
      clearancePairs: [
        { id: "first-clearance", sourceQueryId: "first-query", firstColliderId: "base-collider-0", secondColliderId: "base-collider-1" },
        { id: "second-clearance", sourceQueryId: "second-query", firstColliderId: "base-collider-0", secondColliderId: "base-collider-2" },
      ],
    })).rejects.toThrow("Mechanism replay clearance-sample budget exceeded");
  });

  it("rejects non-finite forces, unknown IDs, partial cadence, and a forged input digest", async () => {
    const candidate = await inputCandidate();
    await expect(defineMechanismInput({ ...candidate, pointForces: [{ ...candidate.pointForces[0], forceWorldN: [0, Number.POSITIVE_INFINITY, 0] }] })).rejects.toThrow();
    await expect(defineMechanismInput({ ...candidate, pointForces: [{ ...candidate.pointForces[0], bodyId: "missing-body" }] })).rejects.toThrow("Point force body is unknown: missing-body");
    await expect(defineMechanismInput({ ...candidate, durationSteps: 10, outputStrideSteps: 4 })).rejects.toThrow("Mechanism duration must be divisible by output stride");
    await expect(defineMechanismInput({ ...candidate, mechanismInputDigest: digest("0") })).rejects.toThrow("Mechanism input digest does not match canonical content");
  });
});
