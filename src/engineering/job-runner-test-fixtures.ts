import { defineArtifactRecord, type ArtifactRecord } from "../cad/artifact-contract";
import { defineDesignDocument, type DesignDocument } from "../cad/document-schema";
import { defineEngineeringSolveRequest } from "../cad/engineering-job-contract";
import type { ArtifactPayload, ArtifactStore } from "./artifact-store";
import type { EngineeringSolveRequest, SolverAdapter, SolverRunResult } from "./solver-adapter";

export type SolveInput = { readonly grid: readonly [number, number, number] };
export type SolveOutput = { readonly status: "complete" };

const human = { kind: "human", id: "sebastian" } as const;

export function bytes(...values: number[]): ArrayBuffer {
  return Uint8Array.from(values).buffer as ArrayBuffer;
}

export async function sourceDocument(label = "Link"): Promise<DesignDocument> {
  return defineDesignDocument({
    id: "link",
    label,
    schemaVersion: 3,
    units: { length: "mm", angle: "deg", mass: "kg" },
    createdBy: human,
    frames: [{
      id: "world", label: "World",
      transform: {
        position: {
          x: { value: 0, unit: "m" }, y: { value: 0, unit: "m" }, z: { value: 0, unit: "m" },
        },
        orientation: {
          roll: { value: 0, unit: "rad" }, pitch: { value: 0, unit: "rad" }, yaw: { value: 0, unit: "rad" },
        },
      },
    }],
    parameters: [],
    sketches: [{
      id: "link-profile", plane: "frame:world", constraints: [],
      entities: [{ id: "outline", kind: "rectangle", centerM: [0, 0], sizeM: [0.1, 0.02] }],
    }],
    features: [{ id: "link-feature", kind: "extrude", sketchId: "link-profile", distanceM: 0.01 }],
    bodies: [{ id: "link-body", featureId: "link-feature" }],
    components: [], instances: [], mates: [],
    namedSelections: ["fixed-end", "tip"].map((id, index) => ({
      id,
      reference: {
        bodyId: "link-body", ownerFeatureId: "link-feature", expectedKind: "face",
        stableId: `face:link-body:${id}`,
        signature: { geometry: "plane", centroidM: [index * 0.1, 0, 0], measureSI: 0.0002, adjacentKinds: ["plane"] },
      },
    })),
    materials: [{
      id: "al-6061", kind: "isotropic", densityKgM3: 2700, youngsModulusPa: 68.9e9,
      poissonRatio: 0.33, failureStressPa: 276e6,
    }],
    studies: [{
      id: "link-static", kind: "structural-linear", bodyIds: ["link-body"], materialId: "al-6061",
      supports: ["fixed-end"], loads: [{ selectionId: "tip", forceN: [0, -500, 0] }],
    }],
  });
}

export async function request(
  document: DesignDocument,
  jobId: string,
  inputArtifacts: readonly ArtifactRecord[] = [],
): Promise<EngineeringSolveRequest<SolveInput>> {
  return defineEngineeringSolveRequest({
    jobId,
    kind: "fea",
    sourceRevision: document.revision,
    inputArtifacts,
    settings: {},
    studyId: "link-static",
    input: { grid: [8, 4, 2] },
    document,
  });
}

export function studyDependency(requestValue: EngineeringSolveRequest<unknown>) {
  return [{ kind: "entity", reference: `study:${requestValue.studyId}` }] as const;
}

export async function artifactForResult(
  requestValue: EngineeringSolveRequest<unknown>,
  payload: ArtifactPayload = bytes(1, 2, 3),
  dependencies: readonly unknown[] = studyDependency(requestValue),
): Promise<ArtifactRecord> {
  const { digestArtifactPayload } = await import("./artifact-store");
  return defineArtifactRecord({
    kind: "field",
    sourceRevision: requestValue.sourceRevision,
    producer: { name: "structural-adapter", version: "1.0.0" },
    settingsDigest: "b".repeat(64),
    contentDigest: await digestArtifactPayload(payload),
    units: "m",
    mediaType: "application/vnd.engineering.field",
    dependencies,
  });
}

export async function resultFor(
  requestValue: EngineeringSolveRequest<unknown>,
  payload: ArtifactPayload = bytes(1, 2, 3),
  dependencies: readonly unknown[] = studyDependency(requestValue),
): Promise<SolverRunResult<SolveOutput>> {
  const record = await artifactForResult(requestValue, payload, dependencies);
  return {
    output: { status: "complete" },
    truthLevel: "converged-numerical-solve",
    artifacts: [{ record, payload }],
  };
}

export function adapter(
  run: SolverAdapter<SolveInput, SolveOutput>["run"],
  supported = true,
): SolverAdapter<SolveInput, SolveOutput> {
  return {
    capability: { kind: "fea" },
    supports: () => supported
      ? { supported: true }
      : {
        supported: false,
        error: {
          code: "unsupported-capability",
          message: "Grid exceeds the bounded adapter envelope",
          limit: { kind: "dimension", rule: "width must be at most 128" },
        },
      },
    run,
  };
}

export function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  return {
    promise: new Promise<Value>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; }),
    resolve,
    reject,
  };
}

export async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for solver adapter dispatch");
}

export function delayedBatchStore() {
  const payloads = new Map<string, ArtifactPayload>();
  const release = deferred<void>();
  let entered = false;
  const store = {
    async get(id: string): Promise<ArtifactPayload | undefined> {
      return payloads.get(id);
    },
    async delete(ids: readonly string[]): Promise<void> {
      for (const id of ids) payloads.delete(id);
    },
    async put(record: ArtifactRecord, payload: ArtifactPayload): Promise<void> {
      entered = true;
      payloads.set(record.id, payload);
      await release.promise;
    },
    async commit(
      entries: readonly Readonly<{ record: ArtifactRecord; payload: ArtifactPayload }>[],
      guard: () => boolean,
    ): Promise<void> {
      entered = true;
      await release.promise;
      if (!guard()) return;
      for (const entry of entries) payloads.set(entry.record.id, entry.payload);
    },
  } as unknown as ArtifactStore;
  return { store, payloads, entered: () => entered, release: () => release.resolve(undefined) };
}
