import { describe, expect, it } from "vitest";

import { defineArtifactRecord } from "../../cad/artifact-contract";
import { defineDesignDocument, type DesignDocument } from "../../cad/document-schema";
import { defineEngineeringSolveRequest } from "../../cad/engineering-job-contract";
import { digestCadOutputPayload, type SemanticMeshPayload } from "../../cad/rebuild-payload";
import { digestArtifactPayload } from "../../engineering/artifact-store";
import {
  THERMAL_VOXEL_MEDIA_TYPE,
  THERMAL_VOXEL_PRODUCER,
  type ThermalCompileLimits,
  type ThermalSolveInput,
  type ThermalVoxelPayload,
} from "./thermal-contract";
import { compileThermalStudy } from "./compile-thermal-study";

const digest = (character: string) => character.repeat(64);

describe("compileThermalStudy", () => {
  it("rejects a steady study without a fixed-temperature boundary", async () => {
    await expect(compile(await thermalRequest({ temperatures: [] })))
      .rejects.toThrow("Steady thermal study requires at least one temperature boundary");
  });

  it("rejects an unresolved boundary selection", async () => {
    const request = await thermalRequest();
    await expect(compile({ ...request, document: { ...request.document, studies: request.document.studies.map((study) => study.id === "thermal-bar" ? { ...study, boundaries: { temperatures: [{ selectionId: "missing", temperatureK: 300 }], heatFluxes: [] } } : study) } } as typeof request))
      .rejects.toThrow("Thermal boundary selection is unresolved: missing");
  });

  it("rejects overlapping contradictory fixed temperatures", async () => {
    await expect(compile(await thermalRequest({
      temperatures: [
        { selectionId: "fixed-end", temperatureK: 300 },
        { selectionId: "fixed-end-alias", temperatureK: 400 },
      ],
    }))).rejects.toThrow("Thermal fixed-temperature boundaries conflict at cell 0");
  });

  it.each([0, -1, Number.POSITIVE_INFINITY])("rejects non-positive or non-finite conductivity %s", async (conductivityWmK) => {
    await expect(compile(await thermalRequest({}, conductivityWmK)))
      .rejects.toThrow("Thermal material conductivity must be positive and finite");
  });

  it("rejects a selected boundary that rasterizes to zero faces", async () => {
    await expect(compile(await thermalRequest({}, 200, { selectionFaceOffsets: new Uint32Array([0, 0, 2]) })))
      .rejects.toThrow("Thermal boundary fixed-end rasterized to zero faces");
  });

  it("rejects stale exact geometry", async () => {
    await expect(compile(await thermalRequest({}, 200, {}, "f".repeat(64))))
      .rejects.toThrow("Thermal input artifact has a stale source revision");
  });

  it.each([
    { name: "foreign-voxelizer", version: "1" },
    { name: "thermal-voxelizer", version: "2" },
  ])("rejects a thermal voxel artifact from non-authoritative producer $name@$version", async (producer) => {
    await expect(compile(await thermalRequest(
      {}, 200, {}, undefined, 0.0001, producer,
    ))).rejects.toThrow(/authoritative thermal voxelizer/);
  });

  it("rejects a disconnected material island without a temperature reference", async () => {
    await expect(compile(await thermalRequest({}, 200, {
      activeCells: new Uint32Array([1, 0, 0, 1]),
      cellBodyIndices: new Uint32Array([0, 0xffff_ffff, 0xffff_ffff, 0]),
      selectionFaceCells: new Uint32Array([0, 0]),
    }))).rejects.toThrow("Thermal active material island 1 has no temperature boundary");
  });

  it("rejects a thermal grid exceeding its adapter capability", async () => {
    await expect(compile(await thermalRequest(), { maxCells: 3 }))
      .rejects.toThrow("Thermal grid cell limit exceeded: 4 > 3");
  });

  it("compiles finite SI fields and records rasterization area evidence", async () => {
    const compiled = await compile(await thermalRequest());

    expect(compiled.grid).toEqual({ cellDimensions: [4, 1, 1], originM: [0, 0, 0], cellSizeM: 0.01 });
    expect(compiled.activeCellCount).toBe(4);
    expect(Array.from(compiled.conductivityWmK)).toEqual([200, 200, 200, 200]);
    expect(compiled.dirichletCells).toEqual([{ cellIndex: 0, temperatureK: 300 }]);
    expect(compiled.neumannFaces).toEqual([{ cellIndex: 3, axis: 0, direction: 1, areaM2: 0.0001, heatFluxWm2: 1000 }]);
    expect(compiled.rasterization.selections).toEqual([
      expect.objectContaining({ selectionId: "fixed-end", selectedAreaM2: 0.0001, representedAreaM2: 0.0001, relativeAreaError: 0 }),
      expect.objectContaining({ selectionId: "hot-end", selectedAreaM2: 0.0001, representedAreaM2: 0.0001, relativeAreaError: 0 }),
    ]);
  });

  it("rejects foreign, missing, or out-of-range voxel body ownership", async () => {
    const foreign = Uint8Array.from(JSON.stringify(["foreign"]), (value) => value.charCodeAt(0));
    await expect(compile(await thermalRequest({}, 200, { bodyIdsUtf8: foreign } as never)))
      .rejects.toThrow(/body ownership table/);
    await expect(compile(await thermalRequest({}, 200, {
      cellBodyIndices: new Uint32Array([0, 1, 0, 0]),
    } as never))).rejects.toThrow(/body owner index/);
    await expect(compile(await thermalRequest({}, 200, {
      bodyIdsUtf8: new Uint8Array(),
    } as never))).rejects.toThrow(/body ownership table/);
    await expect(compile(await thermalRequest({}, 200, {
      activeCells: new Uint32Array([1, 1, 1, 0]),
      cellBodyIndices: new Uint32Array([0, 0, 0, 0]),
    } as never))).rejects.toThrow(/body owner index/);
  });

  it("derives selected area from the resolved exact semantic face", async () => {
    const compiled = await compileThermalStudy(await thermalRequest({}, 200, {}, undefined, 0.0002), {
      maxCells: 262_144, maxBoundaryFaces: 1_048_576, maxRelativeAreaError: 0.6,
    });
    expect(compiled.rasterization.selections[0]).toMatchObject({
      selectedAreaM2: 0.0002, representedAreaM2: 0.0001, relativeAreaError: 0.5,
    });
  });

  it("rejects a thermal voxel artifact without exact BREP authority", async () => {
    const request = await thermalRequest();
    await expect(compile({ ...request, input: { ...request.input, exactBrepArtifactId: request.input.semanticMeshArtifactId } })).rejects.toThrow("Thermal study requires a revision-bound exact BREP artifact");
  });

  it.each([
    ["duplicate face", { selectionFaceOffsets: new Uint32Array([0, 2, 3]), selectionFaceCells: new Uint32Array([0, 0, 3]), selectionFaceAxes: new Uint8Array([0, 0, 0]), selectionFaceDirections: new Int8Array([-1, -1, 1]), selectionFaceAreasM2: new Float64Array([0.0001, 0.0001, 0.0001]) }],
    ["internal face", { selectionFaceCells: new Uint32Array([1, 3]), selectionFaceDirections: new Int8Array([1, 1]) }],
    ["incoherent face area", { selectionFaceAreasM2: new Float64Array([0.0002, 0.0001]) }],
  ])("rejects an invalid $0", async (_label, payload) => {
    await expect(compile(await thermalRequest({}, 200, payload))).rejects.toThrow(/Thermal boundary raster/);
  });

  it.each([NaN, Infinity, 1.5, 0])("rejects an invalid capability limit %s", async (maxCells) => {
    await expect(compileThermalStudy(await thermalRequest(), {
      maxCells, maxBoundaryFaces: 16, maxRelativeAreaError: 0.01,
    })).rejects.toThrow("Thermal capability limits must be positive safe integers");
  });

  it("enforces one aggregate boundary-face capability", async () => {
    await expect(compileThermalStudy(await thermalRequest(), {
      maxCells: 16, maxBoundaryFaces: 1, maxRelativeAreaError: 0.01,
    })).rejects.toThrow("Thermal boundary face limit exceeded");
  });

  it("rejects a boundary face larger than its physical voxel face at maximum classification tolerance", async () => {
    await expect(compileThermalStudy(await thermalRequest({}, 200, {
      rasterizationToleranceM: new Float64Array([0.005]),
      selectionFaceAreasM2: new Float64Array([0.000199, 0.0001]),
    }), { maxCells: 16, maxBoundaryFaces: 16, maxRelativeAreaError: 2 })).rejects.toThrow(/Thermal boundary raster/);
  });

  it("rejects one oversized boundary range before inspecting its malformed faces", async () => {
    await expect(compileThermalStudy(await thermalRequest({}, 200, {
      selectionFaceOffsets: new Uint32Array([0, 10, 11]),
      selectionFaceCells: new Uint32Array([999, 999, 999, 999, 999, 999, 999, 999, 999, 999, 3]),
      selectionFaceAxes: new Uint8Array(11), selectionFaceDirections: new Int8Array([-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, 1]),
      selectionFaceAreasM2: new Float64Array(11).fill(0.0001),
    }), { maxCells: 16, maxBoundaryFaces: 1, maxRelativeAreaError: 0.01 })).rejects.toThrow("Thermal boundary face limit exceeded");
  });

  it("rejects an inflated face on a sub-nanometre physical voxel face", async () => {
    await expect(compileThermalStudy(await thermalRequest({}, 200, {
      cellSizeM: new Float64Array([1e-10, 1e-10, 1e-10]),
      rasterizationToleranceM: new Float64Array([1e-12]),
      selectionFaceAreasM2: new Float64Array([1e-17, 1e-20]),
    }, undefined, 1e-17), { maxCells: 16, maxBoundaryFaces: 16, maxRelativeAreaError: 1e20 })).rejects.toThrow(/Thermal boundary raster/);
  });

  it("rejects a finite cell size whose physical face area overflows", async () => {
    await expect(compileThermalStudy(await thermalRequest({}, 200, {
      cellSizeM: new Float64Array([1e200, 1e200, 1e200]),
    }), { maxCells: 16, maxBoundaryFaces: 16, maxRelativeAreaError: 0.01 })).rejects.toThrow("Thermal voxel face area must be positive finite");
  });

  it("rejects cell size or area that cannot remain positive finite in the f32 operator", async () => {
    await expect(compile(await thermalRequest({}, 200, {
      cellSizeM: new Float64Array([1e-30, 1e-30, 1e-30]),
    }))).rejects.toThrow("Thermal voxel cell size and face area must be positive finite f32");
  });

  it.each([1e-50, 1e100])("rejects conductivity outside the f32 operator envelope %s", async (conductivityWmK) => {
    await expect(compile(await thermalRequest({}, conductivityWmK))).rejects.toThrow("Thermal material conductivity must be positive finite f32");
  });

  it("rejects compilation without a declared area-error capability", async () => {
    await expect(compileThermalStudy(await thermalRequest(), {
      maxCells: 16, maxBoundaryFaces: 16,
    } as ThermalCompileLimits)).rejects.toThrow("Thermal rasterization area-error capability must be finite and nonnegative");
  });
});

