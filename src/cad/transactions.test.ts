import { describe, expect, it } from "vitest";

import { createDesignDocument } from "./document-schema";
import { applyDesignTransaction } from "./transactions";

const human = { kind: "human", id: "sebastian" } as const;
const defineLength = {
  id: "define-shaft-length",
  type: "define-parameter",
  parameter: {
    id: "shaft-length",
    label: "Shaft length",
    value: { kind: "length", value: { value: 1000, unit: "mm" } },
  },
} as const;

async function document() {
  return createDesignDocument({
    id: "pump",
    label: "Pump",
    units: { length: "mm", angle: "deg", mass: "kg" },
    createdBy: human,
  });
}

describe("applyDesignTransaction", () => {
  it("rejects stale revisions before applying commands", async () => {
    const design = await document();

    const stale = await applyDesignTransaction(design, {
      id: "tx-stale",
      expectedRevision: "0".repeat(64),
      actor: human,
      preconditions: [],
      commands: [defineLength],
    });

    expect(stale).toMatchObject({ ok: false, code: "stale-revision" });
    expect(design.parameters).toHaveLength(0);
  });

  it("keeps the original document unchanged when one command fails", async () => {
    const design = await document();

    const failed = await applyDesignTransaction(design, {
      id: "tx-atomic",
      expectedRevision: design.revision,
      actor: human,
      preconditions: [],
      commands: [defineLength, { ...defineLength, id: "define-duplicate" }],
    });

    expect(failed).toMatchObject({ ok: false, code: "command-failed" });
    expect(design.parameters).toHaveLength(0);
  });

  it("returns changed references and a canonical revision for successful commands", async () => {
    const design = await document();
    const success = await applyDesignTransaction(design, {
      id: "tx-success",
      expectedRevision: design.revision,
      actor: human,
      preconditions: [],
      commands: [defineLength],
    });

    expect(success).toMatchObject({ ok: true, changedReferences: ["parameter:shaft-length"] });
    if (success.ok) expect(success.document.revision).not.toBe(design.revision);
  });

  it("normalizes equivalent physical-unit transactions to the same revision", async () => {
    const design = await document();
    const millimeters = await applyDesignTransaction(design, {
      id: "tx-mm",
      expectedRevision: design.revision,
      actor: human,
      preconditions: [],
      commands: [defineLength],
    });
    const meters = await applyDesignTransaction(design, {
      id: "tx-m",
      expectedRevision: design.revision,
      actor: human,
      preconditions: [],
      commands: [{
        ...defineLength,
        parameter: { ...defineLength.parameter, value: { kind: "length", value: { value: 1, unit: "m" } } },
      }],
    });

    expect(millimeters).toMatchObject({ ok: true });
    expect(meters).toMatchObject({ ok: true });
    if (millimeters.ok && meters.ok) expect(millimeters.document.revision).toBe(meters.document.revision);
  });

  it("evaluates physical parameter equality against the original normalized document", async () => {
    const design = await document();
    const defined = await applyDesignTransaction(design, {
      id: "tx-define",
      expectedRevision: design.revision,
      actor: human,
      preconditions: [],
      commands: [defineLength],
    });
    if (!defined.ok) throw new Error("Expected parameter definition to succeed");

    const result = await applyDesignTransaction(defined.document, {
      id: "tx-precondition",
      expectedRevision: defined.document.revision,
      actor: human,
      preconditions: [{
        type: "parameter-equals",
        parameterId: "shaft-length",
        value: { kind: "length", value: { value: 1000, unit: "mm" } },
      }],
      commands: [{
        id: "set-shaft-length",
        type: "set-parameter",
        parameterId: "shaft-length",
        value: { kind: "length", value: { value: 1000, unit: "mm" } },
      }],
    });

    expect(result).toMatchObject({ ok: true, changedReferences: [] });
    if (result.ok) expect(result.document).toBe(defined.document);
  });

  it("applies the remaining command types and reports sorted unique references", async () => {
    const design = await document();
    const defined = await applyDesignTransaction(design, {
      id: "tx-define-before-update",
      expectedRevision: design.revision,
      actor: human,
      preconditions: [],
      commands: [defineLength],
    });
    if (!defined.ok) throw new Error("Expected parameter definition to succeed");

    const updated = await applyDesignTransaction(defined.document, {
      id: "tx-update",
      expectedRevision: defined.document.revision,
      actor: human,
      preconditions: [{ type: "reference-exists", reference: "parameter:shaft-length" }],
      commands: [
        { id: "rename-pump", type: "rename-document", label: "Renamed pump" },
        {
          id: "set-shaft-length",
          type: "set-parameter",
          parameterId: "shaft-length",
          value: { kind: "length", value: { value: 2, unit: "m" } },
        },
        {
          id: "define-pump-base",
          type: "define-frame",
          frame: { ...defined.document.frames[0], id: "pump-base", label: "Pump base", parentId: "world" },
        },
        { id: "remove-shaft-length", type: "remove-parameter", parameterId: "shaft-length" },
      ],
    });

    expect(updated).toMatchObject({
      ok: true,
      changedReferences: ["document:pump", "frame:pump-base", "parameter:shaft-length"],
    });
    if (updated.ok) expect(updated.document).toMatchObject({ label: "Renamed pump", parameters: [] });
  });

  it("rejects invalid transaction shapes without mutating the document", async () => {
    const design = await document();
    const result = await applyDesignTransaction(design, {
      id: "tx-invalid",
      expectedRevision: design.revision,
      actor: human,
      preconditions: [],
      commands: [defineLength, { ...defineLength }],
    });

    expect(result).toMatchObject({ ok: false, code: "invalid-transaction" });
    expect(design.parameters).toHaveLength(0);
  });

  it("rejects transactions with more than 64 commands", async () => {
    const design = await document();
    const result = await applyDesignTransaction(design, {
      id: "tx-too-many-commands",
      expectedRevision: design.revision,
      actor: human,
      preconditions: [],
      commands: Array.from({ length: 65 }, (_, index) => ({
        id: `rename-${index}`,
        type: "rename-document" as const,
        label: "Pump",
      })),
    });

    expect(result).toMatchObject({ ok: false, code: "invalid-transaction" });
  });

  it("propagates exact model changes to dependent consumers", async () => {
    const design = await document();
    const result = await applyDesignTransaction(design, {
      id: "tx-exact-model",
      expectedRevision: design.revision,
      actor: human,
      preconditions: [],
      commands: [
        {
          id: "define-sketch", type: "define-sketch", sketch: {
            id: "base-sketch", plane: "frame:world",
            entities: [{ id: "outline", kind: "rectangle", centerM: [0, 0], sizeM: [0.08, 0.04] }], constraints: [],
          },
        },
        { id: "define-base", type: "define-feature", feature: { id: "base", kind: "extrude", sketchId: "base-sketch", distanceM: 0.01 } },
        { id: "define-body", type: "define-body", body: { id: "link-body", featureId: "base" } },
        { id: "define-component", type: "define-component", component: { id: "link-component", bodyIds: ["link-body"] } },
        { id: "place-instance", type: "place-instance", instance: { id: "link-instance", componentId: "link-component", frameId: "world" } },
        {
          id: "define-selection", type: "define-named-selection",
          namedSelection: {
            id: "mount-face",
            reference: {
              bodyId: "link-body", ownerFeatureId: "base", expectedKind: "face",
              stableId: "face:link-body:base",
              signature: {
                geometry: "plane", centroidM: [0, 0, 0.01], measureSI: 0.0032,
                adjacentKinds: ["plane"],
              },
            },
          },
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      changedReferences: [
        "body:link-body", "component:link-component", "document:pump", "feature:base", "instance:link-instance",
        "named-selection:mount-face", "sketch:base-sketch",
      ],
    });
  });
});
