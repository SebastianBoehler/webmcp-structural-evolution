import { describe, expect, it } from "vitest";

import {
  acceptDesignRevision,
  checkoutDesignRevision,
  childRevisions,
  commitDesignRevision,
  createDesignHistory,
  parentRevision,
} from "./design-history";
import { createDesignDocument } from "./document-schema";
import { applyDesignTransaction } from "./transactions";

async function document() {
  return createDesignDocument({
    id: "pump",
    label: "Pump",
    units: { length: "mm", angle: "deg", mass: "kg" },
    createdBy: { kind: "human", id: "sebastian" },
  });
}

async function renamed(root: Awaited<ReturnType<typeof document>>, transactionId: string, label: string) {
  const result = await applyDesignTransaction(root, {
    id: transactionId,
    expectedRevision: root.revision,
    actor: { kind: "human", id: "sebastian" },
    preconditions: [],
    commands: [{ id: "rename-pump", type: "rename-document", label }],
  });
  if (!result.ok) throw new Error("Expected transaction to succeed");
  return result.document;
}

describe("design history", () => {
  it("preserves sibling branches while checkout and acceptance move independently", async () => {
    const root = await document();
    const branchA = await renamed(root, "tx-a", "Pump A");
    const branchB = await renamed(root, "tx-b", "Pump B");

    const history0 = createDesignHistory(root);
    const historyA = commitDesignRevision(history0, root.revision, "tx-a", branchA);
    const historyAB = commitDesignRevision(historyA, root.revision, "tx-b", branchB);
    const checkedOut = checkoutDesignRevision(historyAB, branchA.revision);
    const accepted = acceptDesignRevision(historyAB, branchB.revision);

    expect(childRevisions(historyAB, root.revision)).toEqual([branchA.revision, branchB.revision].sort());
    expect(historyAB.acceptedRevision).toBe(root.revision);
    expect(checkedOut).toMatchObject({ headRevision: branchA.revision, acceptedRevision: root.revision });
    expect(parentRevision(historyAB, branchA.revision)).toBe(root.revision);
    expect(accepted).toMatchObject({ headRevision: branchB.revision, acceptedRevision: branchB.revision });
    expect(Object.isFrozen(historyAB.documents)).toBe(true);
    expect(Object.isFrozen(historyAB.nodes)).toBe(true);
    expect(historyAB.nodes[root.revision]).toMatchObject({ parentRevision: null, transactionId: null });
    expect(() => acceptDesignRevision(historyAB, "f".repeat(64))).toThrow(/unknown revision/i);
  });

  it("requires a known parent and a new child revision", async () => {
    const root = await document();
    const branch = await renamed(root, "tx-branch", "Pump branch");
    const history = createDesignHistory(root);

    expect(() => commitDesignRevision(history, "f".repeat(64), "tx-branch", branch))
      .toThrow(/unknown parent revision/i);
    expect(() => commitDesignRevision(history, root.revision, "tx-root", root))
      .toThrow(/new document revision/i);
  });
});
