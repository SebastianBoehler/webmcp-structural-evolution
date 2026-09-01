// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OcctKernel } from "occt-wasm";

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
import { createWebGpuTopologyAdapter } from "../solver/topology/topology-adapter";
import type { TopologySolveInput } from "../solver/topology/topology-contract";
import { configuredTopologyStudy, topologyPassiveCells } from "../solver/topology/topology-input";

let bridge: OcctBridge;
beforeAll(async () => { bridge = createOcctBridge(await OcctKernel.init()); });
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
    expect(seen.every(({ inputArtifacts }) => inputArtifacts.some(({ producer }) =>
      producer.name === "workspace-exact-body-brep"))).toBe(true);
    const topology = seen[1] as EngineeringSolveRequest<TopologySolveInput>;
    await expect(compileStructuralStudy(topology.input.sourceStructuralRequest)).resolves.toBeDefined();
    const passive = topologyPassiveCells(topology, configuredTopologyStudy(topology));
    expect(passive.requiredInterfaces.map(({ id }) => id)).toEqual(expect.arrayContaining(
      model.protectedInterfaces.filter(({ id }) => id.startsWith("body-interface-"))
        .map(({ id }) => id),
    ));
    vi.stubGlobal("navigator", { gpu: {} });
    expect(createWebGpuTopologyAdapter().supports(topology)).toEqual({ supported: true });
    vi.unstubAllGlobals();
    workspace.dispose();
  });

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

  it.each([
    ["thermal", se6UpperArmDocument, "se6-upper-arm-thermal"],
    ["mechanism", se6MechanismDocument, "se6-motion"],
  ] as const)("launches the %s component study from active exact roots", async (_kind, build, studyId) => {
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
      const input = (seen[0]!.input as { mechanismInput: { bodies: unknown[]; colliders: unknown[] } }).mechanismInput;
      expect(input.bodies).toHaveLength(7);
      expect(input.colliders).toHaveLength(52);
    }
    workspace.dispose();
  });
});
