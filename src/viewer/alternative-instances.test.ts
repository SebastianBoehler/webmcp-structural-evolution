import { describe, expect, it } from "vitest";

import type { ProbeResult } from "../gpu/compute-probe";
import {
  extractAlternativeLayers,
  type SelectedSemanticRegion,
  type ViewerBranch,
} from "./alternative-instances";
import type { VoxelGrid } from "./field-instances";

const grid: VoxelGrid = {
  dimensions: { width: 3, height: 2, depth: 1 },
  cellSize: [1, 1, 1],
  anchor: { position: [5, 7, 11], orientation: [0, 0, 0, 1] },
};
const region: SelectedSemanticRegion = {
  id: "arm-rib",
  label: "Arm rib",
  min: [1, 0, 0],
  maxExclusive: [3, 2, 1],
};

function verified(values: ArrayLike<number>): ProbeResult {
  return {
    status: "verified",
    output: new Float32Array(values),
    elapsedMs: 1,
    relativeL2: 0,
    tolerance: 0.000005,
  };
}

function branch(
  branchRevision: string,
  values: readonly number[],
  overrides: Partial<ViewerBranch> = {},
): ViewerBranch {
  return {
    branchRevision,
    parentRevision: "accepted-revision",
    grid,
    result: verified(values),
    ...overrides,
  };
}

const current = branch("accepted-revision", [1, 1, 0, 0, 1, 0], {
  parentRevision: "previous-revision",
});

describe("extractAlternativeLayers", () => {
  it("extracts added and removed occupancy only inside the selected region", () => {
    const source = new Float32Array([0, 0, 1, 0, 0, 1]);
    const alternative = branch("branch-a", [], { result: verified(source) });
    const sourceBefore = Array.from(source);

    const extraction = extractAlternativeLayers(current, [alternative], region, 0.5, "overlay");

    expect(extraction.layers).toHaveLength(1);
    expect(extraction.layers[0]?.added.map((record) => record.index)).toEqual([2, 5]);
    expect(extraction.layers[0]?.removed.map((record) => record.index)).toEqual([1, 4]);
    expect(extraction.layers[0]?.displayOffset).toEqual([0, 0, 0]);
    expect(extraction.comparisons[0]).toMatchObject({
      branchRevision: "branch-a",
      parentRevision: "accepted-revision",
      status: "renderable",
      addedCount: 2,
      removedCount: 2,
    });
    expect(Array.from(source)).toEqual(sourceBefore);
  });

  it("caps renderable alternatives at three while reporting every alternative", () => {
    const alternatives = ["a", "b", "c", "d"].map((id) =>
      branch(id, [1, 1, 0, 0, 1, 1]),
    );

    const extraction = extractAlternativeLayers(current, alternatives, region, 0.5, "overlay");

    expect(extraction.layers.map((layer) => layer.branchRevision)).toEqual(["a", "b", "c"]);
    expect(extraction.comparisons.map(({ branchRevision, status }) => [branchRevision, status])).toEqual([
      ["a", "renderable"],
      ["b", "renderable"],
      ["c", "renderable"],
      ["d", "limited"],
    ]);
    expect(extraction.omittedCount).toBe(1);
  });

  it("applies the layer cap after validation so failures cannot hide a compatible branch", () => {
    const failed = branch("failed", [], {
      result: { status: "failed", code: "device-error", message: "lost", elapsedMs: 2 },
    });
    const shifted = branch("shifted", [1, 1, 0, 0, 1, 1], {
      grid: { ...grid, anchor: { ...grid.anchor, position: [6, 7, 11] } },
    });
    const wrongParent = branch("wrong-parent", [1, 1, 0, 0, 1, 1], {
      parentRevision: "other",
    });
    const valid = branch("valid-fourth", [1, 1, 0, 0, 1, 1]);

    const extraction = extractAlternativeLayers(
      current,
      [failed, shifted, wrongParent, valid],
      region,
      0.5,
      "overlay",
    );

    expect(extraction.comparisons).toHaveLength(4);
    expect(extraction.layers.map(({ branchRevision }) => branchRevision)).toEqual(["valid-fourth"]);
    expect(extraction.omittedCount).toBe(0);
  });

  it("rejects empty, colliding, and duplicate alternative branch revisions", () => {
    const alternatives = [
      branch("", [1, 1, 0, 0, 1, 1]),
      branch("accepted-revision", [1, 1, 0, 0, 1, 1]),
      branch("duplicate", [1, 1, 0, 0, 1, 1]),
      branch("duplicate", [1, 1, 0, 0, 1, 1]),
    ];

    const extraction = extractAlternativeLayers(current, alternatives, region, 0.5, "overlay");

    expect(extraction.layers).toEqual([]);
    expect(extraction.comparisons.map(({ status }) => status)).toEqual([
      "invalid",
      "invalid",
      "invalid",
      "invalid",
    ]);
  });

  it("keeps anchor and orientation exact while peel adds only a deterministic bounded offset", () => {
    const alternatives = ["a", "b", "c"].map((id) =>
      branch(id, [1, 1, 0, 0, 1, 1]),
    );

    const first = extractAlternativeLayers(current, alternatives, region, 0.5, "peel");
    const second = extractAlternativeLayers(current, alternatives, region, 0.5, "peel");

    expect(first.layers.map((layer) => layer.displayOffset)).toEqual(
      second.layers.map((layer) => layer.displayOffset),
    );
    for (const layer of first.layers) {
      expect(layer.grid.anchor).toEqual(grid.anchor);
      expect(layer.displayOffset.every((value) => Math.abs(value) <= 3)).toBe(true);
    }
  });

  it("does not render unverified or incompatible alternatives", () => {
    const failed = branch("failed", [], {
      result: { status: "failed", code: "device-error", message: "lost", elapsedMs: 2 },
    });
    const mismatchedGrid = branch("wrong-grid", [1, 1, 0, 0, 1, 1], {
      grid: { ...grid, anchor: { ...grid.anchor, position: [6, 7, 11] } },
    });
    const wrongParent = branch("wrong-parent", [1, 1, 0, 0, 1, 1], {
      parentRevision: "another-parent",
    });

    const extraction = extractAlternativeLayers(
      current,
      [failed, mismatchedGrid, wrongParent],
      region,
      0.5,
      "overlay",
    );

    expect(extraction.layers).toEqual([]);
    expect(extraction.comparisons.map(({ status }) => status)).toEqual([
      "unverified",
      "incompatible",
      "incompatible",
    ]);
  });

  it("represents malformed verified alternative fields as incompatible", () => {
    const malformed = branch("bad-length", [1, 0], {});

    const extraction = extractAlternativeLayers(current, [malformed], region, 0.5, "overlay");

    expect(extraction.layers).toEqual([]);
    expect(extraction.comparisons[0]).toMatchObject({
      branchRevision: "bad-length",
      status: "incompatible",
      addedCount: 0,
      removedCount: 0,
    });
  });

  it("rejects a current branch that has no verified output", () => {
    const mismatch: ViewerBranch = {
      ...current,
      result: {
        status: "mismatch",
        code: "verification-mismatch",
        message: "bad readback",
        elapsedMs: 2,
        relativeL2: 1,
        tolerance: 0.000005,
      },
    };

    expect(() => extractAlternativeLayers(mismatch, [], region, 0.5, "overlay")).toThrow(
      /current.*verified/i,
    );
  });
});
