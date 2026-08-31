import { describe, expect, it } from "vitest";

import * as densityConstraints from "./density-constraints";
import {
  assertTopologyInterfacesConnected, projectTopologyAnalysisDensity,
  projectTopologyDensity, topologyMask,
} from "./density-constraints";
import { extractTopologyMesh, rasterizeExtractedTopology } from "./extract-topology";
import { validateInitialDensity } from "./topology-input";

const grid = {
  cellDimensions: [2, 2, 1] as const,
  nodeDimensions: [3, 3, 2] as const,
  originM: [0, 0, 0] as const,
  cellSizeM: 0.01,
};
const domain = new Uint32Array([1, 1, 0, 0]);

describe("canonical topology design domain", () => {
  it("rejects initial material outside the source active-cell domain", () => {
    expect(() => validateInitialDensity(
      { initialDensity: new Float32Array([1, 1, 1, 0]) } as never,
      domain, new Set(), new Set(),
    )).toThrow(/design domain/i);
  });

  it("keeps projection and binary masks inside the source domain", () => {
    expect(projectTopologyDensity(
      new Float32Array([1, 1, 1, 1]), new Float32Array([1, 1, 0, 0]),
      1, 1, new Set(), new Set(), domain,
    )).toEqual(new Float32Array([1, 1, 0, 0]));
    expect(topologyMask(new Float32Array([1, 1, 1, 1]), 0.5, domain))
      .toEqual(new Uint32Array([1, 1, 0, 0]));
  });

  it("rejects extraction material outside the source domain", () => {
    expect(() => extractTopologyMesh(
      grid, new Float32Array([1, 1, 1, 0]),
      { isoValue: 0.5, toleranceM: 1e-6 }, domain,
    )).toThrow(/design domain/i);
  });

  it("exactly rerasterizes a concave cobot-link voxel domain", () => {
    const cobotGrid = {
      cellDimensions: [20, 6, 3] as const, nodeDimensions: [21, 7, 4] as const,
      originM: [0, 0, 0] as const, cellSizeM: 0.005,
    };
    const active = new Uint32Array(20 * 6 * 3);
    for (let z = 0; z < 3; z += 1) for (let y = 0; y < 6; y += 1) for (let x = 0; x < 20; x += 1) {
      const inWeb = y >= 2 && y <= 3;
      const inShoulder = x <= 3;
      const inElbow = x >= 16 && y >= 1 && y <= 4;
      active[x + 20 * (y + 6 * z)] = Number(inWeb || inShoulder || inElbow);
    }
    const mesh = extractTopologyMesh(
      cobotGrid, Float32Array.from(active), { isoValue: 0.5, toleranceM: 1e-6 }, active,
    );
    expect(rasterizeExtractedTopology(mesh, cobotGrid)).toEqual(active);
  });

  it("removes the lowest-cost active cells to make discrete target progress before iso crossing", () => {
    const projected = projectTopologyAnalysisDensity(
      new Float32Array([0.9, 0.6, 0.8, 0.7]), new Uint8Array([1, 1, 1, 1]),
      0.5, 0.5, 0.5, new Set(), new Set(), new Uint32Array([1, 1, 1, 1]),
    );
    expect(topologyMask(projected, 0.5, new Uint32Array([1, 1, 1, 1])))
      .toEqual(new Uint32Array([1, 0, 1, 0]));
  });

  it("rejects an integer move schedule that cannot reach its rounded target", () => {
    const schedule = (densityConstraints as unknown as {
      assertTopologyScheduleFeasible?: (
        baseline: Uint32Array, iterations: number, target: number, move: number,
        required: ReadonlySet<number>, protectedCells: ReadonlySet<number>, domain: Uint32Array,
      ) => void;
    }).assertTopologyScheduleFeasible;
    expect(() => schedule?.(
      new Uint32Array([1, 1, 1, 1]), 2, 0.5, 0.2,
      new Set(), new Set(), new Uint32Array([1, 1, 1, 1]),
    )).toThrow(/move budget/i);
  });

  it("rejects a removal mask that disconnects required structural interfaces", () => {
    const interfaces = [
      { id: "support", cellIndices: new Uint32Array([0]) },
      { id: "load", cellIndices: new Uint32Array([3]) },
    ];
    expect(() => assertTopologyInterfacesConnected(
      new Uint32Array([1, 0, 0, 1]), [4, 1, 1], interfaces,
    )).toThrow(/disconnect/i);
    expect(() => assertTopologyInterfacesConnected(
      new Uint32Array([1, 1, 1, 1]), [4, 1, 1], interfaces,
    )).not.toThrow();
  });
});
