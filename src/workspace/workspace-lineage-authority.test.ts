import { describe, expect, it, vi } from "vitest";

import { defineArtifactRecord } from "../cad/artifact-contract";
import { digestArtifactPayload } from "../engineering/artifact-store";
import type { EngineeringSolveRequest } from "../engineering/solver-adapter";
import {
  exactCobotPlan, redefineInput, serviceForPlans, thermalResult,
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
    })).rejects.toThrow(/service-issued derivation receipt/i);
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
    })).rejects.toThrow(/service-issued derivation receipt/i);
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

  it("rejects a preloaded derived input without a service-issued receipt", async () => {
    const plan = await exactCobotPlan("exact-cobot-chain");
    const { service, store } = await serviceForPlans(
      [plan], (request) => thermalResult(request, 7), undefined, true,
    );

    await expect(service.launchStudy({
      studyId: "se6-upper-arm-thermal", expectedRevision: plan.document.revision,
    })).rejects.toThrow(/service-issued derivation receipt/i);
    expect(service.inspect().artifacts.filter(({ kind }) => kind === "field")).toHaveLength(0);
    await expect(store.get(plan.derived.record.id)).resolves.toBeDefined();
  });
});
