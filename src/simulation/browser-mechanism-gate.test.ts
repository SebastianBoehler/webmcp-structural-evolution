import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OcctKernel } from "occt-wasm";

import { defineArtifactRecord } from "../cad/artifact-contract";
import { createOcctBridge, type OcctBridge } from "../cad/kernel/occt-bridge";
import { rebuildDocument } from "../cad/kernel/feature-rebuild";
import { buildCadEvaluationResults } from "../cad/kernel/rebuild-results";
import { resolveDocumentFrame } from "../cad/rigid-transform";
import type { CadKernelAdapter } from "../cad/runtime-contracts";
import { revisionId } from "../domain/revisions";
import { digestArtifactPayload } from "../engineering/artifact-store";
import type { SolverAdapter } from "../engineering/solver-adapter";
import { buildSe6MechanismBenchmark } from "../samples/cobot/cobot-mechanism-study";
import type { MechanismAdapterInput } from "./mechanism-adapter";
import type { MechanismInput } from "./mechanism-contract";
import { checkExactInitialOverlapsWithKernel } from "./mechanism-overlap-kernel";
import { runMechanismBrowserGate } from "./browser-mechanism-gate";
import type { MechanismResult } from "./mechanism-solver";

const digest = (character: string) => character.repeat(64);
const stageIds = ["base", "axis-1", "axis-2", "axis-3", "axis-4", "axis-5", "axis-6"];
const joints = stageIds.slice(0, -1).map((bodyId, index) => ({
  id: `joint-${index + 1}`, kind: "revolute" as const, firstBodyId: bodyId,
  secondBodyId: stageIds[index + 1]!, lowerRad: -Math.PI, upperRad: Math.PI,
}));
const colliders = stageIds.map((bodyId, index) => ({ id: `collider-${bodyId}`, bodyId,
  membershipMask: 1 << index,
  filterMask: stageIds.reduce((mask, _id, other) => Math.abs(other - index) > 1 ? mask | (1 << other) : mask, 0) }));
const input = { sourceRevision: digest("1"), studyId: "se6-motion", mechanismInputDigest: digest("2"),
  bodies: stageIds.map((id) => ({ id, kind: id === "base" ? "fixed" : "dynamic" })),
  joints, colliders, clearancePairs: [{ id: "clearance", sourceQueryId: "clearance-1-3",
    firstColliderId: "collider-base", secondColliderId: "collider-axis-2" }],
  durationSteps: 240, outputStrideSteps: 4 } as unknown as MechanismInput;
const frames = Array.from({ length: 61 }, (_, frameIndex) => ({
  stepIndex: frameIndex * 4, joints: joints.map(({ id }, jointIndex) => ({
    jointId: id, kind: "revolute" as const,
    positionRad: jointIndex < 4 ? (frameIndex / 60) * .01 * (jointIndex + 1) : 0,
    velocityRadS: 0,
  })), bodies: [], sourceRevision: digest("1"), studyId: "se6-motion",
  mechanismInputDigest: digest("2"),
}));
const result = { sourceRevision: digest("1"), studyId: "se6-motion",
  mechanismInputDigest: digest("2"), sourceArtifactIds: [digest("3"), digest("4")],
  resultDigest: digest("5"), truthLevel: "verified-mechanism-result" as const,
  replay: { replayDigest: digest("6"), frames, contacts: [],
    clearanceSamples: frames.map(({ stepIndex }) => ({ stepIndex, pairId: "clearance",
      firstColliderId: "collider-base", secondColliderId: "collider-axis-2", distanceM: .1 })),
    maximumPenetrationM: 0, minimumRequestedClearanceM: .1 },
  evidence: { engineVersion: "0.18.1", runtimeVersion: "rapier", runtimeDigest: digest("7"),
    solverBuildDigest: digest("8"), wasmModuleDigest: digest("9"), workerArtifactDigest: digest("a"),
    settingsDigest: digest("b"), verification: { maximumJointErrorM: 1e-7 } },
} as unknown as MechanismResult;

async function adapter(): Promise<SolverAdapter<MechanismAdapterInput, MechanismResult>> {
  let prematureCancellation = false;
  const replayUtf8 = new Uint8Array(new ArrayBuffer(11));
  replayUtf8.set(new TextEncoder().encode("test replay"));
  const payload = { replayUtf8 };
  const record = await defineArtifactRecord({
    kind: "mechanism-replay", sourceRevision: result.sourceRevision,
    producer: { name: "gate-test", version: "1" }, settingsDigest: await revisionId({ test: true }),
    contentDigest: await digestArtifactPayload(payload), units: "m",
    mediaType: "application/vnd.test+json",
    dependencies: [{ kind: "entity", reference: "study:se6-motion" }],
  });
  const runtime: SolverAdapter<MechanismAdapterInput, MechanismResult> = {
    capability: { kind: "mechanism" }, supports: () => ({ supported: true }),
    async run(_request, signal, emit) {
      emit({ progress: .2 });
      if (signal.aborted) prematureCancellation = true;
      emit({ progress: .6, partial: { kind: "mechanism-worker-started",
        requestId: "gate-worker-request", mechanismInputDigest: digest("2") } });
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      return { output: result, truthLevel: "converged-numerical-solve", artifacts: [{ record, payload }] };
    } };
  return Object.assign(runtime, { prematureCancellation: () => prematureCancellation });
}

