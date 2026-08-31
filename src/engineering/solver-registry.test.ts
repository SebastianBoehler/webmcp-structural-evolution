import { expect, it } from "vitest";

import { defineArtifactRecord } from "../cad/artifact-contract";
import { createDesignDocument } from "../cad/document-schema";
import { digestArtifactPayload } from "./artifact-store";
import type { EngineeringSolveRequest, SolverAdapter } from "./solver-adapter";
import { createSolverRegistry, SolverRegistryError } from "./solver-registry";

const capabilityError = {
  code: "unsupported-capability" as const,
  message: "Grid exceeds the bounded adapter envelope",
  limit: { kind: "dimension" as const, rule: "width must be at most 128" },
};

function adapter(
  kind: "fea" | "thermal",
  supported: boolean,
): SolverAdapter<{ gridWidth: number }, { ok: true }> {
  return {
    capability: { kind },
    supports: () => supported
      ? { supported: true }
      : { supported: false, error: capabilityError },
    run: async (request) => {
      const payload = new Uint8Array([1]).buffer as ArrayBuffer;
      return {
        output: { ok: true },
        truthLevel: "converged-numerical-solve",
        artifacts: [{
          record: await defineArtifactRecord({
            kind: "field",
            sourceRevision: request.sourceRevision,
            producer: { name: "registry-test", version: "1.0.0" },
            settingsDigest: "b".repeat(64),
            contentDigest: await digestArtifactPayload(payload),
            units: "m",
            mediaType: "application/vnd.engineering.field",
            dependencies: [],
          }),
          payload,
        }],
      };
    },
  };
}

async function request(kind: "fea" | "thermal"): Promise<EngineeringSolveRequest<{ gridWidth: number }>> {
  const document = await createDesignDocument({
    id: "link",
    label: "Link",
    units: { length: "mm", angle: "deg", mass: "kg" },
    createdBy: { kind: "human", id: "sebastian" },
  });
  return {
    jobId: `${kind}-job`,
    kind,
    sourceRevision: document.revision,
    inputArtifacts: [],
    settings: {},
    studyId: "link-study",
    input: { gridWidth: 256 },
    document,
  };
}

it("resolves one adapter per job kind and rejects structured unsupported capability decisions", async () => {
  const registry = createSolverRegistry();
  const fea = adapter("fea", true);
  const thermal = adapter("thermal", false);
  registry.register(fea);
  registry.register(thermal);

  expect(registry.resolve("fea", await request("fea"))).toBe(fea);
  try {
    registry.register(adapter("fea", true));
    throw new Error("Expected duplicate job kind to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(SolverRegistryError);
    expect(error).toMatchObject({ code: "duplicate-job-kind", kind: "fea" });
  }

  try {
    registry.resolve("thermal", await request("thermal"));
    throw new Error("Expected unsupported capability to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(SolverRegistryError);
    expect(error).toMatchObject({
      code: "unsupported-capability",
      decision: { supported: false, error: capabilityError },
    });
  }
});
