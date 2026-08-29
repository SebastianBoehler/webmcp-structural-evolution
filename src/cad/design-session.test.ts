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

  it("moves the head to an existing revision when a transaction converges", async () => {
    const root = await document();
    const retained = await dependentBrep(root.revision);
    const session = createDesignSession(root, [retained]);
    const renamed = await applyDesignSessionTransaction(session, {
      id: "tx-rename-away",
      expectedRevision: root.revision,
      actor: human,
      preconditions: [],
      commands: [{ id: "rename-away", type: "rename-document", label: "Pump draft" }],
    }, clock);
    if (!renamed.result.ok) throw new Error("Expected rename to succeed");

    const converged = await applyDesignSessionTransaction(renamed.session, {
      id: "tx-rename-back",
      expectedRevision: renamed.result.document.revision,
      actor: human,
      preconditions: [],
      commands: [{ id: "rename-back", type: "rename-document", label: "Pump" }],
    }, clock);

    expect(converged.result).toMatchObject({ ok: true, changedReferences: ["document:pump"] });
    expect(converged.session.history.headRevision).toBe(root.revision);
    expect(Object.keys(converged.session.history.nodes)).toHaveLength(2);
    expect(converged.session.artifacts).toMatchObject({
      index: { documentRevision: root.revision, artifacts: [retained] },
      invalidatedIds: [],
    });
    expect(converged.session.receipts).toHaveLength(2);
    expect(converged.session.receipts.at(-1)).toMatchObject({
      affectedRevision: root.revision,
      outcome: { status: "succeeded", result: { revision: root.revision, changed: true } },
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

  it("records malformed transactions as typed failures without changing session state", async () => {
    const root = await document();
    const session = createDesignSession(root);

    const applied = await applyDesignSessionTransaction(session, {
      id: "tx-invalid",
      expectedRevision: root.revision,
      actor: human,
      preconditions: [],
      commands: [
        { id: "rename-pump", type: "rename-document", label: "Pump" },
        { id: "rename-pump", type: "rename-document", label: "Pump again" },
      ],
    } as never, clock);

    expect(applied.result).toMatchObject({ ok: false, code: "invalid-transaction" });
    expect(applied.session.history).toBe(session.history);
    expect(applied.session.artifacts).toBe(session.artifacts);
    expect(applied.session.receipts.at(-1)).toMatchObject({
      validatedInputs: null,
      outcome: { status: "failed" },
    });
  });
});
