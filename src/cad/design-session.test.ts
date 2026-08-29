import { describe, expect, it } from "vitest";

import { defineArtifactRecord } from "./artifact-contract";
import {
  applyDesignSessionTransaction,
  createDesignSession,
  inspectDesignSession,
} from "./design-session";
import { createDesignDocument } from "./document-schema";

const clock = {
  now: () => "2026-08-29T12:00:00.000Z",
  elapsedMs: () => 3,
};
const human = { kind: "human", id: "sebastian" } as const;

async function document() {
  return createDesignDocument({
    id: "pump",
    label: "Pump",
    units: { length: "mm", angle: "deg", mass: "kg" },
    createdBy: human,
  });
}

async function dependentBrep(sourceRevision: string) {
  return defineArtifactRecord({
    kind: "brep",
    sourceRevision,
    producer: { name: "cad-kernel", version: "1.0.0" },
    settingsDigest: "a".repeat(64),
    contentDigest: "b".repeat(64),
    units: "m",
    mediaType: "model/step",
    dependencies: [{ kind: "entity", reference: "parameter:shaft-length" }],
  });
}

describe("design session", () => {
  it("commits changed transactions, invalidates derived artifacts, and records a receipt", async () => {
    const root = await document();
    const brep = await dependentBrep(root.revision);
    const session = createDesignSession(root, [brep]);

    const applied = await applyDesignSessionTransaction(session, {
      id: "tx-define-length",
      expectedRevision: root.revision,
      actor: human,
      preconditions: [],
      commands: [{
        id: "define-shaft-length",
        type: "define-parameter",
        parameter: {
          id: "shaft-length",
          label: "Shaft length",
          value: { kind: "length", value: { value: 1000, unit: "mm" } },
        },
      }],
    }, clock);

    expect(applied.result.ok).toBe(true);
    expect(applied.session.history.headRevision).toBe(applied.result.ok ? applied.result.document.revision : "");
    expect(applied.session.artifacts.invalidatedIds).toContain(brep.id);
    expect(applied.session.receipts.at(-1)).toMatchObject({
      action: "apply_design_transaction",
      outcome: { status: "succeeded" },
      duration: { value: 3, unit: "ms" },
    });
    expect(inspectDesignSession(applied.session)).toMatchObject({
      documentId: "pump",
      parameterCount: 1,
      branchCount: 1,
      invalidatedArtifactCount: 1,
      units: { length: "mm", angle: "deg", mass: "kg" },
    });
  });

  it("records successful no-ops without extending history or invalidating artifacts", async () => {
    const root = await document();
    const session = createDesignSession(root);

    const applied = await applyDesignSessionTransaction(session, {
      id: "tx-noop",
      expectedRevision: root.revision,
      actor: human,
      preconditions: [],
      commands: [{ id: "rename-pump", type: "rename-document", label: "Pump" }],
    }, clock);

    expect(applied.result).toMatchObject({ ok: true, changedReferences: [] });
    expect(applied.session.history).toBe(session.history);
    expect(applied.session.artifacts).toBe(session.artifacts);
    expect(applied.session.receipts).toHaveLength(1);
    expect(applied.session.receipts[0]).toMatchObject({
      affectedRevision: root.revision,
      outcome: { status: "succeeded", result: { revision: root.revision, changed: false } },
    });
  });

  it("preserves history and artifacts after failed transactions while recording failure", async () => {
    const root = await document();
    const session = createDesignSession(root);

    const applied = await applyDesignSessionTransaction(session, {
      id: "tx-stale",
      expectedRevision: "f".repeat(64),
      actor: human,
      preconditions: [],
      commands: [],
    }, clock);

    expect(applied.result).toMatchObject({ ok: false, code: "stale-revision" });
    expect(applied.session.history).toBe(session.history);
    expect(applied.session.artifacts).toBe(session.artifacts);
    expect(applied.session.receipts.at(-1)).toMatchObject({
      affectedRevision: null,
      outcome: { status: "failed", error: "Expected revision does not match the document revision" },
    });
  });
});
