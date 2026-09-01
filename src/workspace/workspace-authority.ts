import type { ArtifactRecord } from "../cad/artifact-contract";
import type { ArtifactPayload, ArtifactStore } from "../engineering/artifact-store";
import { WorkspaceError } from "./workspace-cad";
import type { ExportApproval, ResultComparison } from "./workspace-inspection";

function activeArtifact(artifacts: readonly ArtifactRecord[], id: string): ArtifactRecord {
  const artifact = artifacts.find((candidate) => candidate.id === id);
  if (!artifact) throw new WorkspaceError("ineligible-artifact", "Artifact is not eligible in the active design session");
  return artifact;
}

function byteLength(payload: ArtifactPayload): number {
  if (payload instanceof ArrayBuffer) return payload.byteLength;
  if (ArrayBuffer.isView(payload)) return payload.byteLength;
  return Object.values(payload).reduce((sum, value) => sum + value.byteLength, 0);
}

export async function compareWorkspaceResults(
  leftId: string,
  rightId: string,
  artifacts: readonly ArtifactRecord[],
  verifiedIds: ReadonlySet<string>,
  store: ArtifactStore,
): Promise<ResultComparison> {
  if (leftId === rightId) throw new WorkspaceError("identical-results", "Result comparison requires distinct artifact IDs");
  const left = activeArtifact(artifacts, leftId);
  const right = activeArtifact(artifacts, rightId);
  if (!verifiedIds.has(leftId) || !verifiedIds.has(rightId)) {
    throw new WorkspaceError("unverified-results", "Result comparison requires verified artifacts");
  }
  if (left.kind !== right.kind
    || left.units !== right.units || left.mediaType !== right.mediaType) {
    throw new WorkspaceError("incomparable-results", "Results do not share a comparable artifact contract");
  }
  const [leftPayload, rightPayload] = await Promise.all([store.get(leftId), store.get(rightId)]);
  if (!leftPayload || !rightPayload) throw new WorkspaceError("missing-payload", "Comparable result payload is unavailable");
  return {
    leftArtifactId: leftId,
    rightArtifactId: rightId,
    leftSourceRevision: left.sourceRevision,
    rightSourceRevision: right.sourceRevision,
    comparable: true,
    kind: left.kind,
    units: left.units,
    mediaType: left.mediaType,
    leftByteLength: byteLength(leftPayload),
    rightByteLength: byteLength(rightPayload),
  };
}

function approvalMatches(approval: ExportApproval, artifact: ArtifactRecord, headRevision: string): boolean {
  return approval.operation === "export-artifact"
    && approval.artifactId === artifact.id
    && approval.headRevision === headRevision
    && approval.sourceRevision === artifact.sourceRevision
    && approval.contentDigest === artifact.contentDigest
    && approval.mediaType === artifact.mediaType
    && approval.issuedBy.kind === "human"
    && approval.issuedBy.id.length > 0
    && approval.nonce.length > 0;
}

function ownedBlob(payload: ArtifactPayload | Uint8Array, mediaType: string): Blob {
  if (payload instanceof ArrayBuffer) return new Blob([payload.slice(0)], { type: mediaType });
  if (ArrayBuffer.isView(payload)) {
    const bytes = new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength).slice();
    return new Blob([bytes], { type: mediaType });
  }
  throw new WorkspaceError("unsupported-export-payload", "Export payload must be an owned byte sequence");
}

export async function exportWorkspaceArtifact(
  artifactId: string,
  approval: ExportApproval,
  headRevision: string,
  artifacts: readonly ArtifactRecord[],
  rawExports: ReadonlyMap<string, Uint8Array>,
  usedNonces: Set<string>,
  verify: (approval: ExportApproval, artifact: ArtifactRecord, headRevision: string) => Promise<boolean>,
  isCurrent: () => boolean,
): Promise<Blob> {
  const artifact = activeArtifact(artifacts, artifactId);
  if (artifact.kind !== "export") throw new WorkspaceError("ineligible-artifact", "Only active export artifacts may be exported");
  if (artifact.mediaType !== "model/step" || !rawExports.has(artifactId)) {
    throw new WorkspaceError(
      "ineligible-artifact",
      "Export requires service-owned exact CAD STEP bytes and provenance",
    );
  }
  if (!approvalMatches(approval, artifact, headRevision)) {
    throw new WorkspaceError("invalid-approval", "Export approval is not bound to the active artifact and human issuer");
  }
  if (usedNonces.has(approval.nonce)) throw new WorkspaceError("used-nonce", "Export approval nonce was already used");
  usedNonces.add(approval.nonce);
  try {
    if (!await verify(approval, artifact, headRevision)) {
      throw new WorkspaceError("unverified-approval", "Export approval authority did not verify the request");
    }
    if (!isCurrent()) throw new WorkspaceError("stale-approval", "Export approval is no longer current");
    const payload = rawExports.get(artifactId);
    if (!payload) throw new WorkspaceError("missing-payload", "Exact CAD export payload is unavailable");
    if (!isCurrent()) throw new WorkspaceError("stale-approval", "Export approval is no longer current");
    return ownedBlob(payload, artifact.mediaType);
  } catch (error) {
    usedNonces.delete(approval.nonce);
    throw error;
  }
}