function compile(request: Awaited<ReturnType<typeof thermalRequest>>, overrides: Partial<ThermalCompileLimits> = {}) {
  return compileThermalStudy(request, { maxCells: 262_144, maxBoundaryFaces: 1_048_576, maxRelativeAreaError: 0.01, ...overrides });
}

type BoundaryOverrides = Readonly<{
  temperatures?: readonly { selectionId: string; temperatureK: number }[];
  heatFluxes?: readonly { selectionId: string; heatFluxWm2: number }[];
}>;

async function thermalRequest(
  boundaries: BoundaryOverrides = {},
  conductivityOrLimits: number | { maxCells: number } = 200,
  payloadOverrides: Partial<ThermalVoxelPayload> = {},
  sourceRevision = undefined as string | undefined,
  semanticMeasureM2 = 0.0001,
  voxelProducer: { readonly name: string; readonly version: string } = THERMAL_VOXEL_PRODUCER,
) {
  const conductivityWmK = typeof conductivityOrLimits === "number" ? conductivityOrLimits : 200;
  const document = await thermalDocument(boundaries, Number.isFinite(conductivityWmK) ? conductivityWmK : 200);
  const semanticMeshPayload = semanticMesh(semanticMeasureM2);
  const semantic = await defineArtifactRecord({
    kind: "render-mesh", sourceRevision: sourceRevision ?? document.revision,
    producer: { name: "occt-wasm", version: "4.3.2" }, settingsDigest: digest("a"),
    contentDigest: await digestCadOutputPayload(semanticMeshPayload), units: "m",
    mediaType: "application/vnd.structural-evolution.semantic-mesh",
    dependencies: [{ kind: "entity", reference: "document:thermal-test" }, { kind: "entity", reference: "body:bar" }],
  });
  const brep = await defineArtifactRecord({
    kind: "brep", sourceRevision: document.revision, producer: { name: "occt-wasm", version: "4.3.2" },
    settingsDigest: digest("b"), contentDigest: digest("c"), units: "m", mediaType: "application/vnd.opencascade.brep",
    dependencies: [{ kind: "entity", reference: "document:thermal-test" }, { kind: "entity", reference: "body:bar" }],
  });
  const payload = thermalVoxelPayload(payloadOverrides);
  const voxel = await defineArtifactRecord({
    kind: "sdf", sourceRevision: document.revision, producer: voxelProducer, settingsDigest: digest("d"),
    contentDigest: await digestArtifactPayload(payload), units: "m", mediaType: THERMAL_VOXEL_MEDIA_TYPE,
    dependencies: [{ kind: "entity", reference: "document:thermal-test" }, { kind: "entity", reference: "body:bar" }, { kind: "artifact", artifactId: brep.id }, { kind: "artifact", artifactId: semantic.id }],
  });
  const request = await defineEngineeringSolveRequest<ThermalSolveInput>({
    jobId: "bar-thermal", kind: "thermal", sourceRevision: document.revision,
    inputArtifacts: [brep, semantic, voxel], settings: {}, studyId: "thermal-bar", document,
    input: { exactBrepArtifactId: brep.id, semanticMeshArtifactId: semantic.id, semanticMeshPayload, thermalVoxelArtifactId: voxel.id, voxelPayload: payload },
  });
  if (!Number.isFinite(conductivityWmK)) return {
    ...request,
    document: {
      ...request.document,
      materials: request.document.materials.map((material) => material.id === "aluminum"
        ? { ...material, thermalConductivityWmK: conductivityWmK } : material),
    },
  } as typeof request;
  return request;
}