describe("SE-6 mechanism browser gate", () => {
  let kernel: OcctKernel, bridge: OcctBridge, benchmark: Awaited<ReturnType<typeof buildSe6MechanismBenchmark>>;
  beforeAll(async () => {
    kernel = await OcctKernel.init(); bridge = createOcctBridge(kernel);
    const cad: CadKernelAdapter = { async evaluate(request, signal, emit) {
      const payload = await rebuildDocument(bridge, request.document, request.requestedOutputs, signal);
      emit({ state: "succeeded", requestId: request.requestId, sourceRevision: request.sourceRevision,
        requestedOutputs: [...request.requestedOutputs], results: await buildCadEvaluationResults(request, payload) });
    }, async importStep() { throw new Error("not used"); } };
    benchmark = await buildSe6MechanismBenchmark(new AbortController().signal, cad);
    Object.assign(input, { sourceRevision: benchmark.document.revision });
    Object.assign(result, { sourceRevision: benchmark.document.revision });
  });
  afterAll(() => bridge.dispose());

  it("cancels in flight with zero commit, restarts, and seals live authority", async () => {
    const runtime = await adapter();
    const run = vi.spyOn(runtime, "run");
    const session = await runMechanismBrowserGate(new AbortController().signal, {
      buildBenchmark: async () => benchmark, createAdapter: () => runtime,
      resolveResult: () => ({ result, compiled: { input, sourceArtifacts: [] } as never }),
    });

    expect(session.report.status).toBe("passed");
    expect(session.result).toBe(result);
    expect(session.input).toBe(input);
    expect(run).toHaveBeenCalledTimes(2);
    expect((runtime as typeof runtime & { prematureCancellation(): boolean }).prematureCancellation()).toBe(false);
    if (session.report.status !== "passed") throw new Error("expected passed report");
    expect(session.report.cancellation).toMatchObject({ artifactsCommitted: 0, recoveryRunPassed: true,
      workerStarted: true, cancellationRequestedAfterWorkerStart: true });
    expect(session.report.motion.movingJointIds).toHaveLength(4);
    expect(session.report.benchmark).toMatchObject({ revoluteJointCount: 6, frameCount: 61, outputHz: 60 });
    expect(session.report.authorizesEngineeringResult).toBe(false);
  }, 30_000);

  it("aborts between the cancelled probe terminal and recovery activation", async () => {
    const controller = new AbortController();
    const runtime = await adapter();
    const run = vi.spyOn(runtime, "run");
    const yieldAfterProbe = vi.spyOn(globalThis, "setTimeout").mockImplementationOnce((handler) => {
      controller.abort(new DOMException("route owner cancelled", "AbortError"));
      if (typeof handler === "function") handler();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    });

    try {
      const gate = runMechanismBrowserGate(controller.signal, {
        buildBenchmark: async () => benchmark, createAdapter: () => runtime,
        resolveResult: () => ({ result, compiled: { input, sourceArtifacts: [] } as never }),
      });

      await expect(gate).rejects.toMatchObject({ name: "AbortError" });
      expect(run).toHaveBeenCalledTimes(1);
      expect(yieldAfterProbe).toHaveBeenCalledTimes(1);
    } finally {
      yieldAfterProbe.mockRestore();
    }
  }, 30_000);

  it("reports bounded cancellation invariants when the worker fails before started", async () => {
    const runtime = { ...await adapter(),
      run: async () => { throw new Error("protocol failed before started"); } };

    const session = await runMechanismBrowserGate(new AbortController().signal, {
      buildBenchmark: async () => benchmark, createAdapter: () => runtime,
      resolveResult: () => ({ result, compiled: { input, sourceArtifacts: [] } as never }),
    });

    expect(session.report).toMatchObject({ status: "blocked", blocker: {
      stage: "cancellation-and-recovery",
      message: expect.stringContaining("workerStarted=false cancellationRequested=false completion=failed terminalCount=1 commitCount=0 failure=internal-error:protocol failed before started"),
    } });
  }, 30_000);

  it("passes real exact preflight through the job before worker-start cancellation", async () => {
    const signal = new AbortController().signal;
    const rebuilt = await rebuildDocument(bridge, benchmark.document, ["body-dynamics"], signal);
    const study = benchmark.document.studies.find(({ id }) => id === "se6-motion");
    if (!study || study.kind !== "mechanism" || study.configurationState !== "configured"
      || !rebuilt.bodyDynamics) throw new Error("expected exact mechanism dynamics");
    const components = new Map(benchmark.document.components.map((component) => [component.id, component]));
    const groups = new Map(study.collisionGroups.flatMap((group) =>
      group.instanceIds.map((instanceId) => [instanceId, group] as const)));
    const sources = rebuilt.bodyDynamics.bodies.map(({ bodyId, brep }) => ({ bodyId, brepBytes: brep.bytes }));
    const instances = benchmark.document.instances.map((instance) => ({ instanceId: instance.id,
      membershipMask: groups.get(instance.id)!.membershipMask, filterMask: groups.get(instance.id)!.filterMask,
      transform: resolveDocumentFrame(benchmark.document, instance.frameId),
      bodyIds: components.get(instance.componentId)!.bodyIds }));
    const base = await adapter();
    const runtime = { ...base, run: vi.fn(async (...args: Parameters<typeof base.run>) => {
      await checkExactInitialOverlapsWithKernel(kernel, sources, instances, args[1]);
      return base.run(...args);
    }) };

    const session = await runMechanismBrowserGate(signal, {
      buildBenchmark: async () => benchmark, createAdapter: () => runtime,
      resolveResult: () => ({ result, compiled: { input, sourceArtifacts: [] } as never }),
    });

    expect(session.report.status).toBe("passed");
    expect(runtime.run).toHaveBeenCalledTimes(2);
  }, 30_000);
});
