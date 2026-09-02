// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OcctKernel } from "occt-wasm";
import * as RAPIER from "@dimforge/rapier3d-deterministic-compat";

import { defineArtifactRecord } from "../cad/artifact-contract";
import { createDesignSession } from "../cad/design-session";
import { createOcctBridge, type OcctBridge } from "../cad/kernel/occt-bridge";
import { rebuildDocument } from "../cad/kernel/feature-rebuild";
import { buildCadEvaluationResults } from "../cad/kernel/rebuild-results";
import type { CadKernelAdapter } from "../cad/runtime-contracts";
import { createArtifactStore, digestArtifactPayload } from "../engineering/artifact-store";
import { createSolverRegistry } from "../engineering/solver-registry";
import type { EngineeringSolveRequest, SolverAdapter } from "../engineering/solver-adapter";
import {
  droneMotorSideArmDocument, se6MechanismDocument, se6UpperArmDocument,
  type AuthoritativeComponentDocument,
} from "../models/component-documents";
import { createComponentStudyPlanners } from "./component-study-planners";
import { createEngineeringWorkspaceService } from "./engineering-workspace-service";
import { compileStructuralStudy } from "../solver/structural/compile-structural-study";
import { activeComponents } from "../solver/structural/structural-grid-validation";
import type { StructuralSolveInput } from "../solver/structural/structural-contract";
import { createWebGpuStructuralAdapter } from "../solver/structural/webgpu-structural-adapter";
import type { ThermalSolveInput } from "../solver/thermal/thermal-contract";
import { createVerifiedThermalAdapter } from "../solver/thermal/verified-thermal-adapter";
import { createWebGpuTopologyAdapter } from "../solver/topology/topology-adapter";
import type { TopologySolveInput } from "../solver/topology/topology-contract";
import { topologyDiscreteLimits } from "../solver/topology/density-constraints";
import { configuredTopologyStudy, topologyPassiveCells } from "../solver/topology/topology-input";
import { MECHANISM_MAX_CLEARANCE_SAMPLES } from "../simulation/mechanism-contract";
import { createMechanismAdapter, type MechanismAdapterInput } from "../simulation/mechanism-adapter";
import { runCanonicalRapierMechanism } from "../simulation/mechanism-solver-kernel";
import { createRapierState } from "../simulation/mechanism-rapier-world";
import { captureInitialContactEvents } from "../simulation/mechanism-rapier-contacts";
import { se6Assembly } from "../samples/cobot/cobot-assembly";

let bridge: OcctBridge;
beforeAll(async () => {
  bridge = createOcctBridge(await OcctKernel.init());
  await RAPIER.init();
});
afterAll(() => bridge.dispose());

function exactAdapter(evaluate: (request: unknown) => void | Promise<void>): CadKernelAdapter {
  return {
    async evaluate(request, signal, emit) {
      await evaluate(request);
      const payload = await rebuildDocument(
        bridge, request.document, request.requestedOutputs, signal,
      );
      emit({ requestId: request.requestId, state: "succeeded",
        sourceRevision: request.sourceRevision, requestedOutputs: [...request.requestedOutputs],
        results: await buildCadEvaluationResults(request, payload) });
    },
    async importStep() { throw new Error("STEP import is outside component planner tests"); },
  };
}

function linkedAdapter(kind: "fea" | "topology" | "thermal" | "mechanism", seen: EngineeringSolveRequest<unknown>[]) {
  return {
    capability: { kind }, supports: () => ({ supported: true as const }),
    async run(request) {
      seen.push(request);
      const payload = Uint8Array.of(seen.length);
      const record = await defineArtifactRecord({
        kind: "field", sourceRevision: request.sourceRevision,
        producer: { name: "component-planner-test-solver", version: "1" },
        settingsDigest: "8".repeat(64), contentDigest: await digestArtifactPayload(payload),
        units: "m", mediaType: "application/vnd.engineering.component-test-field",
        dependencies: [{ kind: "entity", reference: `study:${request.studyId}` },
          ...request.inputArtifacts.map(({ id }) => ({ kind: "artifact" as const, artifactId: id }))],
      });
      return { output: { ok: true }, truthLevel: "converged-numerical-solve" as const,
        artifacts: [{ record, payload }] };
    },
  } satisfies SolverAdapter<unknown, { readonly ok: boolean }>;
}

