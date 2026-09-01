import { beforeEach, describe, expect, it } from "vitest";

import { revisionId } from "../domain/revisions";
import {
  defineMechanismInput, MECHANISM_MAX_CONTACT_EVENTS, MechanismFrameSchema,
  MechanismWorkerResultEvidenceCandidateSchema, type MechanismInput,
} from "./mechanism-contract";
import { createMechanismReplay } from "./mechanism-replay";

const digest = (character: string) => character.repeat(64);
const transform = { positionM: [0, 0, 0] as const, orientation: [0, 0, 0, 1] as const };
const body = (bodyId: string, orientation: readonly [number, number, number, number] = [0, 0, 0, 1]) => ({
  bodyId, positionM: [0, 0, 0] as const, orientation,
  linearVelocityMps: [0, 0, 0] as const, angularVelocityRadS: [0, 0, 0] as const,
});
const joint = (jointId: string) => ({
  jointId, kind: "revolute" as const, positionRad: 0, velocityRadS: 0,
});

async function collider(id: string, bodyId: string, sourceBodyId: string, membershipMask: number) {
  const payload = {
    bodyLocalTransform: transform,
    approximation: { kind: "exact-primitive" as const, maximumSurfaceDeviationM: 0 },
    shape: { kind: "box" as const, halfExtentsM: [0.05, 0.01, 0.01] as const },
  };
  return {
    id, bodyId, sourceBodyId, sourceArtifactIds: [digest(bodyId === "base" ? "b" : "c")],
    ...payload, geometryDigest: await revisionId(payload),
    membershipMask, filterMask: membershipMask === 1 ? 2 : 1,
  };
}

let input: MechanismInput;
beforeEach(async () => {
  input = await defineMechanismInput({
    sourceRevision: digest("a"), studyId: "arm-motion",
    bodies: [
      { id: "base", kind: "fixed", sourceBodyIds: ["base-design"], transform },
      { id: "link", kind: "dynamic", sourceBodyIds: ["link-design"], transform, massKg: 1, centerOfMassM: [0, 0, 0], principalInertiaKgM2: [1, 1, 1], principalInertiaFrameToBody: [0, 0, 0, 1], initialLinearVelocityMps: [0, 0, 0], initialAngularVelocityRadS: [0, 0, 0] },
    ],
    colliders: [
      await collider("base-collider", "base", "base-design", 1),
      await collider("link-collider", "link", "link-design", 2),
    ],
    joints: [{
      id: "hinge", kind: "revolute", firstBodyId: "base", secondBodyId: "link",
      firstAnchorLocalM: [0, 0, 0], secondAnchorLocalM: [0, 0, 0],
      firstAxisLocal: [0, 0, 1], secondAxisLocal: [0, 0, 1], lowerRad: -1, upperRad: 1,
    }],
    gravityWorldMps2: [0, -9.81, 0], pointForces: [], durationSteps: 480, outputStrideSteps: 4,
    clearancePairs: [{ id: "base-link-clearance", sourceQueryId: "base-link-clearance", firstColliderId: "base-collider", secondColliderId: "link-collider" }],
  });
});

function frame(stepIndex: number) {
  return {
    sourceRevision: input.sourceRevision, studyId: input.studyId,
    mechanismInputDigest: input.mechanismInputDigest, stepIndex,
    bodies: [body("base"), body("link")], joints: [joint("hinge")],
  };
}

function replayCandidate() {
  const frames = Array.from({ length: 121 }, (_, index) => frame(index * 4));
  return {
    sourceRevision: input.sourceRevision, studyId: input.studyId,
    mechanismInputDigest: input.mechanismInputDigest,
    bodyIds: ["base", "link"], jointIds: ["hinge"],
    colliderIds: ["base-collider", "link-collider"], clearancePairIds: ["base-link-clearance"],
    frames, contacts: [],
    clearanceSamples: frames.map(({ stepIndex }) => ({
      stepIndex, pairId: "base-link-clearance",
      firstColliderId: "base-collider", secondColliderId: "link-collider", distanceM: 0.01,
    })),
  };
}

