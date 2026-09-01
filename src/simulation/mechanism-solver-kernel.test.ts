import { describe, expect, test } from "vitest";

import { runRapierMechanism } from "./mechanism-solver-kernel";
import { mechanismSolverInput } from "./mechanism-solver.test-support";
import { createMechanismReplay } from "./mechanism-replay";

describe("Rapier mechanism worker kernel", () => {
  test("captures step zero and deterministic fixed-cadence motion under gravity", async () => {
    const input = structuredClone(await mechanismSolverInput());
    const first = await runRapierMechanism(input, new AbortController().signal);
    const second = await runRapierMechanism(input, new AbortController().signal);

    expect(first.replay.frames.map(({ stepIndex }) => stepIndex)).toEqual([0, 2, 4]);
    expect(first.replay.frames[0]!.bodies.find(({ bodyId }) => bodyId === "link")!.positionM)
      .toEqual([0, 1, 0]);
    expect(first.replay.frames[2]!.bodies.find(({ bodyId }) => bodyId === "link")!.positionM[1])
      .toBeLessThan(1);
    expect(second).toEqual(first);
  });

  test("applies a world force at the correctly rebased body-local point", async () => {
    const base = await mechanismSolverInput();
    const quarterTurn = [0, 0, Math.SQRT1_2, Math.SQRT1_2] as const;
    const input = await mechanismSolverInput({
      bodies: [base.bodies[0], { ...base.bodies[1],
        transform: { positionM: [0, 1, 0], orientation: quarterTurn } }],
      gravityWorldMps2: [0, 0, 0],
      pointForces: [{ bodyId: "link", pointLocalM: [1, 0, 0], forceWorldN: [1, 0, 0] }],
      durationSteps: 2, outputStrideSteps: 1,
    });
    const result = await runRapierMechanism(structuredClone(input), new AbortController().signal);
    const link = result.replay.frames[1]!.bodies.find(({ bodyId }) => bodyId === "link")!;
    expect(link.angularVelocityRadS[2]).toBeCloseTo(-0.0015625, 6);
    expect(link.linearVelocityMps[0]).toBeGreaterThan(0);
  });

  test("derives constant-force work from material-point displacement in the replay", async () => {
    const base = await mechanismSolverInput();
    const input = await mechanismSolverInput({ bodies: [base.bodies[0], { ...base.bodies[1],
      centerOfMassM: [0, 0, 0] }], gravityWorldMps2: [0, 0, 0],
      pointForces: [{ bodyId: "link", pointLocalM: [0, 0, 0], forceWorldN: [1, 0, 0] }],
      durationSteps: 2, outputStrideSteps: 1 });
    const result = await runRapierMechanism(input, new AbortController().signal);
    const initial = result.replay.frames[0]!.bodies.find(({ bodyId }) => bodyId === "link")!;
    const final = result.replay.frames.at(-1)!.bodies.find(({ bodyId }) => bodyId === "link")!;
    expect(final.positionM[0]).toBeGreaterThan(initial.positionM[0]);
    expect(result.verification.pointForceWorkJ).toBe(final.positionM[0] - initial.positionM[0]);
  });

  test("reports unit-discriminated prismatic state from rotated body-local axes", async () => {
    const base = await mechanismSolverInput();
    const quarterTurn = [0, 0, Math.SQRT1_2, Math.SQRT1_2] as const;
    const input = await mechanismSolverInput({
      bodies: [
        { ...base.bodies[0], transform: { positionM: [0, 0, 0], orientation: quarterTurn } },
        { ...base.bodies[1], transform: { positionM: [0, 0, 0], orientation: [0, 0, 0, 1] },
          initialLinearVelocityMps: [0, 1, 0] },
      ],
      joints: [{ id: "slide", kind: "prismatic", firstBodyId: "ground", secondBodyId: "link",
        firstAnchorLocalM: [0, 0, 0], secondAnchorLocalM: [0, 0, 0],
        firstAxisLocal: [1, 0, 0], secondAxisLocal: [0, 1, 0], lowerM: -1, upperM: 1 }],
      gravityWorldMps2: [0, 0, 0], durationSteps: 2, outputStrideSteps: 1,
    });
    const result = await runRapierMechanism(structuredClone(input), new AbortController().signal);
    expect(result.replay.frames[0]!.joints[0]).toMatchObject(
      { jointId: "slide", kind: "prismatic", positionM: 0 });
    expect((result.replay.frames[0]!.joints[0] as { velocityMps: number }).velocityMps).toBeCloseTo(1);
    expect(result.verification.initialLinearMomentumKgMps).toEqual([0, 2, 0]);
  });

  test("captures bounded contact force phases and every requested clearance sample", async () => {
    const base = await mechanismSolverInput();
    const input = await mechanismSolverInput({
      bodies: [
        { ...base.bodies[0], transform: { positionM: [0, -0.5, 0], orientation: [0, 0, 0, 1] } },
        { ...base.bodies[1], transform: { positionM: [0, 0.3, 0], orientation: [0, 0, 0, 1] } },
      ],
      durationSteps: 60, outputStrideSteps: 10,
      clearancePairs: [{ id: "ground-link-clearance", sourceQueryId: "gap",
        firstColliderId: "ground-collider", secondColliderId: "link-collider" }],
    });
    const result = await runRapierMechanism(structuredClone(input), new AbortController().signal);
    expect(result.replay.clearanceSamples).toHaveLength(7);
    expect(result.replay.clearanceSamples[0]!.stepIndex).toBe(0);
    expect(result.replay.contacts.some(({ phase }) => phase === "begin")).toBe(true);
    expect(result.replay.contacts.some(({ normalForceN }) => normalForceN > 0)).toBe(true);
    expect(result.replay.contacts.every(({ firstColliderId, secondColliderId }) => firstColliderId < secondColliderId)).toBe(true);
    expect(result.replay.contacts.find(({ phase }) => phase === "begin")!.normalWorld[1]).toBeGreaterThan(0);
    await expect(createMechanismReplay(input, result.replay)).resolves.toMatchObject({
      minimumRequestedClearanceM: expect.any(Number),
    });
  });

  test("seeds touching collision-enabled pairs as begin at step zero and persist at step one", async () => {
    const base = await mechanismSolverInput();
    const input = await mechanismSolverInput({ bodies: [
      { ...base.bodies[0], transform: { positionM: [0, -0.5, 0], orientation: [0, 0, 0, 1] } },
      { ...base.bodies[1], transform: { positionM: [0, 0.25, 0], orientation: [0, 0, 0, 1] } },
    ], gravityWorldMps2: [0, 0, 0], durationSteps: 1, outputStrideSteps: 1 });
    const result = await runRapierMechanism(input, new AbortController().signal);
    expect(result.replay.contacts.map(({ stepIndex, phase, normalForceN }) =>
      [stepIndex, phase, normalForceN])).toEqual([[0, "begin", 0], [1, "persist", 0]]);
    const colliders = base.colliders.map(({ geometryDigest: _digest, truthLevel: _truth, ...collider }, index) =>
      index === 0 ? { ...collider, filterMask: 0 } : collider);
    const disabled = await mechanismSolverInput({ bodies: input.bodies, colliders,
      gravityWorldMps2: [0, 0, 0], durationSteps: 1, outputStrideSteps: 1 });
    await expect(runRapierMechanism(disabled, new AbortController().signal)).resolves
      .toMatchObject({ replay: { contacts: [] } });
  });

  test("emits a zero-force end phase when an upward-loaded body leaves contact", async () => {
    const base = await mechanismSolverInput();
    const input = await mechanismSolverInput({
      bodies: [
        { ...base.bodies[0], transform: { positionM: [0, -0.5, 0], orientation: [0, 0, 0, 1] } },
        { ...base.bodies[1], transform: { positionM: [0, 0.24, 0], orientation: [0, 0, 0, 1] },
          initialLinearVelocityMps: [0, 1, 0] },
      ],
      gravityWorldMps2: [0, 0, 0], pointForces: [], durationSteps: 20, outputStrideSteps: 5,
    });
    const result = await runRapierMechanism(structuredClone(input), new AbortController().signal);
    expect(result.replay.contacts.map(({ phase }) => phase)).toContain("end");
    const ended = result.replay.contacts.find(({ phase }) => phase === "end")!;
    expect(ended).toMatchObject({ penetrationM: 0, normalForceN: 0 });
  });

  test("samples clearance after a body moves far beyond its initial scene envelope", async () => {
    const base = await mechanismSolverInput();
    const colliders = base.colliders.map(({ geometryDigest: _digest, truthLevel: _truth, ...collider }) => ({
      ...collider, approximation: { kind: "exact-primitive" as const, maximumSurfaceDeviationM: 0 },
      shape: { kind: "sphere" as const, radiusM: 1 },
    }));
    const input = await mechanismSolverInput({ bodies: [
      { ...base.bodies[0], transform: { positionM: [0, 0, 0], orientation: [0, 0, 0, 1] } },
      { ...base.bodies[1], transform: { positionM: [2, 0, 0], orientation: [0, 0, 0, 1] },
        initialLinearVelocityMps: [100, 0, 0] },
    ], colliders, gravityWorldMps2: [0, 0, 0], durationSteps: 240, outputStrideSteps: 240,
    clearancePairs: [{ id: "moving-gap", sourceQueryId: "gap",
      firstColliderId: "ground-collider", secondColliderId: "link-collider" }] });
    const solved = await runRapierMechanism(input, new AbortController().signal);
    expect(solved.replay.clearanceSamples.at(-1)).toMatchObject({ stepIndex: 240, distanceM: expect.closeTo(100, 2) });
  });

  test("validates positive clearance on the output step where contact ends", async () => {
    const base = await mechanismSolverInput();
    const colliders = base.colliders.map(({ geometryDigest: _digest, truthLevel: _truth, ...collider }) => ({
      ...collider, approximation: { kind: "exact-primitive" as const, maximumSurfaceDeviationM: 0 },
      shape: { kind: "sphere" as const, radiusM: 1 },
    }));
    const input = await mechanismSolverInput({ bodies: [
      { ...base.bodies[0], transform: { positionM: [0, 0, 0], orientation: [0, 0, 0, 1] } },
      { ...base.bodies[1], transform: { positionM: [1.999, 0, 0], orientation: [0, 0, 0, 1] },
        initialLinearVelocityMps: [1, 0, 0] },
    ], colliders, gravityWorldMps2: [0, 0, 0], durationSteps: 1, outputStrideSteps: 1,
    clearancePairs: [{ id: "ending-gap", sourceQueryId: "gap",
      firstColliderId: "ground-collider", secondColliderId: "link-collider" }] });
    const solved = await runRapierMechanism(input, new AbortController().signal);
    expect(solved.replay.contacts).toContainEqual(expect.objectContaining({ stepIndex: 1, phase: "end" }));
    expect(solved.replay.clearanceSamples.at(-1)!.distanceM).toBeGreaterThan(0);
    const replay = await createMechanismReplay(input, solved.replay);
    expect(replay.minimumRequestedClearanceM).toBeLessThan(0);
  });

  test("yields during long deterministic loops so cancellation can interrupt stepping", async () => {
    const input = await mechanismSolverInput({ durationSteps: 512, outputStrideSteps: 1 });
    const controller = new AbortController();
    const promise = runRapierMechanism(structuredClone(input), controller.signal);
    setTimeout(() => controller.abort(), 0);
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});
