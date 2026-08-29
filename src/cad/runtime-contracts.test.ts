import { describe, expect, it } from "vitest";

import { canonicalJson } from "../domain/canonical-json";
import { defineArtifactRecord, type ArtifactKind } from "./artifact-contract";
import { createDesignDocument } from "./document-schema";
import {
  CadEvaluationEventSchema,
  CadEvaluationRequestSchema,
  defineCadEvaluationRequest,
  EngineeringJobEventSchema,
  EngineeringJobRequestSchema,
} from "./runtime-contracts";

const digest = "a".repeat(64);

async function outputArtifact(kind: ArtifactKind) {
  return defineArtifactRecord({
    kind,
    sourceRevision: digest,
    producer: { name: "cad-kernel", version: "1" },
    settingsDigest: "c".repeat(64),
    contentDigest: "d".repeat(64),
    units: "mm",
    mediaType: "application/octet-stream",
    dependencies: [],
  });
}

async function evaluationRequest() {
  const document = await createDesignDocument({
    id: "pump",
    label: "Pump",
    units: { length: "mm", angle: "deg", mass: "kg" },
    createdBy: { kind: "human", id: "sebastian" },
  });
  return {
    requestId: "request-1",
    document,
    sourceRevision: document.revision,
    requestedOutputs: ["brep", "mass-properties"] as const,
    settings: { tolerance: 0.001 },
  };
}

describe("CAD runtime contracts", () => {
  it("serializes a CAD evaluation request and rejects unsupported outputs", async () => {
    const request = await evaluationRequest();

    expect(CadEvaluationRequestSchema.parse(request)).toEqual(request);
    expect(() => CadEvaluationRequestSchema.parse({ ...request, requestedOutputs: ["fake-solid"] })).toThrow();
  });

  it("re-derives the embedded document revision at verified request ingress", async () => {
    const request = await evaluationRequest();
    const tampered = {
      ...request,
      document: { ...request.document, label: "Tampered pump" },
    };

    expect(CadEvaluationRequestSchema.parse(tampered)).toEqual(tampered);
    await expect(defineCadEvaluationRequest(tampered)).rejects.toThrow(/revision/i);
    await expect(defineCadEvaluationRequest(request)).resolves.toEqual(request);
  });

  it("requires every CAD success result to cover a declared output", async () => {
    const brep = await outputArtifact("brep");
    const success = {
      requestId: "request-1",
      state: "succeeded",
      requestedOutputs: ["brep"],
      results: [{ output: "brep", artifact: brep }],
    } as const;

    await expect(CadEvaluationEventSchema.parseAsync(success)).resolves.toEqual(success);
    await expect(CadEvaluationEventSchema.parseAsync({ ...success, results: [] })).rejects.toThrow();
    await expect(CadEvaluationEventSchema.parseAsync({
      ...success,
      results: [{ output: "mass-properties", artifact: brep }],
    })).rejects.toThrow();
  });

  it("rejects CAD outputs backed by an incompatible artifact kind", async () => {
    const step = await outputArtifact("export");
    const thumbnail = await outputArtifact("thumbnail");
    const success = {
      requestId: "request-1",
      state: "succeeded",
      requestedOutputs: ["step"],
      results: [{ output: "step", artifact: step }],
    } as const;

    await expect(CadEvaluationEventSchema.parseAsync(success)).resolves.toEqual(success);
    await expect(CadEvaluationEventSchema.parseAsync({
      ...success,
      results: [{ output: "step", artifact: thumbnail }],
    })).rejects.toThrow(/step.*export/i);
  });

  it("keeps truth levels exclusive to verified engineering events", () => {
    expect(EngineeringJobEventSchema.parse({
      jobId: "job-1",
      state: "partial",
      progress: 0.5,
      artifacts: [],
    })).toMatchObject({ state: "partial" });
    expect(() => EngineeringJobEventSchema.parse({
      jobId: "job-1",
      state: "partial",
      truthLevel: "converged-numerical-solve",
      progress: 0.5,
      artifacts: [],
    })).toThrow();
  });

  it("requires completed progress and result evidence for verified engineering events", async () => {
    const result = await outputArtifact("field");
    const verified = {
      jobId: "job-1",
      state: "verified",
      truthLevel: "converged-numerical-solve",
      progress: 1,
      artifacts: [result],
    } as const;

    await expect(EngineeringJobEventSchema.parseAsync(verified)).resolves.toEqual(verified);
    await expect(EngineeringJobEventSchema.parseAsync({
      ...verified,
      progress: 0,
      artifacts: [],
    })).rejects.toThrow();
    await expect(EngineeringJobEventSchema.parseAsync({
      ...verified,
      artifacts: [],
    })).rejects.toThrow();
  });

  it("keeps engineering jobs canonical-JSON serializable", () => {
    const job = {
      jobId: "job-1",
      kind: "fea",
      sourceRevision: digest,
      inputArtifacts: [],
      settings: { loadCase: "static" },
    };

    expect(canonicalJson(EngineeringJobRequestSchema.parse(job))).toContain('"sourceRevision"');
  });
});
