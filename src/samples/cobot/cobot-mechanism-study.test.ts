import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OcctKernel } from "occt-wasm";
import * as THREE from "three";

import { createOcctCadAdapter } from "../../cad/kernel/occt-adapter";
import { createOcctBridge, type OcctBridge } from "../../cad/kernel/occt-bridge";
import type { OcctWorkerLike, OcctWorkerMessageEvent } from "../../cad/kernel/occt-worker-client";
import type { OcctWorkerRequest } from "../../cad/kernel/occt-worker-contract";
import { rebuildDocument } from "../../cad/kernel/feature-rebuild";
import { buildCadEvaluationResults } from "../../cad/kernel/rebuild-results";
import { resolveDocumentFrame } from "../../cad/rigid-transform";
import type { CadKernelAdapter } from "../../cad/runtime-contracts";
import { compileMechanismStudy } from "../../simulation/compile-mechanism-study";
import { checkExactInitialOverlapsWithKernel } from "../../simulation/mechanism-overlap-kernel";
import { runCanonicalRapierMechanism } from "../../simulation/mechanism-solver-kernel";
import { createSe6MechanismGeometry, SE6_JOINTS } from "./cobot-mechanism-geometry";
import { buildSe6MechanismBenchmark } from "./cobot-mechanism-study";
import { createMechanismVisualFrame, type MechanismVisualReplay } from "./cobot-mechanism-visuals";
import { multiplyQuaternion, rotateVector, type Quat } from "../../simulation/mechanism-rapier-math";

const exactRuntime = vi.hoisted(() => ({ evaluate: vi.fn(), overlaps: vi.fn() }));
vi.mock("../../simulation/mechanism-exact-worker", () => ({
  evaluateMechanismExactRequest: exactRuntime.evaluate,
}));
vi.mock("../../simulation/mechanism-overlap", () => ({
  checkExactInitialOverlaps: exactRuntime.overlaps,
}));

const pairEnabled = (
  first: { membershipMask: number; filterMask: number },
  second: { membershipMask: number; filterMask: number },
) => (first.membershipMask & second.filterMask) !== 0
  && (second.membershipMask & first.filterMask) !== 0;
const connectedEnvelopeToleranceMm = 1e-6;
function housingEndMm(housing: { readonly center: readonly [number, number, number]; readonly rotation?: readonly [number, number, number]; readonly size: readonly [number, number, number] }, direction: -1 | 1) {
  const offset = new THREE.Vector3(direction * housing.size[0]! / 2, 0, 0).applyEuler(new THREE.Euler(...(housing.rotation ?? [0, 0, 0]), "XYZ"));
  return housing.center.map((value, axis) => value + offset.toArray()[axis]!) as [number, number, number];
}
class PendingWorker implements OcctWorkerLike {
  readonly posted: OcctWorkerRequest[] = [];
  terminateCount = 0;
  private readonly listeners = new Set<(event: OcctWorkerMessageEvent) => void>();
  postMessage(message: unknown) { this.posted.push(message as OcctWorkerRequest); }
  addEventListener(_type: "message", listener: (event: OcctWorkerMessageEvent) => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "message", listener: (event: OcctWorkerMessageEvent) => void) {
    this.listeners.delete(listener);
  }
  terminate() { this.terminateCount += 1; }
  listenerCount() { return this.listeners.size; }
}

