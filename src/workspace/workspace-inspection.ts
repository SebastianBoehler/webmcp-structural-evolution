import type { ArtifactRecord } from "../cad/artifact-contract";
import type { CadOutput } from "../cad/runtime-contracts";
import type { DesignDocument } from "../cad/document-schema";
import type { ChangedReference } from "../cad/command-schema";
import type { JobLedgerEntry } from "../engineering/job-ledger";
import type { DeepReadonly } from "../domain/snapshots";
import type { ActionReceipt } from "../domain/receipts";

export type WorkspaceInspection = DeepReadonly<{
  document: DesignDocument;
  headRevision: string;
  acceptedRevision: string;
  artifacts: readonly ArtifactRecord[];
  artifactCount: number;
  invalidatedArtifactCount: number;
  jobs: readonly JobLedgerEntry[];
  receipts: readonly ActionReceipt[];
  receiptCount: number;
}>;

export type TransactionPreview = DeepReadonly<{
  sourceRevision: string;
  previewRevision: string;
  changed: boolean;
  changedReferences: readonly ChangedReference[];
  outputs: readonly CadOutput[];
  artifacts: readonly ArtifactRecord[];
}>;

export type ResultComparison = DeepReadonly<{
  leftArtifactId: string;
  rightArtifactId: string;
  sourceRevision: string;
  comparable: true;
  kind: ArtifactRecord["kind"];
  units: ArtifactRecord["units"];
  mediaType: string;
  leftByteLength: number;
  rightByteLength: number;
}>;

export type ExportApproval = DeepReadonly<{
  operation: "export-artifact";
  artifactId: string;
  headRevision: string;
  sourceRevision: string;
  contentDigest: string;
  mediaType: string;
  issuedBy: { kind: "human"; id: string };
  nonce: string;
}>;
