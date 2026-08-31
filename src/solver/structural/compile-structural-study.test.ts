import { describe, expect, it } from "vitest";

import { defineArtifactRecord } from "../../cad/artifact-contract";
import { compileStructuralStudy } from "./compile-structural-study";
import { structuralRequest } from "./structural-test-fixtures";

describe("compileStructuralStudy", () => {
  it("binds exact face ownership to a uniform SI voxel system", async () => {
    const compiled = await compileStructuralStudy(await structuralRequest());

    expect(compiled.grid).toEqual({
      cellDimensions: [4, 2, 2], nodeDimensions: [5, 3, 3],
      originM: [0, 0, 0], cellSizeM: 0.01,
    });
    expect(compiled.activeCellCount).toBe(16);
    expect(compiled.fixedDofs.filter(Boolean)).toHaveLength(27);
    expect(Array.from(compiled.loadsN).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1000, 3);
    expect(compiled.rasterization.toleranceM).toBe(1e-6);
    expect(compiled.rasterization.selections).toEqual([
      expect.objectContaining({
        selectionId: "fixed-end", topologyId: "face:bar:fixed", cellCount: 4, nodeCount: 9,
        cellHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      expect.objectContaining({
        selectionId: "loaded-end", topologyId: "face:bar:loaded", cellCount: 4, nodeCount: 9,
        cellHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
  });

  it("rejects nonuniform cells and named selections that rasterize to zero cells", async () => {
    await expect(compileStructuralStudy(await structuralRequest({
      cellSizeM: new Float64Array([0.01, 0.011, 0.01]),
    }))).rejects.toThrow(/uniform cubic cells/i);

    await expect(compileStructuralStudy(await structuralRequest({
      selectionCellOffsets: new Uint32Array([0, 0, 4]),
      selectionCellIndices: new Uint32Array([3, 7, 11, 15]),
      selectionNodeOffsets: new Uint32Array([0, 0, 9]),
      selectionNodeIndices: new Uint32Array([4, 9, 14, 19, 24, 29, 34, 39, 44]),
    }))).rejects.toThrow(/fixed-end.*zero cells/i);
  });

  it("rejects selection nodes that are not owned by their rasterized cells", async () => {
    await expect(compileStructuralStudy(await structuralRequest({
      selectionNodeIndices: new Uint32Array([
        2, 5, 10, 15, 20, 25, 30, 35, 40,
        4, 9, 14, 19, 24, 29, 34, 39, 44,
      ]),
    }))).rejects.toThrow(/node outside its rasterized cells/i);
  });

  it("rejects a loaded component with no connected support", async () => {
    const occupancy = new Uint32Array(16);
    occupancy.set([1, 1, 0, 1], 0);
    occupancy.set([1, 1, 0, 1], 4);
    occupancy.set([1, 1, 0, 1], 8);
    occupancy.set([1, 1, 0, 1], 12);

    await expect(compileStructuralStudy(await structuralRequest({ activeCells: occupancy })))
      .rejects.toThrow(/loaded island.*connected support/i);
  });

  it("rejects tampered payload bytes and bounded-grid overrun before GPU dispatch", async () => {
    const request = await structuralRequest();
    request.input.voxelPayload.activeCells[0] = 0;
    await expect(compileStructuralStudy(request)).rejects.toThrow(/content digest/i);

    await expect(compileStructuralStudy(await structuralRequest(), { maxCells: 15, maxDofs: 10_000 }))
      .rejects.toThrow(/grid cell limit/i);
  });

  it("rejects stale, swapped, wrongly typed, and foreign solver-mesh artifacts", async () => {
    const request = await structuralRequest();
    await expect(compileStructuralStudy({
      ...request,
      input: {
        ...request.input,
        semanticMeshArtifactId: request.input.voxelArtifactId,
        voxelArtifactId: request.input.semanticMeshArtifactId,
      },
    })).rejects.toThrow(/semantic-mesh artifact/i);

    const voxel = request.inputArtifacts.find(({ id }) => id === request.input.voxelArtifactId)!;
    const wrongMedia = await redefine(voxel, { mediaType: "application/octet-stream" });
    await expect(compileStructuralStudy(withVoxel(request, wrongMedia)))
      .rejects.toThrow(/voxel-domain-v1/i);

    const wrongKind = await redefine(voxel, { kind: "sdf" });
    await expect(compileStructuralStudy(withVoxel(request, wrongKind)))
      .rejects.toThrow(/solver-mesh artifact/i);

    const stale = await redefine(voxel, { sourceRevision: "f".repeat(64) });
    await expect(compileStructuralStudy(withVoxel(request, stale))).rejects.toThrow(/stale source revision/i);

    const foreign = await redefine(voxel, {
      dependencies: [
        { kind: "entity", reference: "body:bar" },
        { kind: "entity", reference: "body:foreign" },
        { kind: "artifact", artifactId: request.input.semanticMeshArtifactId },
      ],
    });
    await expect(compileStructuralStudy(withVoxel(request, foreign))).rejects.toThrow(/foreign body/i);
  });

  it("rejects a selected exact face with no semantic triangle ownership", async () => {
    const request = await structuralRequest();
    const semantic = {
      ...request.input.semanticMeshPayload,
      triangleFaceIndices: new Uint32Array([0, 0]),
    };
    const semanticRecord = request.inputArtifacts.find(({ id }) => id === request.input.semanticMeshArtifactId)!;
    const { digestCadOutputPayload } = await import("../../cad/rebuild-payload");
    const replacement = await redefine(semanticRecord, {
      contentDigest: await digestCadOutputPayload(semantic),
    });
    const voxel = request.inputArtifacts.find(({ id }) => id === request.input.voxelArtifactId)!;
    const reboundVoxel = await redefine(voxel, {
      dependencies: [
        { kind: "entity", reference: "body:bar" },
        { kind: "artifact", artifactId: replacement.id },
      ],
    });

    await expect(compileStructuralStudy({
      ...request,
      inputArtifacts: [replacement, reboundVoxel],
      input: {
        ...request.input, semanticMeshArtifactId: replacement.id,
        semanticMeshPayload: semantic, voxelArtifactId: reboundVoxel.id,
      },
    })).rejects.toThrow(/no exact semantic triangle ownership/i);
  });
});

async function redefine(
  record: Awaited<ReturnType<typeof structuralRequest>>["inputArtifacts"][number],
  changes: Record<string, unknown>,
) {
  const { id: _id, ...content } = record;
  return defineArtifactRecord({ ...content, ...changes });
}

function withVoxel(
  request: Awaited<ReturnType<typeof structuralRequest>>,
  voxel: Awaited<ReturnType<typeof redefine>>,
) {
  return {
    ...request,
    inputArtifacts: request.inputArtifacts.map((record) =>
      record.id === request.input.voxelArtifactId ? voxel : record),
    input: { ...request.input, voxelArtifactId: voxel.id },
  };
}
