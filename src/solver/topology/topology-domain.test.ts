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

function minimumFeatureOffenders(
  mask: Uint32Array, dimensions: readonly [number, number, number], minimumCells: number,
): number[] {
  const [width, height, depth] = dimensions, plane = width * height;
  const index = (x: number, y: number, z: number) => x + width * (y + height * z);
  const run = (x: number, y: number, z: number, axis: number) => {
    let length = 1;
    for (const direction of [-1, 1]) for (let step = 1; ; step += 1) {
      const point = [x, y, z]; point[axis] += direction * step;
      if (point[axis]! < 0 || point[axis]! >= [width, height, depth][axis]!
        || mask[index(point[0]!, point[1]!, point[2]!)] !== 1) break;
      length += 1;
    }
    return length;
  };
  return [...mask.keys()].filter((cell) => {
    if (mask[cell] !== 1) return false;
    const z = Math.floor(cell / plane), rest = cell - z * plane;
    const y = Math.floor(rest / width), x = rest - y * width;
    return [0, 1, 2].some((axis) => run(x, y, z, axis) < minimumCells);
  });
}

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
    const interfaces = [{ id: "fixed", cellIndices: new Uint32Array([0]) }];
    const projected = projectTopologyAnalysisDensity(
      new Float32Array([0.9, 0.6, 0.8, 0.7]), new Uint8Array([1, 1, 1, 1]),
      0.5, 0.5, 0.5, new Set([0]), new Set(), new Uint32Array([1, 1, 1, 1]),
      { dimensions: [4, 1, 1], minimumFeatureM: .01,
        cellSizeM: .01, requiredInterfaces: interfaces },
    );
    expect(topologyMask(projected, 0.5, new Uint32Array([1, 1, 1, 1])))
      .toEqual(new Uint32Array([1, 0, 1, 0]));
  });

  it("does not swap or reactivate cells once projection reaches its rounded target", () => {
    const interfaces = [{ id: "fixed", cellIndices: new Uint32Array([0]) }];
    const projected = projectTopologyAnalysisDensity(
      new Float32Array([0.1, 0.9, 0.1, 0.9]), new Uint8Array([1, 0, 1, 0]),
      0.5, 0.5, 0.5, new Set([0]), new Set(), new Uint32Array([1, 1, 1, 1]),
      { dimensions: [4, 1, 1], minimumFeatureM: .01,
        cellSizeM: .01, requiredInterfaces: interfaces },
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

  it("peels an initial nonrequired thin spur before ranked removals", () => {
    const dimensions = [5, 4, 3] as const, count = 60;
    const index = (x: number, y: number, z: number) => x + 5 * (y + 4 * z);
    const previous = new Uint8Array(count);
    for (let z = 0; z < 3; z += 1) for (let y = 0; y < 3; y += 1) {
      for (let x = 1; x < 4; x += 1) previous[index(x, y, z)] = 1;
    }
    const spur = index(4, 1, 1); previous[spur] = 1;
    const candidate = new Float32Array(count).fill(.8);
    candidate[index(2, 1, 1)] = 0; candidate[spur] = 1;
    const interfaces = [
      { id: "left", cellIndices: new Uint32Array([index(1, 1, 1)]) },
      { id: "right", cellIndices: new Uint32Array([index(3, 1, 1)]) },
    ];
    const required = new Set(interfaces.flatMap(({ cellIndices }) => [...cellIndices]));
    const designDomain = new Uint32Array(count).fill(1);
    const output = projectTopologyAnalysisDensity(
      candidate, previous, .5, 27 / count, .1, required, new Set(), designDomain,
      { dimensions, minimumFeatureM: .02, cellSizeM: .01, requiredInterfaces: interfaces },
    );
    const mask = topologyMask(output, .5, designDomain);
    expect(mask.reduce((sum, value) => sum + value, 0)).toBe(27);
    expect(mask[spur]).toBe(0);
    expect(minimumFeatureOffenders(mask, dimensions, 2)).toEqual([]);
  });

  it("uses a cascading deletion closure instead of unrelated ranked cells", () => {
    const dimensions = [3, 3, 2] as const, count = 18;
    const index = (x: number, y: number, z: number) => x + 3 * (y + 3 * z);
    const previous = new Uint8Array(count).fill(1), candidate = new Float32Array(count).fill(.8);
    const seed = index(0, 0, 0), partner = index(0, 0, 1);
    candidate[seed] = 0; candidate[index(2, 0, 0)] = .1;
    const interfaces = [
      { id: "left", cellIndices: new Uint32Array([index(0, 1, 0), index(0, 1, 1)]) },
      { id: "right", cellIndices: new Uint32Array([index(2, 1, 0), index(2, 1, 1)]) },
    ];
    const required = new Set(interfaces.flatMap(({ cellIndices }) => [...cellIndices]));
    const designDomain = new Uint32Array(count).fill(1);
    const output = projectTopologyAnalysisDensity(
      candidate, previous, .5, 16 / count, .12, required, new Set(), designDomain,
      { dimensions, minimumFeatureM: .02, cellSizeM: .01, requiredInterfaces: interfaces },
    );
    const mask = topologyMask(output, .5, designDomain);
    expect([...mask.keys()].filter((cell) => mask[cell] === 0)).toEqual([seed, partner]);
    expect(minimumFeatureOffenders(mask, dimensions, 2)).toEqual([]);
  });

  it("fails closed when every exact feature-safe closure disconnects required interfaces", () => {
    const dimensions = [5, 2, 2] as const, count = 20;
    const index = (x: number, y: number, z: number) => x + 5 * (y + 2 * z);
    const previous = new Uint8Array(count).fill(1), candidate = new Float32Array(count).fill(.5);
    const interfaceAt = (x: number) => Uint32Array.from(
      [0, 1].flatMap((z) => [0, 1].map((y) => index(x, y, z))),
    );
    const interfaces = [
      { id: "left", cellIndices: interfaceAt(0) },
      { id: "right", cellIndices: interfaceAt(4) },
    ];
    const required = new Set(interfaces.flatMap(({ cellIndices }) => [...cellIndices]));
    expect(() => projectTopologyAnalysisDensity(
      candidate, previous, .5, 16 / count, .2, required, new Set(), new Uint32Array(count).fill(1),
      { dimensions, minimumFeatureM: .02, cellSizeM: .01, requiredInterfaces: interfaces },
    )).toThrow(/manufacturing projection/i);
  });

  it("uses a same-step safe-add exchange without reactivating historical holes", () => {
    const dimensions = [4, 3, 3] as const, count = 36;
    const index = (x: number, y: number, z: number) => x + 4 * (y + 3 * z);
    const previous = new Uint8Array(count).fill(1), candidate = new Float32Array(count).fill(.8);
    const historicalHole = index(0, 2, 2), firstRemoval = index(3, 2, 2);
    const closureSeed = index(1, 0, 0), closurePartner = index(0, 0, 0);
    previous[historicalHole] = 0;
    candidate[firstRemoval] = 0; candidate[closureSeed] = .1;
    const interfaces = [
      { id: "left", cellIndices: new Uint32Array([index(0, 1, 1)]) },
      { id: "right", cellIndices: new Uint32Array([index(3, 1, 1)]) },
    ];
    const required = new Set(interfaces.flatMap(({ cellIndices }) => [...cellIndices]));
    const designDomain = new Uint32Array(count).fill(1);
    const output = projectTopologyAnalysisDensity(
      candidate, previous, .5, 33 / count, .06, required, new Set(), designDomain,
      { dimensions, minimumFeatureM: .02, cellSizeM: .01, requiredInterfaces: interfaces },
    );
    const mask = topologyMask(output, .5, designDomain);
    expect(mask[historicalHole]).toBe(0);
    expect(mask[firstRemoval]).toBe(1);
    expect([...mask.keys()].filter((cell) => previous[cell] === 1 && mask[cell] === 0))
      .toEqual([closurePartner, closureSeed]);
    expect(minimumFeatureOffenders(mask, dimensions, 2)).toEqual([]);
  });
});