describe("mechanism replay", () => {
  it("returns canonical evidence labelled as an unverified replay", async () => {
    const replay = await createMechanismReplay(input, replayCandidate());
    expect(replay).toMatchObject({
      truthLevel: "unverified-replay", encodingVersion: "mechanism-replay-v1",
      fixedStepHz: 240, maximumPenetrationM: 0, minimumRequestedClearanceM: 0.01,
      replayDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("issues an immutable replay whose canonical bytes are defensive copies", async () => {
    const replay = await createMechanismReplay(input, replayCandidate());
    const original = replay.canonicalBytes[0]!;
    replay.canonicalBytes[0] = original ^ 0xff;
    expect(replay.canonicalBytes[0]).toBe(original);
    expect(Object.isFrozen(replay)).toBe(true);
  });

  it("requires exact binding, increasing bounded steps, cadence, and complete state IDs", async () => {
    const candidate = replayCandidate();
    await expect(createMechanismReplay(input, { ...candidate, frames: [{ ...frame(0), sourceRevision: digest("b") }, ...candidate.frames.slice(1)] })).rejects.toThrow("Mechanism frame revision does not match replay revision");
    await expect(createMechanismReplay(input, { ...candidate, frames: [frame(0), frame(4), frame(4)] })).rejects.toThrow("Mechanism frame steps must be strictly increasing");
    await expect(createMechanismReplay(input, { ...candidate, frames: [frame(0), frame(3), frame(480)] })).rejects.toThrow("Mechanism frame steps do not match the configured output cadence");
    await expect(createMechanismReplay(input, { ...candidate, frames: [frame(0), { ...frame(4), joints: [joint("wrist")] }, ...candidate.frames.slice(2)] })).rejects.toThrow("Mechanism frame joint IDs do not match replay joints");
    await expect(createMechanismReplay(input, {
      ...candidate, frames: [{ ...candidate.frames[0], stepIndex: -0 }, ...candidate.frames.slice(1)],
    })).rejects.toThrow(/signed zero/i);
  });

  it("uses discriminated joint frame states with explicit angle or length units", async () => {
    expect(MechanismFrameSchema.safeParse({
      ...frame(0), joints: [{ jointId: "hinge", kind: "rigid" }],
    }).success).toBe(true);
    expect(MechanismFrameSchema.safeParse({
      ...frame(0), joints: [{ jointId: "hinge", kind: "prismatic", positionM: 0.01, velocityMps: 0.02 }],
    }).success).toBe(true);
    expect(MechanismFrameSchema.safeParse({
      ...frame(0), joints: [{ jointId: "hinge", position: 0, velocity: 0 }],
    }).success).toBe(false);
    const candidate = replayCandidate();
    await expect(createMechanismReplay(input, {
      ...candidate,
      frames: candidate.frames.map((value) => ({
        ...value, joints: [{ jointId: "hinge", kind: "prismatic", positionM: 0, velocityMps: 0 }],
      })),
    })).rejects.toThrow("Mechanism frame joint kind does not match input joint: hinge");
  });

  it("rejects noncanonical output quaternions and non-unit contact normals", async () => {
    const candidate = replayCandidate();
    await expect(createMechanismReplay(input, { ...candidate, frames: [{ ...frame(0), bodies: [body("base", [0, 0, 0, -1]), body("link")] }, ...candidate.frames.slice(1)] })).rejects.toThrow(/output quaternion.*canonical/i);
    await expect(createMechanismReplay(input, { ...candidate, frames: [{ ...frame(0), bodies: [{ ...body("base"), positionM: [-0, 0, 0] }, body("link")] }, ...candidate.frames.slice(1)] })).rejects.toThrow(/signed zero/i);
    await expect(createMechanismReplay(input, { ...candidate, contacts: [{ stepIndex: 4, phase: "begin", firstColliderId: "base-collider", secondColliderId: "link-collider", pointM: [0, 0, 0], normalWorld: [1.001, 0, 0], penetrationM: 0.001, normalForceN: 1 }] })).rejects.toThrow(/contact normal.*unit/i);
  });

  it("rejects contacts after duration and incoherent contact phases", async () => {
    const candidate = replayCandidate();
    const contact = { stepIndex: 481, phase: "begin", firstColliderId: "base-collider", secondColliderId: "link-collider", pointM: [0, 0, 0], normalWorld: [1, 0, 0], penetrationM: 0.001, normalForceN: 1 };
    await expect(createMechanismReplay(input, { ...candidate, contacts: [contact] })).rejects.toThrow("Mechanism contact is after the configured duration");
    await expect(createMechanismReplay(input, { ...candidate, contacts: [{ ...contact, stepIndex: 4, phase: "persist" }] })).rejects.toThrow("Mechanism contact persists before it begins");
  });

  it("rejects contacts disabled by either collider filter mask", async () => {
    const { mechanismInputDigest: _digest, ...content } = input;
    const blocked = await defineMechanismInput({
      ...content,
      colliders: content.colliders.map((collider) => collider.id === "base-collider"
        ? { ...collider, filterMask: 0 }
        : collider),
    });
    const candidate = replayCandidate();
    const contact = {
      stepIndex: 4, phase: "begin", firstColliderId: "base-collider", secondColliderId: "link-collider",
      pointM: [0, 0, 0], normalWorld: [1, 0, 0], penetrationM: 0, normalForceN: 0,
    };
    await expect(createMechanismReplay(blocked, {
      ...candidate, mechanismInputDigest: blocked.mechanismInputDigest,
      frames: candidate.frames.map((value) => ({ ...value, mechanismInputDigest: blocked.mechanismInputDigest })),
      contacts: [contact],
    })).rejects.toThrow("Mechanism contact is disabled by collider collision masks");
  });

  it("requires negative clearance depth to match same-step contact penetration", async () => {
    const candidate = replayCandidate();
    const contacts = [
      { stepIndex: 4, phase: "begin", firstColliderId: "base-collider", secondColliderId: "link-collider", pointM: [0, 0, 0], normalWorld: [1, 0, 0], penetrationM: 0.001, normalForceN: 4 },
      { stepIndex: 8, phase: "end", firstColliderId: "base-collider", secondColliderId: "link-collider", pointM: [0, 0, 0], normalWorld: [1, 0, 0], penetrationM: 0, normalForceN: 0 },
    ];
    const mismatched = candidate.clearanceSamples.map((sample) => sample.stepIndex === 4
      ? { ...sample, distanceM: -0.002 }
      : sample.stepIndex === 8 ? { ...sample, distanceM: 0 } : sample);
    await expect(createMechanismReplay(input, { ...candidate, contacts, clearanceSamples: mismatched }))
      .rejects.toThrow("Mechanism clearance penetration does not match same-step contact depth");
    const matched = mismatched.map((sample) => sample.stepIndex === 4 ? { ...sample, distanceM: -0.001 } : sample);
    await expect(createMechanismReplay(input, { ...candidate, contacts, clearanceSamples: matched }))
      .resolves.toMatchObject({ maximumPenetrationM: 0.001, minimumRequestedClearanceM: -0.001 });
  });

  it("does not accept caller-supplied runtime authority claims", async () => {
    const candidate = replayCandidate();
    await expect(createMechanismReplay(input, {
      ...candidate, runtimeVersion: "caller-runtime", runtimeDigest: digest("f"),
    })).rejects.toThrow();
  });

  it("defines complete future worker evidence without granting verified authority", async () => {
    const replay = await createMechanismReplay(input, replayCandidate());
    const evidence = {
      replayDigest: replay.replayDigest, mechanismInputDigest: input.mechanismInputDigest,
      engineVersion: "0.20.0", runtimeVersion: "rapier-wasm",
      runtimeDigest: digest("1"), solverBuildDigest: digest("2"), wasmModuleDigest: digest("3"),
      workerArtifactDigest: digest("5"), settingsDigest: digest("4"),
      verification: {
        initialLinearMomentumKgMps: [0, 0, 0], finalLinearMomentumKgMps: [0, 0, 0],
        initialAngularMomentumKgM2ps: [0, 0, 0], finalAngularMomentumKgM2ps: [0, 0, 0],
        energyChangeJ: 0, gravityWorkJ: 0, pointForceWorkJ: 0, energyAccountingErrorJ: 0,
        maximumJointErrorM: 0,
      },
    };
    expect(MechanismWorkerResultEvidenceCandidateSchema.safeParse(evidence).success).toBe(true);
    expect(MechanismWorkerResultEvidenceCandidateSchema.safeParse({
      ...evidence, workerArtifactDigest: undefined,
    }).success).toBe(false);
  });

  it("bounds contact evidence before canonical encoding", async () => {
    const contact = { stepIndex: 4, phase: "begin", firstColliderId: "base-collider", secondColliderId: "link-collider", pointM: [0, 0, 0], normalWorld: [1, 0, 0], penetrationM: 0, normalForceN: 0 };
    await expect(createMechanismReplay(input, {
      ...replayCandidate(), contacts: Array(MECHANISM_MAX_CONTACT_EVENTS + 1).fill(contact),
    })).rejects.toThrow();
  });
});
