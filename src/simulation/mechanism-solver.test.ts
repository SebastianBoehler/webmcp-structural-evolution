import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import type { CadEvaluationEvent, CadEvaluationRequest } from "../cad/runtime-contracts";
import { exactCompilerSuccess, mechanismDocument, unitBoxBrep } from "./compile-mechanism-study.test-support";

const exact = vi.hoisted(() => ({ evaluateMechanismExactRequest: vi.fn(), checkExactInitialOverlaps: vi.fn() }));
const artifact = vi.hoisted(() => ({ readMechanismSolverWorkerArtifactDigest: vi.fn(),
  MECHANISM_SOLVER_WORKER_ASSET_URL: "solver-worker.js" }));
vi.mock("./mechanism-exact-worker", () => exact);
vi.mock("./mechanism-overlap", () => ({ checkExactInitialOverlaps: exact.checkExactInitialOverlaps }));
vi.mock("./mechanism-solver-artifact", () => artifact);

import { compileMechanismStudy } from "./compile-mechanism-study";
import { assertMechanismResult, resolveMechanismResult, solveMechanismStudy } from "./mechanism-solver";
import { mechanismSolverProvenance } from "./mechanism-solver-provenance";

const digest = (value: string) => value.repeat(64);
let pinnedEvidence: Awaited<ReturnType<typeof mechanismSolverProvenance>>;
const zeroVerification = { initialLinearMomentumKgMps: [0, 0, 0], finalLinearMomentumKgMps: [0, 0, 0],
  initialAngularMomentumKgM2ps: [0, 0, 0], finalAngularMomentumKgM2ps: [0, 0, 0],
  energyChangeJ: 0, gravityWorkJ: 0, pointForceWorkJ: 0, energyAccountingErrorJ: 0, maximumJointErrorM: 0 };
class SolverWorker {
  static evidenceOverride: Record<string, unknown> = {};
  static verificationOverride: Record<string, unknown> = {};
  private listeners = new Map<string, Set<(event: unknown) => void>>();
  postMessage(value: unknown) {
    const request = value as { readonly type: string; readonly requestId: string;
      readonly mechanismInputDigest: string; readonly inputBytes?: Uint8Array };
    if (request.type !== "solve-mechanism") return;
    const input = JSON.parse(new TextDecoder().decode(request.inputBytes!));
    queueMicrotask(() => this.emit("message", { data: { type: "started", requestId: request.requestId,
      mechanismInputDigest: request.mechanismInputDigest } }));
    const frames = Array.from({ length: input.durationSteps / input.outputStrideSteps + 1 }, (_value, index) => ({
      sourceRevision: input.sourceRevision, studyId: input.studyId, mechanismInputDigest: input.mechanismInputDigest,
      stepIndex: index * input.outputStrideSteps,
      bodies: input.bodies.map((body: { id: string; kind: string; transform: { positionM: number[]; orientation: number[] };
        initialLinearVelocityMps?: number[]; initialAngularVelocityRadS?: number[] }) => ({ bodyId: body.id,
        positionM: body.transform.positionM, orientation: body.transform.orientation,
        linearVelocityMps: body.initialLinearVelocityMps ?? [0, 0, 0],
        angularVelocityRadS: body.initialAngularVelocityRadS ?? [0, 0, 0] })),
      joints: input.joints.map((joint: { id: string; kind: string }) => joint.kind === "rigid"
        ? { jointId: joint.id, kind: joint.kind }
        : joint.kind === "revolute" ? { jointId: joint.id, kind: joint.kind, positionRad: 0, velocityRadS: 0 }
          : { jointId: joint.id, kind: joint.kind, positionM: 0, velocityMps: 0 }),
    }));
    const clearanceSamples = frames.flatMap((frame) => input.clearancePairs.map((pair: {
      id: string; firstColliderId: string; secondColliderId: string;
    }) => ({ stepIndex: frame.stepIndex, pairId: pair.id, firstColliderId: pair.firstColliderId,
      secondColliderId: pair.secondColliderId, distanceM: 1 })));
    const output = { replay: { sourceRevision: input.sourceRevision, studyId: input.studyId,
      mechanismInputDigest: input.mechanismInputDigest, bodyIds: input.bodies.map(({ id }: { id: string }) => id),
      jointIds: input.joints.map(({ id }: { id: string }) => id), colliderIds: input.colliders.map(({ id }: { id: string }) => id),
      clearancePairIds: input.clearancePairs.map(({ id }: { id: string }) => id), frames, contacts: [], clearanceSamples },
    evidence: { mechanismInputDigest: input.mechanismInputDigest, ...pinnedEvidence,
      verification: { ...zeroVerification, ...SolverWorker.verificationOverride }, ...SolverWorker.evidenceOverride } };
    queueMicrotask(() => this.emit("message", { data: { type: "succeeded", requestId: request.requestId,
      outputBytes: new TextEncoder().encode(JSON.stringify(output)) } }));
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    const values = this.listeners.get(type) ?? new Set(); values.add(listener); this.listeners.set(type, values);
  }
  removeEventListener(type: string, listener: (event: unknown) => void) { this.listeners.get(type)?.delete(listener); }
  terminate() {}
  private emit(type: string, event: unknown) { for (const listener of this.listeners.get(type) ?? []) listener(event); }
}

