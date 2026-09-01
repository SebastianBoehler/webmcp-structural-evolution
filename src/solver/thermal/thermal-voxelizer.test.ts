import { expect, test, vi } from "vitest";

import { createThermalAnalyticalRequest } from "./thermal-analytical-request";
import { produceThermalVoxelMesh } from "./thermal-voxelizer";

const exactClassifier = vi.hoisted(() => ({ produce: vi.fn() }));
vi.mock("../structural/structural-voxelizer", () => ({
  produceStructuralVoxelMesh: exactClassifier.produce,
}));

test("derives thermal occupancy and exact named boundary faces from the exact-BREP classifier", async () => {
  const source = await createThermalAnalyticalRequest({ dimensions: [2, 1, 1], cellSizeM: 1,
    bodies: [{ id: "bar", materialId: "metal", conductivityWmK: 1 }],
    cellBodyIndices: new Uint32Array(2), boundaries: [
      { id: "left", cellIndex: 0, axis: 0, direction: -1, areaM2: 1, temperatureK: 300 },
      { id: "right", cellIndex: 1, axis: 0, direction: 1, areaM2: 1, heatFluxWm2: 10 },
    ] });
  const semanticMeshPayload = { ...source.input.semanticMeshPayload,
    faces: source.input.semanticMeshPayload.faces.map((face, faceIndex) => faceIndex === 1
      ? { ...face, signature: { ...face.signature,
        centroidM: [2, 0, 0] as [number, number, number] } } : face) };
  exactClassifier.produce.mockResolvedValueOnce({ record: source.inputArtifacts[2], payload: {
    dimensions: new Uint32Array([2, 1, 1]), originM: new Float64Array([0, 0, 0]),
    activeCells: new Uint32Array([1, 1]),
  }, exact: { brepArtifact: source.inputArtifacts[0], brepPayload: { bytes: Uint8Array.of(1) },
    semanticArtifact: source.inputArtifacts[1], semanticMeshPayload } });

  const produced = await produceThermalVoxelMesh({ document: source.document, bodyIds: ["bar"],
    cellSizeM: 1, rasterizationToleranceM: .01 });

  expect(exactClassifier.produce).toHaveBeenCalledOnce();
  expect([...produced.payload.activeCells]).toEqual([1, 1]);
  expect([...produced.payload.selectionFaceOffsets]).toEqual([0, 1, 2]);
  expect([...produced.payload.selectionFaceCells]).toEqual([0, 1]);
  expect([...produced.payload.selectionFaceAxes]).toEqual([0, 0]);
  expect([...produced.payload.selectionFaceDirections]).toEqual([-1, 1]);
  expect([...produced.payload.selectionFaceAreasM2]).toEqual([1, 1]);
  expect(produced.record).toMatchObject({ kind: "sdf", sourceRevision: source.document.revision,
    producer: { name: "thermal-voxelizer", version: "1" } });
  expect(produced.record.dependencies).toEqual(expect.arrayContaining([
    { kind: "artifact", artifactId: source.inputArtifacts[0]!.id },
    { kind: "artifact", artifactId: source.inputArtifacts[1]!.id },
    { kind: "artifact", artifactId: source.inputArtifacts[2]!.id },
  ]));
});
