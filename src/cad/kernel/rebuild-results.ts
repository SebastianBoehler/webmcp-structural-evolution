import { defineArtifactRecord, type ArtifactKind, type ArtifactRecord } from "../artifact-contract";
import { revisionId } from "../../domain/revisions";
import type { CadEvaluationEvent, CadEvaluationRequest, CadOutput } from "../runtime-contracts";
import { digestCadOutputPayload } from "../rebuild-payload";
import type { CadRebuildPayload } from "./feature-rebuild";

type CadSuccess = Extract<CadEvaluationEvent, { state: "succeeded" }>;
type CadResult = CadSuccess["results"][number];

const producer = { name: "occt-wasm", version: "4.3.2" } as const;

const artifactDefinition = {
  brep: { kind: "brep", mediaType: "application/vnd.opencascade.brep", units: "m" },
  "semantic-mesh": { kind: "render-mesh", mediaType: "application/vnd.structural-evolution.semantic-mesh", units: "m" },
  step: { kind: "export", mediaType: "model/step", units: "mm" },
} as const satisfies Record<"brep" | "semantic-mesh" | "step", {
  readonly kind: ArtifactKind;
  readonly mediaType: string;
  readonly units: "m" | "mm";
}>;

async function artifactFor(
  request: CadEvaluationRequest,
  output: keyof typeof artifactDefinition,
  payload: unknown,
): Promise<ArtifactRecord> {
  const definition = artifactDefinition[output];
  return defineArtifactRecord({
    kind: definition.kind,
    sourceRevision: request.sourceRevision,
    producer,
    settingsDigest: await revisionId({ output, settings: request.settings }),
    contentDigest: await digestCadOutputPayload(payload),
    units: definition.units,
    mediaType: definition.mediaType,
    dependencies: [
      ...request.document.parameters.map(({ id }) => ({
        kind: "entity" as const,
        reference: `parameter:${id}`,
      })),
      ...request.document.bodies.map(({ id }) => ({
        kind: "entity" as const,
        reference: `body:${id}`,
      })),
    ],
  });
}

function missingOutput(output: CadOutput): never {
  throw new Error(`Exact rebuild omitted requested output: ${output}`);
}

export async function buildCadEvaluationResults(
  request: CadEvaluationRequest,
  payload: CadRebuildPayload,
): Promise<CadSuccess["results"]> {
  const results: CadResult[] = [];
  for (const output of request.requestedOutputs) {
    switch (output) {
      case "brep": {
        const exact = payload.brep ?? missingOutput(output);
        results.push({ output, artifact: await artifactFor(request, output, exact), payload: exact });
        break;
      }
      case "semantic-mesh": {
        const mesh = payload.semanticMesh ?? missingOutput(output);
        results.push({ output, artifact: await artifactFor(request, output, mesh), payload: mesh });
        break;
      }
      case "mass-properties":
        results.push({ output, payload: payload.massProperties ?? missingOutput(output) });
        break;
      case "section-curves":
        results.push({ output, payload: payload.sectionCurves ?? missingOutput(output) });
        break;
      case "step": {
        const step = payload.step ?? missingOutput(output);
        results.push({ output, artifact: await artifactFor(request, output, step), payload: step });
        break;
      }
    }
  }
  return results;
}
