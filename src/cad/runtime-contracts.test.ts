import { describe, expect, it } from "vitest";

import { canonicalJson } from "../domain/canonical-json";
import { defineArtifactRecord, type ArtifactKind } from "./artifact-contract";
import { createDesignDocument } from "./document-schema";
import { digestCadOutputPayload } from "./rebuild-payload";
import {
  CadEvaluationEventSchema,
  CadEvaluationRequestSchema,
  ExactStepImportRequestSchema,
  ExactStepImportResultSchema,
  defineCadEvaluationRequest,
  EngineeringJobEventSchema,
  EngineeringJobRequestSchema,
} from "./runtime-contracts";

const digest = "a".repeat(64);

async function outputArtifact(kind: ArtifactKind, contentDigest = "d".repeat(64)) {
  return defineArtifactRecord({
    kind,
    sourceRevision: digest,
    producer: { name: "cad-kernel", version: "1" },
    settingsDigest: "c".repeat(64),
    contentDigest,
    units: "mm",
    mediaType: "application/octet-stream",
    dependencies: [],
  });
}

const massProperties = {
  densityKgM3: 1,
  volumeM3: 0.000032,
  surfaceAreaM2: 0.0088,
  massKg: 0.000032,
  centerOfMassM: [0.04, 0.02, 0.005] as [number, number, number],
  inertiaKgM2: [1, 0, 0, 0, 1, 0, 0, 0, 1] as [number, number, number, number, number, number, number, number, number],
};

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
    const success = {
      requestId: "request-1",
      state: "succeeded",
      requestedOutputs: ["mass-properties"],
      results: [{ output: "mass-properties", payload: massProperties }],
    } as const;

    await expect(CadEvaluationEventSchema.parseAsync(success)).resolves.toEqual(success);
    await expect(CadEvaluationEventSchema.parseAsync({ ...success, results: [] })).rejects.toThrow();
    await expect(CadEvaluationEventSchema.parseAsync({
      ...success,
      results: [{ output: "section-curves", payload: {
        pointsM: new Float32Array(), curvePointRanges: new Uint32Array(), curveIds: [],
      } }],
    })).rejects.toThrow();
  });

  it("requires transferable exact bytes to match their artifact content digest", async () => {
    const payload = { bytes: new Uint8Array([0x42, 0x52, 0x45, 0x50]) };
    const artifact = await defineArtifactRecord({
      kind: "brep",
      sourceRevision: digest,
      producer: { name: "occt-wasm", version: "4.3.2" },
      settingsDigest: "c".repeat(64),
      contentDigest: await digestCadOutputPayload(payload),
      units: "m",
      mediaType: "application/vnd.opencascade.brep",
      dependencies: [],
    });
    const success = {
      requestId: "request-1",
      state: "succeeded",
      requestedOutputs: ["brep"],
      results: [{ output: "brep", artifact, payload }],
    } as const;

    await expect(CadEvaluationEventSchema.parseAsync(success)).resolves.toMatchObject(success);
    await expect(CadEvaluationEventSchema.parseAsync({
      ...success,
      results: [{ ...success.results[0], payload: { bytes: new Uint8Array([0]) } }],
    })).rejects.toThrow(/content digest/i);
  });

  it("rejects CAD outputs backed by an incompatible artifact kind", async () => {
    const payload = { bytes: new TextEncoder().encode("ISO-10303-21") };
    const contentDigest = await digestCadOutputPayload(payload);
    const step = await outputArtifact("export", contentDigest);
    const thumbnail = await outputArtifact("thumbnail", contentDigest);
    const success = {
      requestId: "request-1",
      state: "succeeded",
      requestedOutputs: ["step"],
      results: [{ output: "step", artifact: step, payload }],
    } as const;

    await expect(CadEvaluationEventSchema.parseAsync(success)).resolves.toEqual(success);
    await expect(CadEvaluationEventSchema.parseAsync({
      ...success,
      results: [{ output: "step", artifact: thumbnail, payload }],
    })).rejects.toThrow(/step.*export/i);
  });

  it("binds exact STEP imports to their source export and returned BREP bytes", async () => {
    const stepPayload = { bytes: new TextEncoder().encode("ISO-10303-21") };
    const step = await outputArtifact("export", await digestCadOutputPayload(stepPayload));
    const request = {
      requestId: "step-import-1", sourceRevision: digest,
      step: { artifact: step, payload: stepPayload }, settings: { gate: "browser" },
    } as const;
    const brepPayload = { bytes: new Uint8Array([0x42, 0x52, 0x45, 0x50]) };
    const brep = await defineArtifactRecord({
      kind: "brep", sourceRevision: digest,
      producer: { name: "occt-wasm", version: "4.3.2" },
      settingsDigest: "c".repeat(64), contentDigest: await digestCadOutputPayload(brepPayload),
      units: "m", mediaType: "application/vnd.opencascade.brep",
      dependencies: [{ kind: "artifact", artifactId: step.id }],
    });
    const result = {
      requestId: request.requestId, sourceRevision: digest, sourceArtifactId: step.id,
      artifact: brep, payload: brepPayload, massProperties,
      envelopeM: { minimum: [0, 0, 0], maximum: [0.1, 0.04, 0.02] },
      solidCount: 1, invalidSolidCount: 0,
    } as const;

    await expect(ExactStepImportRequestSchema.parseAsync(request)).resolves.toMatchObject(request);
    await expect(ExactStepImportResultSchema.parseAsync(result)).resolves.toMatchObject(result);
    await expect(ExactStepImportRequestSchema.parseAsync({
      ...request, step: { ...request.step, payload: { bytes: new Uint8Array([0]) } },
    })).rejects.toThrow(/content digest/i);
    await expect(ExactStepImportResultSchema.parseAsync({
      ...result, payload: { bytes: new Uint8Array([0]) },
    })).rejects.toThrow(/content digest/i);
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