async function thermalDocument(boundaries: BoundaryOverrides, conductivityWmK: number): Promise<DesignDocument> {
  return defineDesignDocument({
    id: "thermal-test", label: "Thermal test", schemaVersion: 6,
    units: { length: "m", angle: "rad", mass: "kg" }, createdBy: { kind: "human", id: "tester" },
    frames: [{ id: "world", label: "World", transform: { position: { x: { value: 0, unit: "m" }, y: { value: 0, unit: "m" }, z: { value: 0, unit: "m" } }, orientation: { roll: { value: 0, unit: "rad" }, pitch: { value: 0, unit: "rad" }, yaw: { value: 0, unit: "rad" } } } }],
    parameters: [], sketches: [{ id: "profile", plane: "frame:world", constraints: [], entities: [{ id: "outline", kind: "rectangle", centerM: [0.02, 0.005], sizeM: [0.04, 0.01] }] }],
    features: [{ id: "extrude", kind: "extrude", sketchId: "profile", distanceM: 0.01 }], bodies: [{ id: "bar", featureId: "extrude" }],
    components: [], instances: [], mates: [],
    namedSelections: [selection("fixed-end", "face:bar:fixed", [0, 0.005, 0.005]), selection("fixed-end-alias", "face:bar:fixed", [0, 0.005, 0.005]), selection("hot-end", "face:bar:hot", [0.04, 0.005, 0.005])],
    materials: [{ id: "aluminum", kind: "isotropic", densityKgM3: 2700, youngsModulusPa: 70e9, poissonRatio: 0.33, failureStressPa: 90e6, thermalConductivityWmK: conductivityWmK }],
    studies: [{ id: "thermal-bar", kind: "thermal-steady", bodyIds: ["bar"], materialId: "aluminum", boundaries: { temperatures: boundaries.temperatures ?? [{ selectionId: "fixed-end", temperatureK: 300 }], heatFluxes: boundaries.heatFluxes ?? [{ selectionId: "hot-end", heatFluxWm2: 1000 }] } }],
  });
}