describe("SE-6 exact mechanism benchmark", () => {
  let kernel: OcctKernel;
  let bridge: OcctBridge;
  beforeAll(async () => { kernel = await OcctKernel.init(); bridge = createOcctBridge(kernel); });
  beforeEach(() => {
    exactRuntime.evaluate.mockImplementation(async (request, signal, emit) => {
      const payload = await rebuildDocument(bridge, request.document, request.requestedOutputs, signal);
      emit({ state: "succeeded", requestId: request.requestId, sourceRevision: request.sourceRevision,
        requestedOutputs: [...request.requestedOutputs],
        results: await buildCadEvaluationResults(request, payload) });
    });
    exactRuntime.overlaps.mockImplementation((sources, instances, signal) =>
      checkExactInitialOverlapsWithKernel(kernel, sources, instances, signal));
  });
  afterAll(() => bridge.dispose());

  const successfulAdapter = (dispose?: () => void): CadKernelAdapter => ({
    async evaluate(request, signal, emit) {
      const payload = await rebuildDocument(bridge, request.document, request.requestedOutputs, signal);
      emit({ state: "succeeded", requestId: request.requestId, sourceRevision: request.sourceRevision,
        requestedOutputs: [...request.requestedOutputs],
        results: await buildCadEvaluationResults(request, payload) });
    },
    async importStep() { throw new Error("not used"); },
    ...(dispose ? { dispose } : {}),
  });

  it("scopes owned adapters on success, failure, and abort without disposing injected adapters", async () => {
    let successfulDisposals = 0;
    const createSuccessful = () => successfulAdapter(() => { successfulDisposals += 1; });
    await buildSe6MechanismBenchmark(new AbortController().signal, undefined, createSuccessful);
    await buildSe6MechanismBenchmark(new AbortController().signal, undefined, createSuccessful);
    expect(successfulDisposals).toBe(2);

    let failedDisposals = 0;
    const failed: CadKernelAdapter = {
      async evaluate(request, _signal, emit) {
        emit({ state: "failed", requestId: request.requestId,
          error: { code: "internal-error", message: "expected failure" } });
      },
      async importStep() { throw new Error("not used"); },
      dispose: () => { failedDisposals += 1; },
    };
    await expect(buildSe6MechanismBenchmark(new AbortController().signal, undefined, () => failed))
      .rejects.toThrow("expected failure");
    expect(failedDisposals).toBe(1);

    let abortedDisposals = 0;
    const aborted: CadKernelAdapter = {
      async evaluate(request, _signal, emit) {
        emit({ state: "cancelled", requestId: request.requestId, workerDisposition: "not-started" });
      },
      async importStep() { throw new Error("not used"); },
      dispose: () => { abortedDisposals += 1; },
    };
    await expect(buildSe6MechanismBenchmark(new AbortController().signal, undefined, () => aborted))
      .rejects.toThrow("cancelled");
    expect(abortedDisposals).toBe(1);

    let injectedDisposals = 0;
    await buildSe6MechanismBenchmark(new AbortController().signal,
      successfulAdapter(() => { injectedDisposals += 1; }));
    expect(injectedDisposals).toBe(0);
  }, 30_000);

  it("aborts a pending default-owned OCCT evaluation and releases its worker listeners", async () => {
    const worker = new PendingWorker(), controller = new AbortController();
    const benchmark = buildSe6MechanismBenchmark(controller.signal, undefined,
      () => createOcctCadAdapter(() => worker));
    await vi.waitFor(() => expect(worker.posted.some(({ type }) => type === "evaluate")).toBe(true));
    expect(worker.listenerCount()).toBe(1);

    controller.abort();

    await expect(benchmark).rejects.toThrow("cancelled");
    expect(worker.posted.map(({ type }) => type)).toEqual(["evaluate", "cancel"]);
    expect(worker.terminateCount).toBe(1);
    expect(worker.listenerCount()).toBe(0);
  });

  it("bridges every visual part into seven exact rigid stages and six cylindrical joints", async () => {
    const adapter = successfulAdapter();
    const benchmark = await buildSe6MechanismBenchmark(new AbortController().signal, adapter);
    const geometry = await createSe6MechanismGeometry();
    const dynamics = await rebuildDocument(bridge, geometry, ["body-dynamics"], new AbortController().signal);
    const study = benchmark.document.studies.find(({ id }) => id === "se6-motion");
    if (!study || study.kind !== "mechanism" || study.configurationState !== "configured") {
      throw new Error("expected configured mechanism study");
    }

    expect(benchmark.document.instances).toHaveLength(7);
    expect(benchmark.document.mates).toHaveLength(6);
    expect(benchmark.document.mates.every(({ kind }) => kind === "revolute")).toBe(true);
    expect(benchmark.document.mates.map((joint) => joint.kind === "revolute"
      ? [joint.lowerRad, joint.upperRad] : null)).toEqual([
      [-Math.PI, Math.PI], [-2.2, 2.2], [-2.4, 2.4],
      [-Math.PI, Math.PI], [-2, 2], [-Math.PI, Math.PI],
    ]);
    expect(study.fixedInstanceIds).toEqual(["base"]);
    for (const instance of benchmark.document.instances.filter(({ id }) => id !== "base")) {
      const component = benchmark.document.components.find(({ id }) => id === instance.componentId)!;
      const parts = dynamics.bodyDynamics!.bodies.filter(({ bodyId }) => component.bodyIds.includes(bodyId));
      expect(parts.reduce((sum, part) => sum + part.volumeM3 * 2_700, 0)).toBeGreaterThan(0);
      expect(parts.every(({ centroidalInertiaUnitDensityKgM2: inertia }) =>
        inertia[0] > 0 && inertia[4] > 0 && inertia[8] > 0)).toBe(true);
    }

    expect(benchmark.visualParts).toHaveLength(52);
    expect(Object.keys(benchmark.partBodyIds).sort())
      .toEqual(benchmark.visualParts.map(({ selectionId }) => selectionId).sort());
    expect(new Set(Object.values(benchmark.partBodyIds))).toEqual(new Set([
      "base", "axis-1", "axis-2", "axis-3", "axis-4", "axis-5", "axis-6",
    ]));
    expect(benchmark.jointEvidence).toHaveLength(6);
    for (const evidence of benchmark.jointEvidence) {
      expect(evidence.first.kind).toBe("cylinder");
      expect(evidence.second.kind).toBe("cylinder");
      expect(Math.hypot(...evidence.first.originM.map((value, axis) =>
        value - evidence.second.originM[axis]!))).toBeLessThanOrEqual(1e-9);
      expect(Math.abs(evidence.first.axis.reduce((sum, value, axis) =>
        sum + value * evidence.second.axis[axis]!, 0))).toBeCloseTo(1, 9);
    }

    const groups = new Map(study.collisionGroups.flatMap((group) =>
      group.instanceIds.map((id) => [id, group] as const)));
    const bodyOrder = benchmark.document.instances.map(({ id }) => id);
    for (let first = 0; first < bodyOrder.length; first += 1) {
      for (let second = first + 1; second < bodyOrder.length; second += 1) {
        const enabled = pairEnabled(groups.get(bodyOrder[first]!)!, groups.get(bodyOrder[second]!)!);
        expect(enabled).toBe(second - first > 1);
      }
    }
    expect(study.clearancePairs.length).toBeGreaterThan(0);
    expect(study.clearancePairs.length).toBeLessThanOrEqual(64);

    const identity: Quat = [0, 0, 0, 1];
    const turn = (axis: readonly number[], angle: number): Quat => {
      const sin = Math.sin(angle / 2), cos = Math.cos(angle / 2);
      return [axis[0]! * sin, axis[1]! * sin, axis[2]! * sin, cos];
    };
    const pose = (angles: readonly number[]) => {
      const transforms = new Map<string, { positionM: readonly [number, number, number]; orientation: Quat }>();
      transforms.set("base", { positionM: [0, 0, 0], orientation: identity });
      SE6_JOINTS.forEach((joint, index) => {
        const parent = transforms.get(joint.first)!;
        const jointWorld = rotateVector(parent.orientation, joint.anchor).map((value, axis) =>
          value + parent.positionM[axis]!) as [number, number, number];
        const orientation = multiplyQuaternion(parent.orientation, turn(joint.axis, angles[index]!));
        transforms.set(joint.second, { orientation, positionM: jointWorld.map((value, axis) =>
          value - rotateVector(orientation, joint.anchor)[axis]!) as [number, number, number] });
      });
      return [...transforms].map(([bodyId, transform]) => ({ bodyId, ...transform,
        linearVelocityMps: [0, 0, 0], angularVelocityRadS: [0, 0, 0] }));
    };
    const replay = { frames: [
      { stepIndex: 0, bodies: pose([0, 0, 0, 0, 0, 0]), joints: [] },
      { stepIndex: 4, bodies: pose([.2, -.3, .4, -.25, .35, -.15]), joints: [] },
    ], clearanceSamples: [], contacts: [] } as unknown as MechanismVisualReplay;
    for (const frameIndex of [0, 1]) {
      const visual = createMechanismVisualFrame(benchmark.visualParts, benchmark.partBodyIds,
        { colliders: [], displayRegistration: benchmark.displayRegistration }, replay, frameIndex);
      expect(visual.parts).toHaveLength(52);
      expect(visual.parts.map(({ selectionId }) => new Set(Object.values(benchmark.partBodyIds)).has(benchmark.partBodyIds[selectionId]!))).not.toContain(false);
      expect(visual.jointInterfaces).toHaveLength(6);
      for (const joint of visual.jointInterfaces) expect(joint.firstMm).toEqual(joint.secondMm);

      const housing = visual.parts.find(({ selectionId }) => selectionId === "upper-arm-housing");
      const shoulder = visual.jointInterfaces.find(({ jointId }) => jointId === "joint-2");
      const elbow = visual.jointInterfaces.find(({ jointId }) => jointId === "joint-3");
      expect(benchmark.partBodyIds["upper-arm-housing"]).toBe("axis-2");
      expect(housing).toMatchObject({ kind: "box", material: "structural", size: [420, 80, 80] });
      if (!housing || housing.kind !== "box" || !shoulder || !elbow) {
        throw new Error("SE-6 connected upper-arm replay contract is unresolved");
      }
      housing.center.forEach((value, axis) => expect(value).toBeCloseTo(
        (shoulder.secondMm[axis]! + elbow.firstMm[axis]!) / 2, 9,
      ));
      [housingEndMm(housing, -1), housingEndMm(housing, 1)].forEach((end, endIndex) => {
        const interfaceMm = endIndex === 0 ? shoulder.secondMm : elbow.firstMm;
        expect(Math.hypot(...end.map((value, axis) => value - interfaceMm[axis]!)))
          .toBeLessThanOrEqual(connectedEnvelopeToleranceMm);
      });
    }
  }, 30_000);

  it("keeps every placed SE-6 exact stage free of positive-volume overlap", async () => {
    const signal = new AbortController().signal;
    const benchmark = await buildSe6MechanismBenchmark(signal, successfulAdapter());
    const rebuilt = await rebuildDocument(bridge, benchmark.document, ["body-dynamics"], signal);
    const study = benchmark.document.studies.find(({ id }) => id === "se6-motion");
    if (!study || study.kind !== "mechanism" || study.configurationState !== "configured"
      || !rebuilt.bodyDynamics) throw new Error("expected exact mechanism dynamics");
    const components = new Map(benchmark.document.components.map((component) => [component.id, component]));
    const groups = new Map(study.collisionGroups.flatMap((group) =>
      group.instanceIds.map((instanceId) => [instanceId, group] as const)));

    const sources = rebuilt.bodyDynamics.bodies.map(({ bodyId, brep }) => ({ bodyId, brepBytes: brep.bytes }));
    const instances = benchmark.document.instances.map((instance) => ({ instanceId: instance.id,
      membershipMask: groups.get(instance.id)!.membershipMask,
      filterMask: groups.get(instance.id)!.filterMask,
      transform: resolveDocumentFrame(benchmark.document, instance.frameId),
      bodyIds: components.get(instance.componentId)!.bodyIds }));
    const overlaps: string[] = [];
    for (let first = 0; first < instances.length; first += 1) {
      for (let second = first + 1; second < instances.length; second += 1) {
        try { await checkExactInitialOverlapsWithKernel(kernel, sources,
          [instances[first]!, instances[second]!], signal); }
        catch (error) { overlaps.push(error instanceof Error ? error.message : String(error)); }
      }
    }
    expect(overlaps).toEqual([]);
  }, 30_000);

  it("retains a symmetric shoulder mass after fitting the short exact stage", async () => {
    const signal = new AbortController().signal;
    const benchmark = await buildSe6MechanismBenchmark(signal, successfulAdapter());
    const rebuilt = await rebuildDocument(bridge, benchmark.document, ["body-dynamics"], signal);
    const axis = benchmark.document.components.find(({ id }) => id === "axis-1-component");
    if (!axis || !rebuilt.bodyDynamics) throw new Error("expected shoulder dynamics");
    const parts = rebuilt.bodyDynamics.bodies.filter(({ bodyId }) => axis.bodyIds.includes(bodyId));
    const totalMassKg = parts.reduce((sum, part) => sum + part.volumeM3 * 2_700, 0);
    const weightedCenterY = parts.reduce((sum, part) =>
      sum + part.centerOfMassM[1] * part.volumeM3 * 2_700, 0) / totalMassKg;

    expect(totalMassKg).toBeGreaterThan(.3);
    expect(Math.abs(weightedCenterY)).toBeLessThan(1e-9);
  }, 30_000);

  it("keeps the exact SE-6 replay inside the browser gate joint-anchor bound", async () => {
    const signal = new AbortController().signal;
    const benchmark = await buildSe6MechanismBenchmark(signal, successfulAdapter());
    const compiled = await compileMechanismStudy(benchmark.document, "se6-motion", signal);
    const solved = await runCanonicalRapierMechanism(compiled.input, signal);
    const errors = Object.fromEntries(compiled.input.joints.map((joint) => [joint.id,
      Math.max(...solved.replay.frames.map((frame) => {
        const first = frame.bodies.find(({ bodyId }) => bodyId === joint.firstBodyId)!;
        const second = frame.bodies.find(({ bodyId }) => bodyId === joint.secondBodyId)!;
        const firstPoint = rotateVector(first.orientation, joint.firstAnchorLocalM)
          .map((value, axis) => value + first.positionM[axis]!);
        const secondPoint = rotateVector(second.orientation, joint.secondAnchorLocalM)
          .map((value, axis) => value + second.positionM[axis]!);
        return Math.hypot(...secondPoint.map((value, axis) => value - firstPoint[axis]!));
      }))]));

    expect(Math.max(...Object.values(errors)), JSON.stringify(errors)).toBeLessThanOrEqual(1e-5);
  }, 30_000);
});
