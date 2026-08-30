import type { OcctKernel, ShapeHandle } from "occt-wasm";
import { describe, expect, it } from "vitest";

import { CAD_RESOURCE_LIMITS } from "../cad-resource-limits";
import { tessellateSemanticBodies } from "./semantic-tessellation";

const handle = (id: string) => ({ id }) as unknown as ShapeHandle;

function semanticKernel(baseFaceCount: number, meshIndexCount = 3, vertexCount = 1) {
  const baseShape = handle("base-shape");
  const bodyShape = handle("body-shape");
  const baseFaces = Array.from({ length: baseFaceCount }, (_, index) => handle(`base-face-${index}`));
  const bodyFace = handle("body-face");
  const bodyFaceHash = 21;
  const hashes = new Map<ShapeHandle, number>([
    ...baseFaces.map((face, index) => [face, 11 + index] as const),
    [bodyFace, bodyFaceHash],
  ]);
  const faces = new Map<ShapeHandle, ShapeHandle[]>([
    [baseShape, baseFaces], [bodyShape, [bodyFace]],
  ]);
  const kernel = {
    getSubShapes: (shape: ShapeHandle, kind: string) => kind === "face" ? faces.get(shape) ?? [] : [],
    surfaceType: () => "plane",
    getSurfaceCenterOfMass: () => ({ x: 0, y: 0, z: 0 }),
    getSurfaceArea: () => 1,
    adjacentFaces: () => [],
    hashCode: (shape: ShapeHandle) => hashes.get(shape) ?? 0,
    edgeToFaceMap: () => [],
    meshShape: () => ({
      positions: new Float32Array([0, 0, 0]),
      normals: new Float32Array([0, 0, 1]),
      indices: new Uint32Array(meshIndexCount),
      vertexCount,
      triangleCount: meshIndexCount / 3,
      faceGroups: new Uint32Array([0, meshIndexCount, bodyFaceHash]),
    }),
    wireframe: () => ({ points: new Float32Array(), edgeGroups: new Uint32Array() }),
  } as unknown as OcctKernel;
  return { kernel, baseShape, bodyShape };
}

describe("semantic tessellation", () => {
  it("requires repair instead of assigning terminal ownership after an ambiguous lineage match", () => {
    const { kernel, baseShape, bodyShape } = semanticKernel(2);
    let failure: unknown;

    try {
      tessellateSemanticBodies(
        kernel,
        [{ id: "base", shape: baseShape }],
        [{
          id: "body", terminalFeatureId: "cut",
          lineageFeatureIds: ["base", "cut"], shape: bodyShape,
        }],
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      name: "CadRebuildError",
      code: "reference-requires-repair",
    });
  });

  it("copies mesh-sized ownership buffers without using an unbounded argument spread", () => {
    const { kernel, baseShape, bodyShape } = semanticKernel(1, 200_001);

    const mesh = tessellateSemanticBodies(
      kernel,
      [{ id: "base", shape: baseShape }],
      [{
        id: "body", terminalFeatureId: "base",
        lineageFeatureIds: ["base"], shape: bodyShape,
      }],
    );

    expect(mesh.indices).toHaveLength(200_001);
    expect(mesh.triangleFaceIndices).toHaveLength(66_667);
    expect(mesh.triangleFaceIndices.every((owner) => owner === 0)).toBe(true);
  });

  it("rejects a mesh over the explicit vertex capability before ownership allocation", () => {
    const { kernel, baseShape, bodyShape } = semanticKernel(
      1, 3, CAD_RESOURCE_LIMITS.semanticMeshVertices + 1,
    );

    expect(() => tessellateSemanticBodies(
      kernel,
      [{ id: "base", shape: baseShape }],
      [{
        id: "body", terminalFeatureId: "base",
        lineageFeatureIds: ["base"], shape: bodyShape,
      }],
    )).toThrow(expect.objectContaining({ code: "resource-limit" }));
  });
});