let brepBytes: Uint8Array;
beforeAll(async () => { brepBytes = await unitBoxBrep(); pinnedEvidence = await mechanismSolverProvenance(digest("5")); });
beforeEach(() => {
  SolverWorker.evidenceOverride = {};
  SolverWorker.verificationOverride = {};
  artifact.readMechanismSolverWorkerArtifactDigest.mockResolvedValue(digest("5"));
  exact.evaluateMechanismExactRequest.mockReset(); exact.checkExactInitialOverlaps.mockResolvedValue(undefined);
  exact.evaluateMechanismExactRequest.mockImplementation(async (
    request: CadEvaluationRequest, _signal: AbortSignal, emit: (event: CadEvaluationEvent) => void,
  ) => emit(await exactCompilerSuccess(request, brepBytes)));
});

describe("mechanism result authority", () => {
  test("rejects caller-authored and cloned compiler/result lookalikes", async () => {
    await expect(solveMechanismStudy({ input: {} } as never, new AbortController().signal))
      .rejects.toThrow("in-process exact compiler authority");
    const compiled = await compileMechanismStudy(await mechanismDocument(), "motion", new AbortController().signal);
    await expect(solveMechanismStudy(structuredClone(compiled) as never, new AbortController().signal))
      .rejects.toThrow("in-process exact compiler authority");
    expect(() => assertMechanismResult({ truthLevel: "verified-mechanism-result" }))
      .toThrow("in-process mechanism result authority");
  });

  test("binds validated worker evidence to exact compiler artifacts with private result authority", async () => {
    vi.stubGlobal("Worker", SolverWorker);
    const compiled = await compileMechanismStudy(await mechanismDocument(), "motion", new AbortController().signal);
    const result = await solveMechanismStudy(compiled, new AbortController().signal);
    expect(assertMechanismResult(result)).toBe(result);
    expect(resolveMechanismResult(result).compiled).toBe(compiled);
    expect(result.sourceArtifactIds).toEqual(compiled.sourceArtifacts.map(({ id }) => id).sort());
    expect(result.evidence.engineVersion).toBe("0.18.1");
    expect(() => assertMechanismResult(structuredClone(result))).toThrow("in-process mechanism result authority");
    vi.unstubAllGlobals();
  });

  test("rejects worker evidence that does not identify the pinned deterministic runtime", async () => {
    vi.stubGlobal("Worker", SolverWorker);
    SolverWorker.evidenceOverride = { engineVersion: "caller-engine" };
    const compiled = await compileMechanismStudy(await mechanismDocument(), "motion", new AbortController().signal);
    await expect(solveMechanismStudy(compiled, new AbortController().signal))
      .rejects.toThrow("pinned deterministic runtime");
    vi.unstubAllGlobals();
  });

  test("rejects worker evidence bound to bytes other than the emitted worker artifact", async () => {
    vi.stubGlobal("Worker", SolverWorker);
    SolverWorker.evidenceOverride = { workerArtifactDigest: digest("6") };
    const compiled = await compileMechanismStudy(await mechanismDocument(), "motion", new AbortController().signal);
    await expect(solveMechanismStudy(compiled, new AbortController().signal))
      .rejects.toThrow("pinned deterministic runtime");
    vi.unstubAllGlobals();
  });

  test("rejects finite worker verification metrics that do not match the validated replay", async () => {
    vi.stubGlobal("Worker", SolverWorker);
    SolverWorker.verificationOverride = { energyChangeJ: 1 };
    const compiled = await compileMechanismStudy(await mechanismDocument(), "motion", new AbortController().signal);
    await expect(solveMechanismStudy(compiled, new AbortController().signal))
      .rejects.toThrow("verification does not match the validated replay");
    vi.unstubAllGlobals();
  });
});
