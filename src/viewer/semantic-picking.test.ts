import { describe, expect, it } from "vitest";
import { componentIdForSourceSelection, repairSemanticSelection,
  semanticPathFor, sourceSelectionForSemantic } from "./semantic-picking";
import type { SemanticDocumentArtifact } from "./semantic-scene";

const before: SemanticDocumentArtifact = {
  revision: "r1",
  frame: { lengthUnit: "mm", angleUnit: "radian" },
  nodes: [
    { id: "assembly:a", kind: "assembly" },
    { id: "component:arm", parentId: "assembly:a", kind: "component", sourceSelectionId: "legacy-arm" },
    { id: "body:arm", parentId: "component:arm", kind: "body" },
    { id: "feature:fillet", parentId: "body:arm", kind: "feature" },
    { id: "face:top", parentId: "feature:fillet", kind: "face" },
    { id: "edge:rim", parentId: "feature:fillet", kind: "edge" },
  ],
};

describe("semantic picking", () => {
  it("returns the stable assembly-to-face semantic path", () => {
    expect(semanticPathFor(before, "face:top")).toEqual([
      "assembly:a", "component:arm", "body:arm", "feature:fillet", "face:top",
    ]);
  });

  it("returns an assembly-to-edge path without conflating edge and face identities", () => {
    expect(semanticPathFor(before, "edge:rim").at(-1)).toBe("edge:rim");
  });

  it("maps opaque leaf IDs to legacy selection only through explicit component metadata", () => {
    expect(sourceSelectionForSemantic(before, "face:top")).toBe("legacy-arm");
    expect(sourceSelectionForSemantic(before, "edge:rim")).toBe("legacy-arm");
    expect(componentIdForSourceSelection(before, "legacy-arm")).toBe("component:arm");
    expect(componentIdForSourceSelection(before, "face:top")).toBeUndefined();
  });

  it("preserves compatible semantic selections and explicitly repairs a replaced face", () => {
    const compatible = { ...before, revision: "r2" };
    const replaced: SemanticDocumentArtifact = {
      ...compatible,
      revision: "r3",
      nodes: compatible.nodes.map((node) => node.id === "face:top"
        ? { ...node, id: "face:top-rebuilt" } : node),
    };

    expect(repairSemanticSelection("face:top", compatible)).toEqual({ selection: "face:top", repaired: false });
    expect(repairSemanticSelection("face:top", replaced, { "face:top": "face:top-rebuilt" }))
      .toEqual({ selection: "face:top-rebuilt", repaired: true });
    expect(repairSemanticSelection("face:top", replaced))
      .toEqual({ selection: undefined, repaired: false, invalidated: true });
  });
});
