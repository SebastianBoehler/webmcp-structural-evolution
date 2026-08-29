import { describe, expect, it } from "vitest";

import { canonicalJson } from "../domain/canonical-json";
import { createDesignDocument } from "./document-schema";
import {
  CadEvaluationEventSchema,
  CadEvaluationRequestSchema,
  EngineeringJobEventSchema,
  EngineeringJobRequestSchema,
} from "./runtime-contracts";

const digest = "a".repeat(64);
const outputArtifact = {
  id: "b".repeat(64),
  kind: "brep",
  sourceRevision: digest,
  producer: { name: "cad-kernel", version: "1" },
  settingsDigest: "c".repeat(64),
  contentDigest: "d".repeat(64),
  units: "mm",
  mediaType: "application/octet-stream",
  dependencies: [],
} as const;

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

  it("requires every CAD success result to cover a declared output", () => {
    const success = {
      requestId: "request-1",
      state: "succeeded",
      requestedOutputs: ["brep"],
      results: [{ output: "brep", artifact: outputArtifact }],
    } as const;

    expect(CadEvaluationEventSchema.parse(success)).toEqual(success);
    expect(() => CadEvaluationEventSchema.parse({ ...success, results: [] })).toThrow();
    expect(() => CadEvaluationEventSchema.parse({
      ...success,
      results: [{ output: "mass-properties", artifact: outputArtifact }],
    })).toThrow();
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
