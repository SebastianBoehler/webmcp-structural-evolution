import { afterEach, describe, expect, it, vi } from "vitest";
import { OcctKernel } from "occt-wasm";
import { defineArtifactRecord } from "../../cad/artifact-contract";
import { defineDesignDocument } from "../../cad/document-schema";
import { defineEngineeringSolveRequest } from "../../cad/engineering-job-contract";
import { digestCadOutputPayload, type SemanticMeshPayload } from "../../cad/rebuild-payload";
import { structuralDocument } from "./structural-test-fixtures";
import { compileStructuralStudy } from "./compile-structural-study";
import { rebuildStructuralExactSource } from "./structural-exact-source";
import { produceStructuralVoxelMesh as produceWithInternalRebuild } from "./structural-voxelizer";
import * as producerSurface from "./structural-voxelizer";
vi.mock("./structural-exact-source", () => ({ rebuildStructuralExactSource: vi.fn() }));
const FACE_IDS = ["bottom", "top", "front", "back", "fixed", "loaded"] as const;
function boxMesh(open = false, lengthM = .04): SemanticMeshPayload {
  const positionsM = new Float32Array([
    0, 0, 0, lengthM, 0, 0, lengthM, .02, 0, 0, .02, 0,
    0, 0, .02, lengthM, 0, .02, lengthM, .02, .02, 0, .02, .02,
  ]);
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2,
    0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5,
  ]).slice(0, open ? 30 : 36);
  const owners = Uint32Array.from([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]).slice(
    0, indices.length / 3,
  );
  const centroids = [
    [lengthM / 2, .01, 0], [lengthM / 2, .01, .02],
    [lengthM / 2, 0, .01], [lengthM / 2, .02, .01],
    [0, .01, .01], [lengthM, .01, .01],
  ] as const;
  return {
    positionsM, normals: new Float32Array(positionsM.length), indices,
    faces: FACE_IDS.map((id, index) => ({
      id: `face:bar:${id}`, bodyId: "bar",
      surfaceEvidence: { kind: "plane" as const, normal: [
        index === 4 ? -1 : index === 5 ? 1 : 0,
        index === 2 ? -1 : index === 3 ? 1 : 0,
        index === 0 ? -1 : index === 1 ? 1 : 0,
      ] as [number, number, number] },
      signature: {
        ownerFeatureId: "extrude", kind: "face", geometry: "plane",
        centroidM: [...centroids[index]!] as [number, number, number],
        measureSI: index < 4 ? lengthM * .02 : .0004,
        adjacentKinds: [],
      },
    })),
    triangleFaceIndices: owners, edgePointsM: new Float32Array(),
    edgePointRanges: new Uint32Array(), edges: [], polylineEdgeIndices: new Uint32Array(),
  };
}
async function inputs(open = false, duplicateSelection = false, lengthM = .04) {
  const source = await structuralDocument(duplicateSelection
    ? [{ selectionId: "loaded-copy", forceN: [1, 0, 0] }] : []);
  const { revision: _revision, ...content } = source;
  const mesh = boxMesh(open, lengthM);
  const document = await defineDesignDocument({
    ...content,
    namedSelections: [
      { id: "fixed-end", reference: {
        bodyId: "bar", ownerFeatureId: "extrude", expectedKind: "face",
        stableId: "face:bar:fixed", signature: {
          geometry: "plane", centroidM: [0, .01, .01], measureSI: .0004, adjacentKinds: [],
        },
      } },
      { id: "loaded-end", reference: {
        bodyId: "bar", ownerFeatureId: "extrude", expectedKind: "face",
        stableId: "face:bar:loaded", signature: {
          geometry: "plane", centroidM: [lengthM, .01, .01], measureSI: .0004, adjacentKinds: [],
        },
      } },
      ...(duplicateSelection ? [{ id: "loaded-copy", reference: {
        bodyId: "bar", ownerFeatureId: "extrude", expectedKind: "face" as const,
        stableId: "face:bar:loaded", signature: {
          geometry: "plane" as const, centroidM: [.04, .01, .01] as [number, number, number],
          measureSI: .0004, adjacentKinds: [],
        },
      } }] : []),
    ],
  });
  const semanticArtifact = await defineArtifactRecord({
    kind: "render-mesh", sourceRevision: document.revision,
    producer: { name: "occt-wasm", version: "4.3.2" },
    settingsDigest: "a".repeat(64), contentDigest: await digestCadOutputPayload(mesh),
    units: "m", mediaType: "application/vnd.structural-evolution.semantic-mesh",
    dependencies: [
      { kind: "entity", reference: `document:${document.id}` },
      { kind: "entity", reference: "body:bar" },
    ],
  });
  const kernel = await OcctKernel.init();
  let brepPayload;
  try {
    const shape = kernel.makeBox(lengthM, .02, .02);
    try { brepPayload = { bytes: kernel.toBREPBinary(shape) }; }
    finally { kernel.release(shape); }
  } finally { kernel[Symbol.dispose](); }
  const brepArtifact = await defineArtifactRecord({
    kind: "brep", sourceRevision: document.revision,
    producer: { name: "occt-wasm", version: "4.3.2" },
    settingsDigest: "b".repeat(64), contentDigest: await digestCadOutputPayload(brepPayload),
    units: "m", mediaType: "application/vnd.opencascade.brep",
    dependencies: [
      { kind: "entity", reference: `document:${document.id}` },
      { kind: "entity", reference: "body:bar" },
    ],
  });
  return { document, mesh, semanticArtifact, brepArtifact, brepPayload };
}
const producerInput = (input: Awaited<ReturnType<typeof inputs>>) => ({
  ...input, semanticMeshPayload: input.mesh, bodyIds: ["bar"],
  cellSizeM: .01, rasterizationToleranceM: 1e-6,
});
async function produceStructuralVoxelMesh(
  input: ReturnType<typeof producerInput> & { readonly signal?: AbortSignal },
) {
  vi.mocked(rebuildStructuralExactSource).mockResolvedValueOnce({
    brepArtifact: input.brepArtifact, brepPayload: input.brepPayload,
    semanticArtifact: input.semanticArtifact, semanticMeshPayload: input.semanticMeshPayload,
  });
  const {
    brepArtifact: _brepArtifact, brepPayload: _brepPayload,
    semanticArtifact: _semanticArtifact, semanticMeshPayload: _semanticMeshPayload,
    ...settings
  } = input;
  return produceWithInternalRebuild(settings);
}
describe("exact semantic mesh voxel producer", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("exposes only the document-owned producer and ignores caller-supplied exact fields", async () => {
    expect(Object.keys(producerSurface)).toEqual([
      "produceStructuralVoxelMeshFromExact", "produceStructuralVoxelMesh",
    ]);
    const input = await inputs();
    vi.mocked(rebuildStructuralExactSource).mockResolvedValueOnce({
      brepArtifact: input.brepArtifact, brepPayload: input.brepPayload,
      semanticArtifact: input.semanticArtifact, semanticMeshPayload: input.mesh,
    });
    const produced = await produceWithInternalRebuild({
      document: input.document, bodyIds: ["bar"], cellSizeM: .01,
      rasterizationToleranceM: 1e-6,
      brepArtifact: undefined, semanticArtifact: undefined,
    } as never);
    expect(rebuildStructuralExactSource).toHaveBeenCalledWith(input.document, expect.any(AbortSignal));
    expect(produced.record.dependencies).toEqual(expect.arrayContaining([
      { kind: "artifact", artifactId: input.brepArtifact.id },
      { kind: "artifact", artifactId: input.semanticArtifact.id },
    ]));
  });
  it("derives a deterministic content-addressed structural domain and face rasterization", async () => {
    const input = await inputs();
    const first = await produceStructuralVoxelMesh(producerInput(input));
    const second = await produceStructuralVoxelMesh(producerInput(input));
    expect([...first.payload.dimensions]).toEqual([4, 2, 2]);
    expect([...first.payload.activeCells]).toEqual(new Array(16).fill(1));
    expect([...first.payload.selectionCellOffsets]).toEqual([0, 4, 8]);
    expect([...first.payload.selectionNodeOffsets]).toEqual([0, 9, 18]);
    expect(first.record.id).toBe(second.record.id);
    expect(first.record.dependencies).toEqual(expect.arrayContaining([
      { kind: "entity", reference: "body:bar" },
      { kind: "artifact", artifactId: input.brepArtifact.id },
      { kind: "artifact", artifactId: input.semanticArtifact.id },
    ]));
    const request = await defineEngineeringSolveRequest<import("./structural-contract").StructuralSolveInput>({
      jobId: "exact-box-fea", kind: "fea", sourceRevision: input.document.revision,
      inputArtifacts: [input.brepArtifact, input.semanticArtifact, first.record], settings: {},
      studyId: "bar-static", document: input.document,
      input: {
        semanticMeshArtifactId: input.semanticArtifact.id,
        semanticMeshPayload: input.mesh,
        voxelArtifactId: first.record.id, voxelPayload: first.payload,
      },
    });
    await expect(compileStructuralStudy(request)).resolves.toMatchObject({ activeCellCount: 16 });
  });
  it("snaps a Float32 0.10 metre semantic bound to exactly ten 0.01 metre cells", async () => {
    const input = await inputs(false, false, .1);
    const produced = await produceStructuralVoxelMesh(producerInput(input));
    expect([...produced.payload.dimensions]).toEqual([10, 2, 2]);
  });
  it("rejects an open surface instead of manufacturing solver occupancy", async () => {
    const input = await inputs(true);
    await expect(produceStructuralVoxelMesh(producerInput(input))).rejects.toThrow("closed");
  });
  it("rejects two consumed selections that resolve to the same exact face", async () => {
    const input = await inputs(false, true);
    await expect(produceStructuralVoxelMesh(producerInput(input))).rejects.toThrow(/duplicate exact face/i);
  });
  it("rejects an unbounded requested grid before allocation", async () => {
    const input = await inputs();
    await expect(produceStructuralVoxelMesh({
      ...input, semanticMeshPayload: input.mesh, bodyIds: ["bar"],
      cellSizeM: 1e-5, rasterizationToleranceM: 1e-7,
    })).rejects.toThrow("cell limit");
  });
  it("rejects the exposed-facet correspondence product budget before rasterization", async () => {
    class ClassifierWorker {
      private listener?: (event: MessageEvent) => void;
      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        if (type === "message") this.listener = listener;
      }
      postMessage(message: { requestId: string; pointsM: Float64Array }) {
        const count = message.pointsM.length / 3;
        queueMicrotask(() => this.listener?.({ data: {
          requestId: message.requestId, activeCells: new Uint32Array(count).fill(1),
          boundsM: new Float64Array([0, 0, 0, .04, .02, .02]), volumeM3: .000016,
        } } as MessageEvent));
      }
      terminate() {}
    }
    vi.stubGlobal("Worker", ClassifierWorker);
    const source = await inputs();
    await expect(produceStructuralVoxelMesh({
      ...producerInput(source), cellSizeM: .0004, rasterizationToleranceM: 1e-7,
    })).rejects.toThrow(/operation budget/i);
  });
  it("rejects missing, stale, wrong-type, wrong-digest, and mismatched exact BREP authority", async () => {
    const input = await inputs();
    const stale = await defineArtifactRecord({
      kind: "brep", sourceRevision: "c".repeat(64),
      producer: { name: "occt-wasm", version: "4.3.2" }, settingsDigest: "b".repeat(64),
      contentDigest: await digestCadOutputPayload(input.brepPayload), units: "m",
      mediaType: "application/vnd.opencascade.brep", dependencies: [],
    });
    const wrongBytes = { bytes: new Uint8Array(input.brepPayload.bytes) };
    wrongBytes.bytes[0] ^= 0xff;
    for (const invalid of [
      { ...producerInput(input), brepArtifact: undefined as never },
      { ...producerInput(input), brepArtifact: stale },
      { ...producerInput(input), brepArtifact: input.semanticArtifact },
      { ...producerInput(input), brepPayload: wrongBytes },
    ]) await expect(produceStructuralVoxelMesh(invalid)).rejects.toThrow();

    const kernel = await OcctKernel.init();
    let cylinderPayload;
    try {
      const shape = kernel.makeCylinder(.01, .04);
      try { cylinderPayload = { bytes: kernel.toBREPBinary(shape) }; }
      finally { kernel.release(shape); }
    } finally { kernel[Symbol.dispose](); }
    const cylinderArtifact = await defineArtifactRecord({
      kind: "brep", sourceRevision: input.document.revision,
      producer: { name: "occt-wasm", version: "4.3.2" }, settingsDigest: "d".repeat(64),
      contentDigest: await digestCadOutputPayload(cylinderPayload), units: "m",
      mediaType: "application/vnd.opencascade.brep", dependencies: [
        { kind: "entity", reference: `document:${input.document.id}` },
        { kind: "entity", reference: "body:bar" },
      ],
    });
    await expect(produceStructuralVoxelMesh({
      ...producerInput(input), brepArtifact: cylinderArtifact, brepPayload: cylinderPayload,
    })).rejects.toThrow(/correspond/i);
    await expect(produceStructuralVoxelMesh({
      ...producerInput(input), bodyIds: ["foreign-body"],
    })).rejects.toThrow(/ownership/i);
  });
  it("rejects same-bounds exact solids with different volume and incomplete provenance", async () => {
    const input = await inputs();
    const incomplete = await defineArtifactRecord({
      ...input.brepArtifact, id: undefined,
      dependencies: [{ kind: "entity", reference: "body:bar" }],
    });
    await expect(produceStructuralVoxelMesh({
      ...producerInput(input), brepArtifact: incomplete,
    })).rejects.toThrow(/provenance/i);

    const kernel = await OcctKernel.init();
    let sparsePayload;
    try {
      const solid = kernel.makeBox(.04, .02, .02);
      const voidAtOrigin = kernel.makeBox(.02, .01, .01);
      const voidTool = kernel.translate(voidAtOrigin, .01, .005, .005);
      const sparse = kernel.cut(solid, voidTool);
      try { sparsePayload = { bytes: kernel.toBREPBinary(sparse) }; }
      finally {
        for (const shape of [sparse, voidTool, voidAtOrigin, solid]) {
          kernel.release(shape);
        }
      }
    } finally { kernel[Symbol.dispose](); }
    const sparseArtifact = await defineArtifactRecord({
      ...input.brepArtifact, id: undefined,
      contentDigest: await digestCadOutputPayload(sparsePayload),
    });
    await expect(produceStructuralVoxelMesh({
      ...producerInput(input), brepArtifact: sparseArtifact, brepPayload: sparsePayload,
    })).rejects.toThrow(/solid|volume|occupancy/i);
  });
  it("rejects a forged canonical artifact identity", async () => {
    const input = await inputs();
    await expect(produceStructuralVoxelMesh({
      ...producerInput(input),
      brepArtifact: { ...input.brepArtifact, id: "f".repeat(64) } as never,
    })).rejects.toThrow();
  });
  it("cancels exact classification and a fresh producer run recovers", async () => {
    const input = await inputs();
    const controller = new AbortController();
    controller.abort();
    await expect(produceStructuralVoxelMesh({
      ...producerInput(input), signal: controller.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
    await expect(produceStructuralVoxelMesh(producerInput(input))).resolves.toMatchObject({
      payload: { dimensions: new Uint32Array([4, 2, 2]) },
    });
  });
});
