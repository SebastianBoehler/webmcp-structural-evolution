import type { ArtifactRecord } from "../cad/artifact-contract";
import { revisionId } from "../domain/revisions";
import { digestArtifactPayload } from "../engineering/artifact-store";
import type { ExactComponentSource } from "./exact-component-source";
import type { StudyCompilation } from "./workspace-study-plan";

declare const derivationReceiptBrand: unique symbol;
export type WorkspaceDerivationReceipt = Readonly<{
  [derivationReceiptBrand]: "workspace-service-issued";
}>;

type ReceiptBinding = Readonly<{
  documentRevision: string;
  studyId: string;
  kind: string;
  intentDigest: string;
  exactArtifacts: readonly string[];
  requestInputs: readonly string[];
  derivedArtifacts: readonly string[];
  compiledInputs: readonly string[];
}>;

export interface WorkspaceDerivationAuthority {
  issue(input: Readonly<{
    exact: ExactComponentSource;
    compilation: StudyCompilation;
    intentDigest: string;
  }>): Promise<WorkspaceDerivationReceipt>;
  verify(receipt: WorkspaceDerivationReceipt, input: Readonly<{
    exact: ExactComponentSource;
    compilation: StudyCompilation;
    intentDigest: string;
  }>): Promise<boolean>;
}

const identity = ({ id, contentDigest }: ArtifactRecord) => `${id}:${contentDigest}`;
const sortedIdentities = (records: readonly ArtifactRecord[]) => records.map(identity).sort();

function binding(
  exact: ExactComponentSource, compilation: StudyCompilation, intentDigest: string,
): ReceiptBinding {
  const exactIds = new Set(exact.allArtifacts.map(({ id }) => id));
  const requestInputs = compilation.request.inputArtifacts;
  return {
    documentRevision: compilation.request.sourceRevision,
    studyId: compilation.request.studyId,
    kind: compilation.request.kind,
    intentDigest,
    exactArtifacts: sortedIdentities(exact.allArtifacts),
    requestInputs: sortedIdentities(requestInputs),
    derivedArtifacts: sortedIdentities(requestInputs.filter(({ id }) => !exactIds.has(id))),
    compiledInputs: sortedIdentities(compilation.inputs.map(({ record }) => record)),
  };
}

async function assertExactPayloads(exact: ExactComponentSource): Promise<void> {
  if (exact.entries.length !== exact.allArtifacts.length) {
    throw new Error("Exact component receipt source has incomplete payload coverage");
  }
  for (const entry of exact.entries) {
    if (await digestArtifactPayload(entry.payload) !== entry.record.contentDigest) {
      throw new Error(`Exact component receipt payload digest mismatch: ${entry.record.id}`);
    }
  }
}

export function createWorkspaceDerivationAuthority(): WorkspaceDerivationAuthority {
  const issued = new WeakMap<object, string>();
  return {
    async issue(input) {
      await assertExactPayloads(input.exact);
      const receipt = Object.freeze({}) as WorkspaceDerivationReceipt;
      issued.set(receipt, await revisionId(binding(input.exact, input.compilation, input.intentDigest)));
      return receipt;
    },
    async verify(receipt, input) {
      const expected = issued.get(receipt);
      return expected !== undefined
        && expected === await revisionId(binding(input.exact, input.compilation, input.intentDigest));
    },
  };
}