async function service(
  model: AuthoritativeComponentDocument, evaluate: (request: unknown) => void | Promise<void>,
) {
  const seen: EngineeringSolveRequest<unknown>[] = [], registry = createSolverRegistry();
  for (const kind of ["fea", "topology", "thermal", "mechanism"] as const) {
    registry.register(linkedAdapter(kind, seen));
  }
  return { seen, workspace: createEngineeringWorkspaceService({
    session: createDesignSession(model.document), store: createArtifactStore(), registry,
    createCadAdapter: () => exactAdapter(evaluate), planners: createComponentStudyPlanners(model),
    clock: { now: () => "2026-09-01T18:00:00.000Z", elapsedMs: () => 1 },
  }) };
}

async function waitVerified(workspace: ReturnType<typeof createEngineeringWorkspaceService>, jobId: string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = workspace.inspectJob(jobId).event.state;
    if (state === "verified") return;
    if (["failed", "cancelled"].includes(state)) throw new Error(`Component job ended as ${state}`);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Component planner job did not finish");
}

describe("exact component study planners", () => {
  it("refuses a caller-substituted mechanism intent sidecar", async () => {
    const model = await se6MechanismDocument();
    const substituted = {
      ...model,
      bodyMassKg: { ...model.bodyMassKg, "base-body": model.bodyMassKg["base-body"]! * 2 },
    };

    expect(() => createComponentStudyPlanners(substituted)).toThrow(/authoritative component intent/i);
  });

  it("launches structural and topology from one retained drone exact source", async () => {
    const evaluate = vi.fn(), model = await droneMotorSideArmDocument();
    const { workspace, seen } = await service(model, evaluate);
    for (const studyId of ["drone-arm-structural", "drone-arm-topology"]) {
      const launched = await workspace.launchStudy({ studyId, expectedRevision: model.document.revision });
      await waitVerified(workspace, launched.jobId);
    }
    expect(evaluate).toHaveBeenCalledOnce();
    expect(seen.map(({ kind }) => kind)).toEqual(["fea", "topology"]);
    expect((seen[0]!.settings as { pcgIterationBudget?: number }).pcgIterationBudget).toBe(2_048);
    vi.stubGlobal("navigator", { gpu: {} });
    expect(createWebGpuStructuralAdapter().supports(
      seen[0]! as EngineeringSolveRequest<StructuralSolveInput>,
    )).toEqual({ supported: true });
    vi.unstubAllGlobals();
    expect(seen.every(({ inputArtifacts }) => inputArtifacts.some(({ producer }) =>
      producer.name === "workspace-exact-body-brep"))).toBe(true);
    const topology = seen[1] as EngineeringSolveRequest<TopologySolveInput>;
    expect((topology.input.sourceStructuralRequest.settings as { pcgIterationBudget?: number })
      .pcgIterationBudget).toBe(2_048);
    const compiled = await compileStructuralStudy(topology.input.sourceStructuralRequest);
    const topologyStudy = configuredTopologyStudy(topology);
    expect(topologyStudy.extraction.toleranceM).toBeGreaterThan(0);
    expect(topologyStudy.extraction.toleranceM).toBeLessThanOrEqual(compiled.grid.cellSizeM * .25);
    const passive = topologyPassiveCells(topology, configuredTopologyStudy(topology));
    const componentLabels = activeComponents(compiled.activeCells, compiled.grid.cellDimensions);
    const activeLabels = new Set([...componentLabels].filter((label) => label >= 0));
    expect(activeLabels).toEqual(new Set([0]));
    expect(passive.requiredInterfaces.every(({ cellIndices }) =>
      [...cellIndices].every((cell) => componentLabels[cell] === 0))).toBe(true);
    expect([...passive.protectedCells].every((cell) => topology.input.initialDensity[cell] === 0)).toBe(true);
    expect(passive.requiredInterfaces.map(({ id }) => id)).toEqual(expect.arrayContaining(
      model.protectedInterfaces.filter(({ id }) => id.startsWith("body-interface-"))
        .map(({ id }) => id),
    ));
    vi.stubGlobal("navigator", { gpu: {} });
    expect(createWebGpuTopologyAdapter().supports(topology)).toEqual({ supported: true });
    vi.unstubAllGlobals();
    workspace.dispose();
  }, 10_000);

  it("launches SE-6 upper-arm structural and topology through one exact component source", async () => {
    const evaluate = vi.fn(), model = await se6UpperArmDocument();
    const { workspace, seen } = await service(model, evaluate);
    for (const studyId of ["se6-upper-arm-structural", "se6-upper-arm-topology"]) {
      const launched = await workspace.launchStudy({ studyId, expectedRevision: model.document.revision });
      await waitVerified(workspace, launched.jobId);
    }
    expect(evaluate).toHaveBeenCalledOnce();
    expect(seen.map(({ kind }) => kind)).toEqual(["fea", "topology"]);
    expect(seen.every(({ sourceRevision }) => sourceRevision === model.document.revision)).toBe(true);
    workspace.dispose();
  });

  it("pads drone interfaces to their manufacturing width before target selection", async () => {
    const model = await droneMotorSideArmDocument();
    const { workspace, seen } = await service(model, vi.fn());
    const launched = await workspace.launchStudy({
      studyId: "drone-arm-topology", expectedRevision: model.document.revision,
    });
    await waitVerified(workspace, launched.jobId);
    const request = seen[0] as EngineeringSolveRequest<TopologySolveInput>;
    const system = await compileStructuralStudy(request.input.sourceStructuralRequest);
    const study = configuredTopologyStudy(request);
    const passive = topologyPassiveCells(request, study);
    const interfaceCells = new Set(passive.requiredInterfaces
      .flatMap(({ cellIndices }) => [...cellIndices]));
    const minimumCells = Math.ceil(study.minimumFeatureM / system.grid.cellSizeM - 1e-9);
    const [width, height, depth] = system.grid.cellDimensions, plane = width * height;
    const mask = Uint32Array.from(system.activeCells, (_value, cell) =>
      Number(passive.requiredCells.has(cell)));
    const run = (cell: number, axis: number) => {
      const z = Math.floor(cell / plane), rest = cell - z * plane;
      const y = Math.floor(rest / width), x = rest - y * width;
      let length = 1;
      for (const direction of [-1, 1]) for (let step = 1; ; step += 1) {
        const point = [x, y, z]; point[axis] += direction * step;
        if (point[axis]! < 0 || point[axis]! >= [width, height, depth][axis]!) break;
        const next = point[0]! + width * (point[1]! + height * point[2]!);
        if (mask[next] !== 1) break;
        length += 1;
      }
      return length;
    };
    expect(minimumCells).toBe(2);
    expect(passive.requiredCells.size).toBeGreaterThan(interfaceCells.size);
    expect([...passive.requiredCells].every((cell) => system.activeCells[cell] === 1)).toBe(true);
    expect([...passive.requiredCells].every((cell) =>
      [0, 1, 2].every((axis) => run(cell, axis) >= minimumCells))).toBe(true);
    expect(() => topologyDiscreteLimits(
      study.targetVolumeFraction, study.moveLimit, system.activeCells,
      passive.requiredCells, passive.protectedCells,
    )).not.toThrow();
    const domainCount = system.activeCells.reduce((sum, value) => sum + value, 0);
    expect(() => topologyDiscreteLimits(
      (passive.requiredCells.size - 1) / domainCount, study.moveLimit,
      system.activeCells, passive.requiredCells, passive.protectedCells,
    )).toThrow(/passive constraints/i);
    workspace.dispose();
  });

  it("quarantines a component plan when a mutation invalidates its exact acquisition", async () => {
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const evaluate = vi.fn(async () => { entered(); await gate; });
    const model = await droneMotorSideArmDocument();
    const { workspace, seen } = await service(model, evaluate);
    const launch = workspace.launchStudy({
      studyId: "drone-arm-structural", expectedRevision: model.document.revision,
    });
    await started;
    await workspace.apply({ id: "mutate-during-exact-source",
      expectedRevision: model.document.revision,
      actor: { kind: "human", id: "component-test" }, preconditions: [],
      commands: [{ id: "rename-component", type: "rename-document", label: "Mutated component" }] });
    release();
    await expect(launch).rejects.toThrow(/abort|cancel|stale/i);
    expect(seen).toHaveLength(0);
    expect(workspace.inspect().artifacts).toHaveLength(0);
    workspace.dispose();
  });

  for (const [_kind, build, studyId, timeout] of [
    ["thermal", se6UpperArmDocument, "se6-upper-arm-thermal", undefined],
    ["mechanism", se6MechanismDocument, "se6-motion", 10_000],
  ] as const) it(`launches the ${_kind} component study from active exact roots`, async () => {
    const evaluate = vi.fn(), model = await build();
    const { workspace, seen } = await service(model, evaluate);
    const launched = await workspace.launchStudy({ studyId, expectedRevision: model.document.revision });
    await waitVerified(workspace, launched.jobId);
    expect(evaluate).toHaveBeenCalledOnce();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.sourceRevision).toBe(model.document.revision);
    expect(seen[0]!.inputArtifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "brep", sourceRevision: model.document.revision }),
      expect.objectContaining({ kind: "render-mesh", sourceRevision: model.document.revision }),
    ]));
    if (_kind === "mechanism") {
      const input = (seen[0]!.input as { mechanismInput: {
        bodies: { id: string }[]; colliders: { id: string; bodyId: string; sourceBodyId: string;
          bodyLocalTransform: { positionM: readonly [number, number, number] } }[];
        clearancePairs: { firstColliderId: string; secondColliderId: string }[];
        durationSteps: number; outputStrideSteps: number;
      } }).mechanismInput;
      expect(input.bodies).toHaveLength(7);
      expect(input.colliders).toHaveLength(52);
      expect(input.clearancePairs).toHaveLength(52);
      const stageIndex = new Map(["base", "axis-1", "axis-2", "axis-3", "axis-4", "axis-5", "axis-6"]
        .map((id, index) => [id, index] as const));
      const colliderStage = new Map(input.colliders.map(({ id, bodyId }) => [id, stageIndex.get(bodyId)!]));
      const covered = new Set(input.clearancePairs.flatMap(({ firstColliderId, secondColliderId }) =>
        [firstColliderId, secondColliderId]));
      expect(covered).toEqual(new Set(input.colliders.map(({ id }) => id)));
      expect(input.clearancePairs.every(({ firstColliderId, secondColliderId }) =>
        Math.abs(colliderStage.get(firstColliderId)! - colliderStage.get(secondColliderId)!) > 1)).toBe(true);
      const frames = input.durationSteps / input.outputStrideSteps + 1;
      expect(frames * input.clearancePairs.length).toBeLessThanOrEqual(MECHANISM_MAX_CLEARANCE_SAMPLES);
      const authoredCenters = new Map(se6Assembly.components.map(({ instanceId, transform }) => [
        `${instanceId}-body`, [transform.position.x.value, transform.position.y.value,
          transform.position.z.value] as const,
      ]));
      for (const collider of input.colliders) {
        const center = authoredCenters.get(collider.sourceBodyId)!;
        collider.bodyLocalTransform.positionM.forEach((value, axis) =>
          expect(value).toBeCloseTo(center[axis]!, 10));
      }
      const state = createRapierState(RAPIER, input as never);
      try {
        const contacts: Parameters<typeof captureInitialContactEvents>[1] = [];
        captureInitialContactEvents(state, contacts);
        const shoulder = input.colliders.find(({ sourceBodyId }) =>
          sourceBodyId === "shoulder-boss-body")!.id;
        const pedestal = input.colliders.find(({ sourceBodyId }) =>
          sourceBodyId === "pedestal-body")!.id;
        expect(contacts).not.toContainEqual(expect.objectContaining({
          firstColliderId: [shoulder, pedestal].sort()[0],
          secondColliderId: [shoulder, pedestal].sort()[1],
        }));
        const sourceByCollider = new Map(input.colliders.map(({ id, sourceBodyId }) => [id, sourceBodyId]));
        expect(contacts.filter(({ penetrationM }) => penetrationM > 0).map((contact) => ({
          first: sourceByCollider.get(contact.firstColliderId),
          second: sourceByCollider.get(contact.secondColliderId), penetrationM: contact.penetrationM,
        }))).toEqual([]);
      } finally { state.world.free(); }
      const started = performance.now();
      const solved = await runCanonicalRapierMechanism(input as never, new AbortController().signal);
      expect(solved.verification.maximumJointErrorM).toBeLessThanOrEqual(1e-5);
      expect(performance.now() - started).toBeLessThan(5_000);
      expect(createMechanismAdapter().supports(
        seen[0]! as EngineeringSolveRequest<MechanismAdapterInput>,
      )).toEqual({ supported: true });
    } else {
      vi.stubGlobal("navigator", { gpu: {} });
      expect(createVerifiedThermalAdapter().supports(
        seen[0]! as EngineeringSolveRequest<ThermalSolveInput>,
      )).toEqual({ supported: true });
      vi.unstubAllGlobals();
    }
    workspace.dispose();
  }, timeout);
});
