import { describe, expect, it } from "vitest";

import { projectTopologyDensity, topologyMask } from "./density-constraints";
import { extractTopologyMesh } from "./extract-topology";
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
});
