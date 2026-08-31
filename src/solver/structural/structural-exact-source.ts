import type { ArtifactRecord } from "../../cad/artifact-contract";
import type { DesignDocument } from "../../cad/document-schema";
import { createOcctCadAdapter } from "../../cad/kernel/occt-adapter";
import type { OpaqueBytesPayload, SemanticMeshPayload } from "../../cad/rebuild-payload";
import { defineCadEvaluationRequest, type CadEvaluationEvent } from "../../cad/runtime-contracts";

export interface StructuralExactSource {
  readonly brepArtifact: ArtifactRecord;
  readonly brepPayload: OpaqueBytesPayload;
  readonly semanticArtifact: ArtifactRecord;
  readonly semanticMeshPayload: SemanticMeshPayload;
}

export async function rebuildStructuralExactSource(
  document: DesignDocument, signal: AbortSignal,
): Promise<StructuralExactSource> {
  const terminals: CadEvaluationEvent[] = [];
  const requestId = `structural-voxel-source-${crypto.randomUUID()}`;
  const request = await defineCadEvaluationRequest({
    requestId, document, sourceRevision: document.revision,
    requestedOutputs: ["brep", "semantic-mesh"],
    settings: { consumer: "occt-exact-brep-voxelizer-v1" },
  });
  await createOcctCadAdapter().evaluate(request, signal, (event) => {
    if (event.state !== "progress") terminals.push(event);
  });
  if (terminals.length !== 1) throw new Error("Exact structural rebuild emitted an invalid terminal sequence");
  const terminal = terminals[0]!;
  if (terminal.state !== "succeeded" || terminal.requestId !== requestId
    || terminal.sourceRevision !== document.revision) {
    throw new Error(terminal.state === "failed"
      ? `Exact structural rebuild failed (${terminal.error.code}): ${terminal.error.message}`
      : "Exact structural rebuild did not return a same-request success");
  }
  const brep = terminal.results.find(({ output }) => output === "brep");
  const semantic = terminal.results.find(({ output }) => output === "semantic-mesh");
  if (!brep || brep.output !== "brep" || !semantic || semantic.output !== "semantic-mesh") {
    throw new Error("Exact structural rebuild omitted its BREP or semantic mesh");
  }
  return {
    brepArtifact: brep.artifact, brepPayload: brep.payload,
    semanticArtifact: semantic.artifact, semanticMeshPayload: semantic.payload,
  };
}
