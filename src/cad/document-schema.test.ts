import { describe, expect, it } from "vitest";

import { revisionId } from "../domain/revisions";
import {
  createDesignDocument,
  defineDesignDocument,
  EntityIdSchema,
  SemanticReferenceSchema,
  type DesignDocument,
} from "./document-schema";

describe("DesignDocument", () => {
  it("migrates serialized v1 content through v4 with an exact provenance chain", async () => {
    const legacyContent = {
      id: "legacy-pump",
      label: "Legacy pump",
      schemaVersion: 1 as const,
      units: { length: "mm" as const, angle: "deg" as const, mass: "kg" as const },
      createdBy: { kind: "human" as const, id: "sebastian" },
      frames: [{
        id: "world", label: "World",
        transform: {
          position: {
            x: { value: 0, unit: "m" as const },
            y: { value: 0, unit: "m" as const },
            z: { value: 0, unit: "m" as const },
          },
          orientation: {
            roll: { value: 0, unit: "rad" as const },
            pitch: { value: 0, unit: "rad" as const },
            yaw: { value: 0, unit: "rad" as const },
          },
        },
      }],
      parameters: [],
    };
    const legacyRevision = await revisionId(legacyContent);

    const migrated = await defineDesignDocument({ ...legacyContent, revision: legacyRevision });

    const v2Content = {
      ...legacyContent,
      schemaVersion: 2 as const,
      migrationProvenance: { sourceSchemaVersion: 1 as const, sourceRevision: legacyRevision },
      sketches: [], features: [], bodies: [], components: [], instances: [], mates: [], namedSelections: [],
    };
    const v2Revision = await revisionId(v2Content);
    const v3Content = {
      ...v2Content,
      schemaVersion: 3 as const,
      migrationProvenance: {
        sourceSchemaVersion: 2 as const, sourceRevision: v2Revision,
        sourceMigrationProvenance: v2Content.migrationProvenance,
      },
      materials: [], studies: [],
    };
    const v3Revision = await revisionId(v3Content);

    expect(migrated).toMatchObject({
      schemaVersion: 4,
      migrationProvenance: {
        sourceSchemaVersion: 3,
        sourceRevision: v3Revision,
        sourceMigrationProvenance: {
          sourceSchemaVersion: 2,
          sourceRevision: v2Revision,
          sourceMigrationProvenance: { sourceSchemaVersion: 1, sourceRevision: legacyRevision },
        },
      },
      sketches: [], features: [], bodies: [], components: [], instances: [], mates: [], namedSelections: [],
      materials: [], studies: [],
    });
    expect(migrated.revision).not.toBe(legacyRevision);
    const { revision: _revision, ...migratedContent } = migrated;
    expect(migrated.revision).toBe(await revisionId(migratedContent));
  });

  it("migrates serialized v2 content through v3 without reusing either content address", async () => {
    const v2Content = {
      id: "v2-pump",
      label: "V2 pump",
      schemaVersion: 2 as const,
      units: { length: "mm" as const, angle: "deg" as const, mass: "kg" as const },
      createdBy: { kind: "human" as const, id: "sebastian" },
      frames: [{
        id: "world", label: "World",
        transform: {
          position: { x: { value: 0, unit: "m" as const }, y: { value: 0, unit: "m" as const }, z: { value: 0, unit: "m" as const } },
          orientation: { roll: { value: 0, unit: "rad" as const }, pitch: { value: 0, unit: "rad" as const }, yaw: { value: 0, unit: "rad" as const } },
        },
      }],
      parameters: [], sketches: [], features: [], bodies: [], components: [], instances: [], mates: [], namedSelections: [],
    };
    const v2Revision = await revisionId(v2Content);

    const migrated = await defineDesignDocument({ ...v2Content, revision: v2Revision });
    const v3Content = {
      ...v2Content, schemaVersion: 3 as const,
      migrationProvenance: { sourceSchemaVersion: 2 as const, sourceRevision: v2Revision },
      materials: [], studies: [],
    };
    const v3Revision = await revisionId(v3Content);

    expect(migrated).toMatchObject({
      schemaVersion: 4,
      migrationProvenance: {
        sourceSchemaVersion: 3, sourceRevision: v3Revision,
        sourceMigrationProvenance: { sourceSchemaVersion: 2, sourceRevision: v2Revision },
      },
      materials: [], studies: [],
    });
    expect(migrated.revision).not.toBe(v2Revision);
  });

  it("normalizes physical parameter values into an immutable revisioned snapshot", async () => {
    const metric = await createDesignDocument({
      id: "pump",
      label: "Pump",
      units: { length: "mm", angle: "deg", mass: "kg" },
      createdBy: { kind: "human", id: "sebastian" },
    });
    const withoutRevision = ({ revision: _revision, ...content }: DesignDocument) => content;
    const mmDocument = await defineDesignDocument({
      ...withoutRevision(metric),
      parameters: [{
        id: "shaft-length",
        label: "Shaft length",
        value: { kind: "length", value: { value: 1000, unit: "mm" } },
      }],
    });
    const mDocument = await defineDesignDocument({
      ...withoutRevision(metric),
      parameters: [{
        id: "shaft-length",
        label: "Shaft length",
        value: { kind: "length", value: { value: 1, unit: "m" } },
      }],
    });

    expect(mmDocument.revision).toBe(mDocument.revision);
    expect(mmDocument.parameters[0]?.value).toEqual({
      kind: "length",
      value: { value: 1, unit: "m" },
    });
    expect(Object.isFrozen(mmDocument.parameters)).toBe(true);
  });

  it("rejects duplicate frame IDs", async () => {
    const metric = await createDesignDocument({
      id: "pump",
      label: "Pump",
      units: { length: "mm", angle: "deg", mass: "kg" },
      createdBy: { kind: "human", id: "sebastian" },
    });
    const { revision: _revision, ...content } = metric;

    await expect(defineDesignDocument({
      ...content,
      frames: [metric.frames[0], metric.frames[0]],
    })).rejects.toThrow(/duplicate frame/i);
  });

  it("creates an SI world frame while retaining explicit display units", async () => {
    const document = await createDesignDocument({
      id: "pump",
      label: "Pump",
      units: { length: "mm", angle: "deg", mass: "kg" },
      createdBy: { kind: "human", id: "sebastian" },
    });

    expect(document).toMatchObject({
      schemaVersion: 4,
      units: { length: "mm", angle: "deg", mass: "kg" },
      frames: [{
        id: "world",
        transform: {
          position: { x: { value: 0, unit: "m" } },
          orientation: { roll: { value: 0, unit: "rad" } },
        },
      }],
    });
    expect(Object.isFrozen(document.frames[0])).toBe(true);
  });

  it("migrates v3 topology intent without inventing optimization constraints", async () => {
    const current = await createDesignDocument({
      id: "migration-source", label: "Migration source",
      units: { length: "m", angle: "rad", mass: "kg" },
      createdBy: { kind: "human", id: "tester" },
    });
    const { revision: _revision, migrationProvenance: _provenance, ...base } = current;
    const v3 = {
      ...base, schemaVersion: 3 as const, materials: [],
      studies: [{ id: "legacy-topology", kind: "topology" as const, sourceStudyId: "source-fea" }],
    };
    await expect(defineDesignDocument(v3)).rejects.toThrow(/source study is unresolved/i);

    const migrated = await defineDesignDocument({ ...v3, studies: [] });
    expect(migrated.schemaVersion).toBe(4);
  });

  it("normalizes frame transforms, mass, and angle parameter values", async () => {
    const metric = await createDesignDocument({
      id: "pump",
      label: "Pump",
      units: { length: "mm", angle: "deg", mass: "kg" },
      createdBy: { kind: "human", id: "sebastian" },
    });
    const { revision: _revision, ...content } = metric;
    const frame = metric.frames[0];
    const document = await defineDesignDocument({
      ...content,
      frames: [{
        ...frame,
        transform: {
          position: {
            x: { value: 1000, unit: "mm" },
            y: { value: 0, unit: "mm" },
            z: { value: 0, unit: "mm" },
          },
          orientation: {
            roll: { value: 180, unit: "deg" },
            pitch: { value: 0, unit: "deg" },
            yaw: { value: 0, unit: "deg" },
          },
        },
      }],
      parameters: [
        { id: "rotor-mass", label: "Rotor mass", value: { kind: "mass", value: { value: 1000, unit: "g" } } },
        { id: "tilt", label: "Tilt", value: { kind: "angle", value: { value: 180, unit: "deg" } } },
      ],
    });

    expect(document.frames[0]?.transform.position.x).toEqual({ value: 1, unit: "m" });
    expect(document.frames[0]?.transform.orientation.roll).toEqual({ value: Math.PI, unit: "rad" });
    expect(document.parameters[0]?.value).toEqual({ kind: "mass", value: { value: 1, unit: "kg" } });
    expect(document.parameters[1]?.value).toEqual({ kind: "angle", value: { value: Math.PI, unit: "rad" } });
  });

  it("rejects malformed entity references and invalid frame topology", async () => {
    expect(EntityIdSchema.safeParse("Pump").success).toBe(false);
    expect(SemanticReferenceSchema.parse("body:pump")).toBe("body:pump");
    expect(SemanticReferenceSchema.parse("frame:pump-base")).toBe("frame:pump-base");

    const metric = await createDesignDocument({
      id: "pump",
      label: "Pump",
      units: { length: "mm", angle: "deg", mass: "kg" },
      createdBy: { kind: "human", id: "sebastian" },
    });
    const { revision: _revision, ...content } = metric;
    const world = metric.frames[0];
    const frame = (id: string, parentId?: string) => ({ ...world, id, label: id, ...(parentId ? { parentId } : {}) });

    await expect(defineDesignDocument({
      ...content,
      frames: [world, frame("pump-base", "missing")],
    })).rejects.toThrow(/unresolved/i);
    await expect(defineDesignDocument({
      ...content,
      frames: [world, frame("pump-base", "pump-shaft"), frame("pump-shaft", "pump-base")],
    })).rejects.toThrow(/cyclic/i);
    await expect(defineDesignDocument({
      ...content,
      parameters: [
        { id: "speed", label: "Speed", value: { kind: "dimensionless", value: 1 } },
        { id: "speed", label: "Speed", value: { kind: "dimensionless", value: 2 } },
      ],
    })).rejects.toThrow(/duplicate parameter/i);
  });
});
