import { describe, expect, it } from "vitest";

import { resolveNamedSelections } from "./named-selection-resolution";

describe("named selection resolution", () => {
  it("reports every affected consumer when a split topology match is ambiguous", () => {
    const signature = {
      ownerFeatureId: "base", kind: "face" as const, geometry: "plane" as const,
      centroidM: [0, 0, 0.01] as [number, number, number], measureSI: 0.0032,
      adjacentKinds: ["plane"],
    };
    const document = {
      namedSelections: [{
        id: "mount-face",
        reference: {
          bodyId: "part-body", ownerFeatureId: "base", expectedKind: "face" as const,
          stableId: "removed-face",
          signature: {
            geometry: signature.geometry, centroidM: signature.centroidM,
            measureSI: signature.measureSI, adjacentKinds: signature.adjacentKinds,
          },
        },
      }],
      mates: [{
        id: "mount-mate", kind: "rigid" as const,
        firstInstanceId: "first", secondInstanceId: "second",
        firstSelectionId: "mount-face", secondSelectionId: "other-face",
      }],
    };

    expect(() => resolveNamedSelections(document, [
      { id: "split-a", bodyId: "part-body", signature },
      { id: "split-b", bodyId: "part-body", signature },
    ])).toThrowError(expect.objectContaining({
      code: "reference-requires-repair",
      affectedConsumers: ["mate:mount-mate", "named-selection:mount-face"],
    }));
  });
});
