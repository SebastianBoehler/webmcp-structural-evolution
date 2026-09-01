import { describe, expect, it, vi } from "vitest";

import { defineArtifactRecord } from "../cad/artifact-contract";
import { digestArtifactPayload } from "../engineering/artifact-store";
import type { EngineeringSolveRequest } from "../engineering/solver-adapter";
import {
  exactCobotPlan, redefineInput, serviceForPlans, thermalResult, waitForJob,
} from "./workspace-lineage-test-support";

describe("workspace exact-model lineage authority", () => {
  it("rejects a planner-derived voxel that names a body outside the current cobot document", async () => {
    const source = await exactCobotPlan("fake-body");
    const record = await defineArtifactRecord({
      ...source.derived.record, id: undefined,
      dependencies: [
        ...source.derived.record.dependencies,
        { kind: "entity", reference: "body:generic-block" },
      ],
    });
    const plan = await redefineInput(source, record, source.derived.payload);
    const run = vi.fn(async (request: EngineeringSolveRequest<unknown>) => thermalResult(request, 1));
    const { service, store } = await serviceForPlans([plan], run);

    await expect(service.launchStudy({
      studyId: "se6-upper-arm-thermal", expectedRevision: plan.document.revision,
    })).rejects.toThrow(/workspace-owned production planner/i);
    expect(run).not.toHaveBeenCalled();
    await expect(store.get(record.id)).resolves.toBeUndefined();
  });

  it("rejects arbitrary current-revision bytes self-labelled as the derived thermal model", async () => {
    const source = await exactCobotPlan("arbitrary-voxel");
    const payload = Uint8Array.of(1, 2, 3, 4);
    const record = await defineArtifactRecord({
      ...source.derived.record, id: undefined,
      contentDigest: await digestArtifactPayload(payload),
    });
    const plan = await redefineInput(source, record, payload);
    const run = vi.fn(async (request: EngineeringSolveRequest<unknown>) => thermalResult(request, 1));
    const { service, store } = await serviceForPlans([plan], run);

    await expect(service.launchStudy({
      studyId: "se6-upper-arm-thermal", expectedRevision: plan.document.revision,
    })).rejects.toThrow(/workspace-owned production planner/i);
    expect(run).not.toHaveBeenCalled();
    await expect(store.get(record.id)).resolves.toBeUndefined();
  });

  it("rejects an active solver field substituted for the canonical geometry input", async () => {
    const source = await exactCobotPlan("field-as-geometry");
    const payload = Uint8Array.of(9);
    const record = await defineArtifactRecord({
      ...source.derived.record, id: undefined, kind: "field",
      producer: { name: "thermal-solver", version: "1" },
      mediaType: "application/vnd.engineering.temperature-field",
      contentDigest: await digestArtifactPayload(payload),
    });
    const plan = await redefineInput(source, record, payload);
    const run = vi.fn(async (request: EngineeringSolveRequest<unknown>) => thermalResult(request, 1));
    const { service, store } = await serviceForPlans([plan], run);

    await expect(service.launchStudy({
      studyId: "se6-upper-arm-thermal", expectedRevision: plan.document.revision,
    })).rejects.toThrow(/derived|voxel|sdf|geometry|thermal/i);
    expect(run).not.toHaveBeenCalled();
    await expect(store.get(record.id)).resolves.toBeUndefined();
  });

  it("fails a solver result that omits authoritative request-input lineage", async () => {
    const plan = await exactCobotPlan("unlined-result");
    const { service } = await serviceForPlans(
      [plan], (request) => thermalResult(request, 5, false), undefined, true,
    );

    const launched = await service.launchStudy({
      studyId: "se6-upper-arm-thermal", expectedRevision: plan.document.revision,
    });
    await waitForJob(service, launched.jobId, "failed");

    expect(service.inspectJob(launched.jobId).event).toMatchObject({
      state: "failed", error: { code: "invalid-input" },
    });
    expect(service.inspect().artifacts.filter(({ kind }) => kind === "field")).toHaveLength(0);
  });

  it("verifies an exact cobot CAD root to derived voxel to linked result chain", async () => {
    const plan = await exactCobotPlan("exact-cobot-chain");
    const { service, store } = await serviceForPlans(
      [plan], (request) => thermalResult(request, 7), undefined, true,
    );

    const launched = await service.launchStudy({
      studyId: "se6-upper-arm-thermal", expectedRevision: plan.document.revision,
    });
    await waitForJob(service, launched.jobId, "verified");

    expect(service.inspectJob(launched.jobId).event.state).toBe("verified");
    expect(service.inspect().artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "brep", producer: { name: "occt-wasm", version: "4.3.2" } }),
      expect.objectContaining({ kind: "render-mesh", producer: { name: "occt-wasm", version: "4.3.2" } }),
      expect.objectContaining({ id: plan.derived.record.id, kind: "sdf" }),
      expect.objectContaining({ kind: "field" }),
    ]));
    await expect(store.get(plan.derived.record.id)).resolves.toBeDefined();
  });
});
