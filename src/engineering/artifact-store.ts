import { ArtifactRecordSchema, type ArtifactRecord } from "../cad/artifact-contract";
import {
  ArtifactStoreError,
  artifactPayloadInternals,
  type ArtifactPayload,
  type StoredArtifactPayload,
} from "./artifact-payload";

export {
  ArtifactStoreError,
  type ArtifactPayload,
  type ArtifactStoreErrorCode,
} from "./artifact-payload";

export type ArtifactStoreBatchEntry = Readonly<{
  record: ArtifactRecord;
  payload: ArtifactPayload;
}>;

export type ArtifactStoreCommitGuard = () => boolean;

export interface ArtifactStore {
  put(record: ArtifactRecord, payload: ArtifactPayload): Promise<void>;
  commit(entries: readonly ArtifactStoreBatchEntry[], guard: ArtifactStoreCommitGuard): Promise<void>;
  get(id: string): Promise<ArtifactPayload | undefined>;
  delete(ids: readonly string[]): Promise<void>;
}

type StoredArtifact = Readonly<{
  payload: StoredArtifactPayload;
  payloadDigest: string;
  representation: string;
}>;

type PreparedArtifact = Readonly<{
  record: ArtifactRecord;
  payload: StoredArtifactPayload;
  payloadDigest: string;
  representation: string;
}>;

type OwnedArtifactEntry = Readonly<{
  record: unknown;
  payload: StoredArtifactPayload;
}>;

function own(entry: ArtifactStoreBatchEntry): OwnedArtifactEntry {
  let record: unknown;
  try {
    record = structuredClone(entry.record);
  } catch {
    throw new ArtifactStoreError("invalid-artifact-record", "Artifact metadata cannot be owned for canonical verification");
  }
  return { record, payload: artifactPayloadInternals.normalize(entry.payload) };
}

async function prepare(entry: OwnedArtifactEntry): Promise<PreparedArtifact> {
  let record: ArtifactRecord;
  try {
    record = await ArtifactRecordSchema.parseAsync(entry.record);
  } catch {
    throw new ArtifactStoreError("invalid-artifact-record", "Artifact metadata failed canonical identity verification");
  }
  const payloadDigest = await artifactPayloadInternals.digest(entry.payload);
  if (payloadDigest !== record.contentDigest) {
    throw new ArtifactStoreError("content-digest-mismatch", "Artifact payload does not match its content digest");
  }
  return {
    record,
    payload: entry.payload,
    payloadDigest,
    representation: artifactPayloadInternals.representation(entry.payload),
  };
}

function equivalent(left: Pick<StoredArtifact, "payloadDigest" | "representation">, right: PreparedArtifact): boolean {
  return left.payloadDigest === right.payloadDigest && left.representation === right.representation;
}

async function prepareBatch(entries: readonly ArtifactStoreBatchEntry[]): Promise<readonly PreparedArtifact[]> {
  const owned = entries.map(own);
  const prepared: PreparedArtifact[] = [];
  const byId = new Map<string, PreparedArtifact>();
  for (const entry of owned) {
    const next = await prepare(entry);
    const previous = byId.get(next.record.id);
    if (previous && !equivalent(previous, next)) {
      throw new ArtifactStoreError("duplicate-artifact-id", `Artifact ID appears with different payload forms: ${next.record.id}`);
    }
    if (!previous) byId.set(next.record.id, next);
    prepared.push(next);
  }
  return prepared;
}

export async function digestArtifactPayload(payload: ArtifactPayload): Promise<string> {
  return artifactPayloadInternals.digest(artifactPayloadInternals.normalize(payload));
}

export function createArtifactStore(): ArtifactStore {
  const artifacts = new Map<string, StoredArtifact>();
  const commit = async (
    entries: readonly ArtifactStoreBatchEntry[],
    guard: ArtifactStoreCommitGuard,
  ): Promise<void> => {
    const prepared = await prepareBatch(entries);
    for (const next of prepared) {
      const existing = artifacts.get(next.record.id);
      if (existing && !equivalent(existing, next)) {
        throw new ArtifactStoreError("duplicate-artifact-id", `Artifact ID already stores a different payload form: ${next.record.id}`);
      }
    }
    if (!guard()) {
      throw new ArtifactStoreError("commit-guard-rejected", "Artifact batch commit is no longer current");
    }
    for (const next of prepared) {
      if (!artifacts.has(next.record.id)) {
        artifacts.set(next.record.id, {
          payload: next.payload,
          payloadDigest: next.payloadDigest,
          representation: next.representation,
        });
      }
    }
  };
  return {
    async put(record, payload): Promise<void> {
      await commit([{ record, payload }], () => true);
    },
    commit,
    async get(id): Promise<ArtifactPayload | undefined> {
      const stored = artifacts.get(id);
      return stored === undefined ? undefined : artifactPayloadInternals.copy(stored.payload);
    },
    async delete(ids): Promise<void> {
      for (const id of new Set(ids)) artifacts.delete(id);
    },
  };
}

export async function synchronizeArtifactStoreInvalidation(
  store: ArtifactStore,
  invalidation: Readonly<{ invalidatedIds: readonly string[] }>,
): Promise<void> {
  await store.delete([...new Set(invalidation.invalidatedIds)].sort());
}
