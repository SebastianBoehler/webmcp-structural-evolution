import { describe, expect, it } from "vitest";

import {
  ArtifactRecordSchema,
  createArtifactIndex,
  defineArtifactRecord,
  type ArtifactKind,
  type ArtifactRecord,
} from "./artifact-contract";
import { invalidateArtifacts } from "./artifact-invalidation";
import { createDesignDocument } from "./document-schema";

const digest = (character: string) => character.repeat(64);
const producer = { name: "cad-kernel", version: "1.0.0" };

const entity = (reference: string) => ({ kind: "entity" as const, reference });
const artifact = (artifactId: string) => ({ kind: "artifact" as const, artifactId });

function record(
  kind: ArtifactKind,
  sourceRevision: string,
  dependencies: readonly ReturnType<typeof entity | typeof artifact>[],
) {
  return {
    kind,
    sourceRevision,
    producer,
    settingsDigest: digest("a"),
    contentDigest: digest("b"),
    units: "m" as const,
    mediaType: "model/step" as const,
    dependencies,
  };
}

async function document() {
  return createDesignDocument({
    id: "pump",
    label: "Pump",
    units: { length: "mm", angle: "deg", mass: "kg" },
    createdBy: { kind: "human", id: "sebastian" },
  });
}

describe("derived artifact invalidation", () => {
  it("derives stable artifact identities from sorted dependencies", async () => {
    const design = await document();
    const dependencies = [entity("parameter:shaft-length"), entity("frame:pump-base")];
    const first = await defineArtifactRecord(record("brep", design.revision, dependencies));
    const second = await defineArtifactRecord(record("brep", design.revision, [...dependencies].reverse()));
    const { id: _id, ...withoutId } = first;

    expect(first.id).toBe(second.id);
    expect((await defineArtifactRecord(withoutId)).id).toBe(first.id);
    await expect(defineArtifactRecord({ ...withoutId, id: digest("f") })).rejects.toThrow(/artifact id/i);
  });

  it("rejects fabricated artifact identities at schema and index ingress", async () => {
    const design = await document();
    const verified = await defineArtifactRecord(record("brep", design.revision, []));
    const reparsed = await ArtifactRecordSchema.parseAsync(structuredClone(verified));
    const fabricated = { ...verified, id: digest("f") };

    expect(createArtifactIndex(design.revision, [reparsed]).artifacts).toEqual([verified]);
    await expect(ArtifactRecordSchema.parseAsync(fabricated)).rejects.toThrow(/artifact id/i);
    expect(() => createArtifactIndex(design.revision, [fabricated as ArtifactRecord]))
      .toThrow(/verified artifact record/i);
  });

  it("invalidates entity dependents and all artifact consumers", async () => {
    const design = await document();
    const nextRevision = digest("f");
    const brep = await defineArtifactRecord(record("brep", design.revision, [entity("parameter:shaft-length")]));
    const mesh = await defineArtifactRecord(record("render-mesh", design.revision, [artifact(brep.id)]));
    const thumbnail = await defineArtifactRecord(record("thumbnail", design.revision, [artifact(mesh.id)]));
    const index = createArtifactIndex(design.revision, [thumbnail, mesh, brep]);

    const result = invalidateArtifacts(index, ["parameter:shaft-length"], nextRevision);

    expect(result.invalidatedIds).toEqual([brep.id, mesh.id, thumbnail.id].sort());
    expect(result.index).toEqual({ documentRevision: nextRevision, artifacts: [] });
  });

  it("retains unrelated artifacts for descendant revisions without rewriting their source revision", async () => {
    const design = await document();
    const retained = await defineArtifactRecord(record("thumbnail", design.revision, [entity("frame:world")]));
    const changed = await defineArtifactRecord(record("brep", design.revision, [entity("parameter:shaft-length")]));
    const index = createArtifactIndex(design.revision, [changed, retained]);

    const result = invalidateArtifacts(index, ["parameter:shaft-length"], digest("f"));

    expect(result.index.artifacts).toEqual([retained]);
    expect(result.index.artifacts[0]?.sourceRevision).toBe(design.revision);
  });

  it("rejects duplicate artifact IDs and dangling artifact dependencies", async () => {
    const design = await document();
    const brep = await defineArtifactRecord(record("brep", design.revision, []));
    const dangling = await defineArtifactRecord(record("thumbnail", design.revision, [artifact(digest("e"))]));

    expect(() => createArtifactIndex(design.revision, [brep, brep])).toThrow(/duplicate artifact id/i);
    expect(() => createArtifactIndex(design.revision, [dangling])).toThrow(/dangling artifact dependency/i);
  });
});
