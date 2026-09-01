import { expect, test, vi } from "vitest";

import {
  COBOT_THERMAL_BOUNDARY_AREA_M2,
  COBOT_THERMAL_HEAT_INPUT_W,
  createCobotThermalDocument,
  createCobotThermalBenchmarkFromDocument,
} from "./cobot-thermal-study";
import { defineArtifactRecord } from "../../cad/artifact-contract";
import { createThermalAnalyticalRequest } from "../../solver/thermal/thermal-analytical-request";
import { compileThermalStudy } from "../../solver/thermal/compile-thermal-study";
import {
  THERMAL_VOXEL_MEDIA_TYPE, THERMAL_VOXEL_PRODUCER,
} from "../../solver/thermal/thermal-contract";
import { digestArtifactPayload } from "../../engineering/artifact-store";

const voxelizer = vi.hoisted(() => ({ produce: vi.fn() }));
vi.mock("../../solver/thermal/thermal-voxelizer", () => ({
  produceThermalVoxelMesh: voxelizer.produce,
}));

test("builds the exact aluminum cobot link study with canonical mounting and motor boundaries", async () => {
  const exact = await createThermalAnalyticalRequest({
    dimensions: [42, 8, 8], cellSizeM: .01,
    bodies: [{ id: "upper-arm-link", materialId: "aluminum-6061", conductivityWmK: 167 }],
    cellBodyIndices: new Uint32Array(42 * 8 * 8),
    boundaries: [
      { id: "mounting-interface", cellIndex: 0, axis: 0, direction: -1,
        areaM2: COBOT_THERMAL_BOUNDARY_AREA_M2, temperatureK: 300 },
      { id: "motor-interface", cellIndex: 41, axis: 0, direction: 1,
        areaM2: COBOT_THERMAL_BOUNDARY_AREA_M2, heatFluxWm2: 12_500 },
    ],
  });
  const document = await createCobotThermalDocument(exact.document, exact.input.semanticMeshPayload);
  const dependencies = [{ kind: "entity" as const, reference: `document:${document.id}` as const },
    { kind: "entity" as const, reference: "body:upper-arm-link" as const }];
  const own = async (source: typeof exact.inputArtifacts[number]) => defineArtifactRecord({
    kind: source.kind, sourceRevision: document.revision, producer: source.producer,
    settingsDigest: source.settingsDigest, contentDigest: source.contentDigest,
    units: source.units, mediaType: source.mediaType, dependencies,
  });
  const brep = await own(exact.inputArtifacts[0]!);
  const semantic = await own(exact.inputArtifacts[1]!);
  const mounting = Array.from({ length: 64 }, (_, index) => 42 * index);
  const motor = mounting.map((cell) => cell + 41), faces = [...mounting, ...motor];
  const payload = { ...exact.input.voxelPayload,
    selectionFaceOffsets: new Uint32Array([0, 64, 128]),
    selectionFaceCells: Uint32Array.from(faces), selectionFaceAxes: new Uint8Array(128),
    selectionFaceDirections: Int8Array.from(faces, (_cell, index) => index < 64 ? -1 : 1),
    selectionFaceAreasM2: new Float64Array(128).fill(.0001) };
  const voxelRecord = await defineArtifactRecord({ kind: "sdf", sourceRevision: document.revision,
    producer: THERMAL_VOXEL_PRODUCER, settingsDigest: exact.inputArtifacts[2]!.settingsDigest,
    contentDigest: await digestArtifactPayload(payload), units: "m", mediaType: THERMAL_VOXEL_MEDIA_TYPE,
    dependencies: [...dependencies, { kind: "artifact", artifactId: brep.id },
      { kind: "artifact", artifactId: semantic.id }] });
  voxelizer.produce.mockResolvedValueOnce({ record: voxelRecord, payload, exact: {
    brepArtifact: brep, brepPayload: { bytes: Uint8Array.of(1) }, semanticArtifact: semantic,
    semanticMeshPayload: exact.input.semanticMeshPayload,
  } });
  const benchmark = await createCobotThermalBenchmarkFromDocument(document);

  const study = benchmark.request.document.studies.find(({ id }) => id === "se6-upper-arm-thermal");
  expect(study).toMatchObject({
    kind: "thermal-steady", bodyIds: ["upper-arm-link"], materialId: "aluminum-6061",
    boundaries: {
      temperatures: [{ selectionId: "mounting-interface", temperatureK: 300 }],
      heatFluxes: [{ selectionId: "motor-interface", heatFluxWm2: 12_500 }],
    },
  });
  expect(benchmark.request.input.voxelPayload.activeCells).toHaveLength(42 * 8 * 8);
  expect(benchmark.request.input.voxelPayload.selectionFaceCells).toHaveLength(128);
  expect(benchmark.selectedAreasM2).toEqual({
    mounting: COBOT_THERMAL_BOUNDARY_AREA_M2,
    motor: COBOT_THERMAL_BOUNDARY_AREA_M2,
  });
  expect(benchmark.heatInputW).toBe(COBOT_THERMAL_HEAT_INPUT_W);
  expect(voxelizer.produce).toHaveBeenCalledOnce();
  expect(benchmark.request.inputArtifacts.map(({ id }) => id)).toEqual([
    benchmark.request.input.exactBrepArtifactId,
    benchmark.request.input.semanticMeshArtifactId,
    benchmark.request.input.thermalVoxelArtifactId,
  ]);
  const compiled = await compileThermalStudy(benchmark.request, {
    maxCells: 262_144, maxBoundaryFaces: 1_048_576, maxRelativeAreaError: .02,
  });
  expect(compiled.rasterization.selections.map(({ selectionId, faceCount }) =>
    ({ selectionId, faceCount }))).toEqual([
    { selectionId: "mounting-interface", faceCount: 64 },
    { selectionId: "motor-interface", faceCount: 64 },
  ]);
  expect(Math.max(...compiled.rasterization.selections.map(({ relativeAreaError }) => relativeAreaError)))
    .toBeLessThan(1e-12);
  expect(compiled.neumannFaces.reduce((watts, face) =>
    watts + face.areaM2 * face.heatFluxWm2, 0)).toBeCloseTo(80, 12);
});