function selection(id: string, stableId: string, centroidM: [number, number, number]) {
  return { id, reference: { bodyId: "bar", ownerFeatureId: "extrude", expectedKind: "face" as const, stableId, signature: { geometry: "plane" as const, centroidM, measureSI: 0.0001, adjacentKinds: [] } } };
}

function semanticMesh(measureSI = 0.0001): SemanticMeshPayload {
  return {
    positionsM: new Float32Array([0, 0, 0, 0, 0.01, 0, 0, 0, 0.01, 0.04, 0, 0, 0.04, 0.01, 0, 0.04, 0, 0.01]),
    normals: new Float32Array([-1, 0, 0, -1, 0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0]), indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
    faces: [face("face:bar:fixed", [0, 0.005, 0.005], measureSI), face("face:bar:hot", [0.04, 0.005, 0.005], measureSI)], triangleFaceIndices: new Uint32Array([0, 1]),
    edgePointsM: new Float32Array(), edgePointRanges: new Uint32Array(), edges: [], polylineEdgeIndices: new Uint32Array(),
  };
}

function face(id: string, centroidM: [number, number, number], measureSI: number) {
  return { id, bodyId: "bar", surfaceEvidence: { kind: "plane" as const, normal: [centroidM[0] === 0 ? -1 : 1, 0, 0] as [number, number, number] }, signature: { ownerFeatureId: "extrude", kind: "face" as const, geometry: "plane" as const, centroidM, measureSI, adjacentKinds: [] } };
}

function thermalVoxelPayload(overrides: Partial<ThermalVoxelPayload>): ThermalVoxelPayload {
  return {
    dimensions: new Uint32Array([4, 1, 1]), originM: new Float64Array([0, 0, 0]), cellSizeM: new Float64Array([0.01, 0.01, 0.01]), activeCells: new Uint32Array([1, 1, 1, 1]),
    bodyIdsUtf8: Uint8Array.from(JSON.stringify(["bar"]), (value) => value.charCodeAt(0)),
    cellBodyIndices: new Uint32Array([0, 0, 0, 0]),
    selectionTopologyIdsUtf8: Uint8Array.from(JSON.stringify(["face:bar:fixed", "face:bar:hot"]), (value) => value.charCodeAt(0)),
    selectionFaceOffsets: new Uint32Array([0, 1, 2]), selectionFaceCells: new Uint32Array([0, 3]), selectionFaceAxes: new Uint8Array([0, 0]), selectionFaceDirections: new Int8Array([-1, 1]),
    selectionFaceAreasM2: new Float64Array([0.0001, 0.0001]), rasterizationToleranceM: new Float64Array([1e-6]), ...overrides,
  };
}
