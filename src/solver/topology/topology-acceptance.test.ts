import { describe, expect, it } from "vitest";

import { STRUCTURAL_VERIFICATION_METADATA, type StructuralResult } from "../structural/structural-contract";
import {
  extractTopologyMesh,
  rasterizeExtractedTopology,
  validateExtractedTopology,
} from "./extract-topology";
import { decideTopologyAcceptance } from "./topology-acceptance";

const grid = {
  cellDimensions: [5, 5, 5] as const,
  nodeDimensions: [6, 6, 6] as const,
  originM: [0, 0, 0] as const,
  cellSizeM: 0.01,
};
const index = (x: number, y: number, z: number) => x + 5 * (y + 5 * z);

function cubeDensity(): Float32Array {
  const density = new Float32Array(125);
  for (let z = 1; z < 4; z += 1) for (let y = 1; y < 4; y += 1) {
    for (let x = 1; x < 4; x += 1) density[index(x, y, z)] = 0.8;
  }
  return density;
}

describe("topology extraction and acceptance", () => {
  it("extracts a closed oriented mesh and independently rerasterizes the same occupied cells", () => {
    const density = cubeDensity();
    const mesh = extractTopologyMesh(grid, density, { isoValue: 0.5, toleranceM: 1e-6 });
    const validation = validateExtractedTopology(mesh, grid, {
      requiredInterfaces: [
        { id: "fixed", cellIndices: new Uint32Array([index(1, 2, 2)]) },
        { id: "loaded", cellIndices: new Uint32Array([index(3, 2, 2)]) },
      ],
      protectedVoidCellIndices: new Uint32Array([index(0, 0, 0)]),
      minimumFeatureM: 0.02,
    });

    expect(validation).toEqual({
      closed: true, oriented: true, requiredInterfacesConnected: true,
      protectedVoidsClear: true, minimumFeatureSatisfied: true,
    });
    expect(rasterizeExtractedTopology(mesh, grid)).toEqual(
      Uint32Array.from(density, (value) => Number(value >= 0.5)),
    );
  });

  it("rejects open, inward, disconnected, protected-void, and undersized candidates", () => {
    const density = cubeDensity();
    const mesh = extractTopologyMesh(grid, density, { isoValue: 0.5, toleranceM: 1e-6 });
    const common = {
      requiredInterfaces: [
        { id: "fixed", cellIndices: new Uint32Array([index(1, 2, 2)]) },
        { id: "loaded", cellIndices: new Uint32Array([index(3, 2, 2)]) },
      ],
      protectedVoidCellIndices: new Uint32Array(), minimumFeatureM: 0.02,
    };
    const open = { ...mesh, triangles: mesh.triangles.slice(0, -3) };
    const inward = { ...mesh, triangles: new Uint32Array(mesh.triangles) };
    [inward.triangles[0], inward.triangles[1]] = [inward.triangles[1]!, inward.triangles[0]!];
    expect(validateExtractedTopology(open, grid, common).closed).toBe(false);
    expect(validateExtractedTopology(inward, grid, common).oriented).toBe(false);
    expect(validateExtractedTopology(mesh, grid, {
      ...common, requiredInterfaces: [...common.requiredInterfaces, {
        id: "island", cellIndices: new Uint32Array([index(0, 0, 0)]),
      }],
    }).requiredInterfacesConnected).toBe(false);
    expect(validateExtractedTopology(mesh, grid, {
      ...common, protectedVoidCellIndices: new Uint32Array([index(2, 2, 2)]),
    }).protectedVoidsClear).toBe(false);
    expect(validateExtractedTopology(mesh, grid, { ...common, minimumFeatureM: 0.04 })
      .minimumFeatureSatisfied).toBe(false);
  });

  it("fails closed on malformed geometry and proves outward orientation by signed volume", () => {
    const mesh = extractTopologyMesh(grid, cubeDensity(), { isoValue: 0.5, toleranceM: 1e-6 });
    const common = {
      requiredInterfaces: [{ id: "fixed", cellIndices: new Uint32Array([index(1, 2, 2)]) }],
      protectedVoidCellIndices: new Uint32Array(), minimumFeatureM: 0.01,
    };
    const reversed = new Uint32Array(mesh.triangles);
    for (let cursor = 0; cursor < reversed.length; cursor += 3) {
      [reversed[cursor], reversed[cursor + 1]] = [reversed[cursor + 1]!, reversed[cursor]!];
    }
    expect(validateExtractedTopology({ ...mesh, triangles: reversed }, grid, common).oriented).toBe(false);

    const nonFinite = new Float32Array(mesh.positionsM);
    nonFinite[0] = Number.NaN;
    const outOfRange = new Uint32Array(mesh.triangles);
    outOfRange[0] = mesh.positionsM.length / 3;
    const degenerate = new Uint32Array(mesh.triangles);
    degenerate[2] = degenerate[1]!;
    for (const malformed of [
      { ...mesh, positionsM: nonFinite },
      { ...mesh, triangles: outOfRange },
      { ...mesh, triangles: degenerate },
    ]) {
      expect(validateExtractedTopology(malformed, grid, common)).toMatchObject({ closed: false, oriented: false });
      expect(() => rasterizeExtractedTopology(malformed, grid)).toThrow(/finite, nondegenerate, closed/i);
    }
  });

  it("accepts only monotonic, manufacturing-valid, post-extraction structural evidence", () => {
    const analysis = {
      truthLevel: "interactive-estimate", complianceJ: 8, maximumDisplacementM: 0.01,
      strainEnergyJ: 4, maximumVonMisesStressPa: 10, iterations: 4,
      grid: {
        cellDimensions: [1, 1, 1], nodeDimensions: [2, 2, 2],
        originM: [0, 0, 0], cellSizeM: 1,
      },
      verification: {
        realGpu: true, relativeResidual: 1e-6, forceBalanceErrorN: 0,
        appliedLoadN: 1, wasmRelativeL2: 1e-4, metadata: STRUCTURAL_VERIFICATION_METADATA,
      },
      rasterization: { toleranceM: 1e-6, selections: [] },
      displacementM: new Float32Array(24), vonMisesStressPa: new Float32Array([10]),
    } as StructuralResult;
    const base = {
      objectiveHistory: [10, 9, 8], materialFraction: 0.7, analysis,
      extraction: {
        closed: true, oriented: true, requiredInterfacesConnected: true,
        protectedVoidsClear: true, minimumFeatureSatisfied: true,
      },
      constraints: {
        maximumDisplacementM: 0.02, maximumVonMisesStressPa: 20,
        minimumSafetyFactor: 2, maximumMaterialFraction: 0.75,
      },
      failureStressPa: 40,
    };
    expect(decideTopologyAcceptance(base)).toMatchObject({
      eligible: true, accepted: false, exportable: false,
      promotionRequired: "task-5-live-gate", reasons: [],
    });
    expect(decideTopologyAcceptance({ ...base, objectiveHistory: [10, 11] }).eligible).toBe(false);
    expect(decideTopologyAcceptance({
      ...base, analysis: { ...analysis, maximumDisplacementM: 0.03 },
    }).reasons).toContain("post-extraction displacement exceeds the acceptance limit");
    expect(decideTopologyAcceptance({
      ...base, extraction: { ...base.extraction, closed: false },
    }).reasons).toContain("manufacturing mesh is not closed");
    expect(decideTopologyAcceptance({
      ...base, analysis: {
        ...analysis, displacementM: Float32Array.from([Number.NaN]),
      },
    }).reasons).toContain("post-extraction structural evidence is incoherent");
    expect(decideTopologyAcceptance({
      ...base, analysis: {
        ...analysis,
        verification: {
          ...analysis.verification,
          metadata: { ...analysis.verification.metadata, referenceSolver: "forged" as never },
        },
      },
    }).reasons).toContain("post-extraction structural evidence is incoherent");
  });
});
