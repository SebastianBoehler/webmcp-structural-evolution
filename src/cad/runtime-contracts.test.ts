import { describe, expect, it } from "vitest";

import { canonicalJson } from "../domain/canonical-json";
import { createDesignDocument } from "./document-schema";
import {
  CadEvaluationRequestSchema,
  EngineeringJobEventSchema,
  EngineeringJobRequestSchema,
} from "./runtime-contracts";

const digest = "a".repeat(64);

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
