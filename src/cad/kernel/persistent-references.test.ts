import { describe, expect, it } from "vitest";

import {
  matchTopologyReference,
  type TopologyCandidate,
  type TopologySignature,
} from "./persistent-references";

const topFace: TopologySignature = {
  ownerFeatureId: "base",
  kind: "face",
  geometry: "plane",
  centroidM: [0, 0, 0.01],
  measureSI: 0.0032,
  adjacentKinds: ["plane", "plane", "plane", "plane"],
};

const candidate = (id: string, signature: TopologySignature = topFace): TopologyCandidate => ({
  id,
  signature,
});

describe("persistent topology references", () => {
  it("matches by feature lineage before geometric signature", () => {
    const result = matchTopologyReference(topFace, [
      candidate("wrong-lineage", { ...topFace, ownerFeatureId: "boss" }),
      candidate("stable-face", { ...topFace, centroidM: [4e-10, 0, 0.01] }),
    ]);

    expect(result).toEqual({ ok: true, candidate: expect.objectContaining({ id: "stable-face" }) });
  });

  it("requires repair instead of choosing one ambiguous split face", () => {
    const result = matchTopologyReference(topFace, [
      candidate("split-a"),
      candidate("split-b"),
    ]);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "reference-requires-repair",
        message: "Topology reference matched multiple candidates: split-a, split-b",
        candidateIds: ["split-a", "split-b"],
      },
    });
  });

  it("requires repair when the original lineage has no surviving candidate", () => {
    const result = matchTopologyReference(topFace, [
      candidate("replacement", { ...topFace, ownerFeatureId: "replacement-feature" }),
    ]);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "reference-requires-repair",
        message: "Topology reference matched no candidates",
        candidateIds: [],
      },
    });
  });
});
