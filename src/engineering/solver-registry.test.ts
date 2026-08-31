import { expect, it } from "vitest";

import { createDesignDocument } from "../cad/document-schema";
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
    run: async () => ({ ok: true }),
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
