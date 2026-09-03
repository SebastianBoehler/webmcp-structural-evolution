import { beforeEach, expect, it, vi } from "vitest";

const viewport = vi.hoisted(() => ({
  capture: vi.fn(async () => new Blob()),
  present: vi.fn<() => Promise<void>>(async () => undefined),
  dispose: vi.fn(),
  focus: vi.fn(),
  setDocument: vi.fn(),
  setGridVisible: vi.fn(),
  onDeviceLost: vi.fn((_listener: (info: { reason: string; message: string }) => void) => vi.fn()),
  setInteractionHandlers: vi.fn(),
  setMeasurements: vi.fn(),
  setMechanismFrame: vi.fn(),
  setReplayScales: vi.fn(),
  setResultLayer: vi.fn(),
  setSectionPlane: vi.fn(),
  setSelection: vi.fn(),
  setTransformOptions: vi.fn(),
  setView: vi.fn(),
}));
const materializer = vi.hoisted(() => ({ materialize: vi.fn(async (parts) => parts) }));

vi.mock("./webgpu-renderer", () => ({
  createSemanticViewport: vi.fn(async () => viewport),
}));
vi.mock("./semantic-model-materializer", () => ({
  materializeSemanticModelParts: materializer.materialize,
}));

import { mountSemanticFieldSession } from "./semantic-field-session";
import type { AssemblyVisualPart } from "./render-envelope";
import { flightFrameAt } from "../simulation/flight-scenarios";

const model = {
  grid: {
    dimensions: { width: 1, height: 1, depth: 1 },
    cellSize: [1, 1, 1],
    anchor: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
  },
  currentInstances: new Uint32Array(),
  alternativeLayers: [],
} as never;

const exactModel = (movable = true) => ({ ...(model as object), assemblyParts: [{ id: "motor-piece",
  selectionId: "motor", label: "Motor", appearance: "component", kind: "mesh",
  center: [0, 0, 0], movable, mesh: { surfaces: [], sizeMm: [1, 1, 1], triangleCount: 1,
    semanticMesh: { positionsM: new Float32Array([0, 0, 0, .001, 0, 0, 0, .001, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]), triangleFaceIndices: new Uint32Array([0]),
      faces: [{ id: "face:source", bodyId: "body:source", signature: { ownerFeatureId: "feature:source",
        kind: "face", geometry: "plane", centroidM: [0, 0, 0], measureSI: 1, adjacentKinds: [] },
        surfaceEvidence: { kind: "plane", normal: [0, 0, 1] } }],
      edgePointsM: new Float32Array([0, 0, 0, .001, 0, 0]),
      edgePointRanges: new Uint32Array([0, 2]), polylineEdgeIndices: new Uint32Array([0]),
      edges: [{ id: "edge:source", bodyId: "body:source", signature: { ownerFeatureId: "feature:source",
        kind: "edge", geometry: "curve", centroidM: [0, 0, 0], measureSI: 1, adjacentKinds: [] } }] } } }] }) as never;

beforeEach(() => {
  Object.values(viewport).forEach((method) => method.mockClear());
  viewport.setDocument.mockReset();
  viewport.capture.mockReset();
  viewport.capture.mockResolvedValue(new Blob());
  viewport.present.mockReset();
  viewport.present.mockResolvedValue(undefined);
  materializer.materialize.mockReset();
  materializer.materialize.mockImplementation(async (parts) => parts);
});

it("forwards transform space and snap without either setter resetting the other", async () => {
  const session = await mountSemanticFieldSession(
    document.createElement("canvas"),
    model,
    "revision:1",
  );
  viewport.setTransformOptions.mockClear();

  session.setTransformSpace("local");
  session.setTranslationSnap(5);
  session.setTransformSpace("world");

  expect(viewport.setTransformOptions.mock.calls).toEqual([
    ["local", null],
    ["local", 5],
    ["world", 5],
  ]);
  session.dispose();
});

it("disposes the acquired viewport when initial semantic document setup fails", async () => {
  viewport.setDocument.mockImplementationOnce(() => {
    throw new Error("unsupported semantic model");
  });

  await expect(mountSemanticFieldSession(
    document.createElement("canvas"), model, "revision:bad",
  )).rejects.toThrow("unsupported semantic model");
  expect(viewport.dispose).toHaveBeenCalledOnce();
});

it("does not resolve mount until the matching initial capture completes", async () => {
  let finish!: () => void;
  viewport.capture.mockReturnValueOnce(new Promise<Blob>((resolve) => {
    finish = () => resolve(new Blob());
  }));
  const mounted = mountSemanticFieldSession(document.createElement("canvas"), model, "revision:pending");
  let resolved = false;
  void mounted.then(() => { resolved = true; });
  await Promise.resolve();
  expect(resolved).toBe(false);
  finish();
  await expect(mounted).resolves.toBeDefined();
});

it("disposes and rejects when the initial capture loses the device", async () => {
  viewport.capture.mockRejectedValueOnce(new Error("device lost during capture"));
  await expect(mountSemanticFieldSession(
    document.createElement("canvas"), model, "revision:lost",
  )).rejects.toThrow("device lost");
  expect(viewport.dispose).toHaveBeenCalledOnce();
});

it("returns update capture completion instead of swallowing asynchronous failure", async () => {
  const session = await mountSemanticFieldSession(document.createElement("canvas"), model, "revision:1");
  viewport.capture.mockRejectedValueOnce(new Error("capture failed"));
  await expect(session.updateModel(model, "revision:2")).rejects.toThrow("capture failed");
  session.dispose();
});

it("reports capture lifecycle with the exact matching revision", async () => {
  const lifecycle = vi.fn();
  const session = await mountSemanticFieldSession(
    document.createElement("canvas"), model, "revision:1", undefined, {}, lifecycle,
  );
  await session.updateModel(model, "revision:2");
  expect(lifecycle.mock.calls.map(([event]) => event)).toEqual([
    { revision: "revision:1", state: "initializing" },
    { revision: "revision:1", state: "ready" },
    { revision: "revision:2", state: "initializing" },
    { revision: "revision:2", state: "ready" },
  ]);
  session.dispose();
});

it("forwards real viewport device loss as a fatal session error", async () => {
  let lose!: (info: { reason: string; message: string }) => void;
  viewport.onDeviceLost.mockImplementationOnce((listener) => { lose = listener; return vi.fn(); });
  const onError = vi.fn();
  const session = await mountSemanticFieldSession(
    document.createElement("canvas"), model, "revision:1", onError,
  );
  lose({ reason: "unknown", message: "adapter reset" });
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/adapter reset/i) }));
  session.dispose();
});

it("round-trips an exact leaf through a controlled legacy callback without losing it", async () => {
  let session!: Awaited<ReturnType<typeof mountSemanticFieldSession>>;
  const onMove = vi.fn(), onSelect = vi.fn((partId: string) => session.setSelectedPart(partId));
  session = await mountSemanticFieldSession(document.createElement("canvas"), exactModel(),
    "selection:1", undefined, { onSelect, onMove });
  const artifact = viewport.setDocument.mock.calls.at(-1)?.[0];
  const face = artifact.nodes.find((node: { kind: string }) => node.kind === "face")!;
  const handlers = viewport.setInteractionHandlers.mock.calls.at(-1)?.[0];

  expect(() => handlers.onSelect(face.id)).not.toThrow();
  expect(onSelect).toHaveBeenCalledWith("motor");
  expect(viewport.setSelection).toHaveBeenLastCalledWith(face.id);
  expect(viewport.setSelection).not.toHaveBeenCalledWith(`component:${face.id}`);
  handlers.onMove("component:motor", [1, 2, 3]);
  expect(onMove).toHaveBeenCalledWith("motor", [1, 2, 3]);

  session.setSelectedPart("motor");
  expect(viewport.setSelection).toHaveBeenLastCalledWith("component:motor");
  session.dispose();
});

it("selects and captures an exact edge without external handlers or movement", async () => {
  const session = await mountSemanticFieldSession(document.createElement("canvas"), exactModel(false),
    "selection:edge");
  const artifact = viewport.setDocument.mock.calls.at(-1)?.[0];
  const edge = artifact.nodes.find((node: { kind: string }) => node.kind === "edge")!;
  const handlers = viewport.setInteractionHandlers.mock.calls.at(-1)?.[0];
  viewport.capture.mockClear();

  handlers.onSelect(edge.id);
  expect(viewport.setSelection).toHaveBeenCalledWith(edge.id);
  expect(viewport.capture).toHaveBeenCalledOnce();
  session.setSelectedPart("motor");
  expect(viewport.setSelection).toHaveBeenLastCalledWith("component:motor");
  session.dispose();
});

it("rebuilds current semantic bounds and captures after an assembly pose update", async () => {
  const session = await mountSemanticFieldSession(document.createElement("canvas"), exactModel(),
    "pose:initial");
  const initialPart = (exactModel() as { assemblyParts: readonly AssemblyVisualPart[] })
    .assemblyParts[0]!;
  viewport.setDocument.mockClear();
  viewport.capture.mockClear();

  session.setAssemblyPartPoses([{ ...initialPart, center: [50, 0, 0] }]);

  const artifact = viewport.setDocument.mock.calls.at(-1)?.[0];
  expect(artifact.nodes.find((node: { id: string }) => node.id === "component:motor")
    ?.transform.position).toEqual([50, 0, 0]);
  expect(viewport.capture).toHaveBeenCalledOnce();
  session.dispose();
});

it("replays the newest authoritative assembly model after a final move rejects", async () => {
  const onMoveError = vi.fn();
  const session = await mountSemanticFieldSession(document.createElement("canvas"), exactModel(),
    "pose:initial", undefined, { onMoveError });
  const handlers = viewport.setInteractionHandlers.mock.calls.at(-1)?.[0];
  const initialPart = (exactModel() as { assemblyParts: readonly AssemblyVisualPart[] })
    .assemblyParts[0]!;
  await session.updateModel({ ...(exactModel() as object),
    assemblyParts: [{ ...initialPart, center: [50, 0, 0] }] } as never, "pose:concurrent");
  viewport.setDocument.mockClear();
  viewport.capture.mockClear();
  const error = new Error("Assembly action parent revision is stale");

  await handlers.onMoveError(error);

  const artifact = viewport.setDocument.mock.calls.at(-1)?.[0];
  expect(artifact.revision).toBe("pose:concurrent");
  expect(artifact.nodes.find((node: { id: string }) => node.id === "component:motor")
    ?.transform.position).toEqual([50, 0, 0]);
  expect(viewport.capture).toHaveBeenCalledOnce();
  expect(onMoveError).toHaveBeenCalledWith(error);
  session.dispose();
});

it("clears the mechanism layer and captures the baseline assembly pose when replay pauses", async () => {
  const session = await mountSemanticFieldSession(document.createElement("canvas"), exactModel(),
    "replay:baseline");
  viewport.setMechanismFrame.mockClear();
  viewport.capture.mockClear();
  const frame = flightFrameAt("roll", 0.25, [
    { id: "east", centerM: [0.105, 0, 0] }, { id: "north", centerM: [0, 0.105, 0] },
    { id: "west", centerM: [-0.105, 0, 0] }, { id: "south", centerM: [0, -0.105, 0] },
  ], 0.515);

  session.setFlightFrame(frame);
  session.setFlightFrame(undefined);

  expect(viewport.setMechanismFrame.mock.calls).toEqual([
    [{ componentId: "assembly:design", transform: expect.any(Array) }],
    [undefined],
  ]);
  expect(viewport.present).toHaveBeenCalledOnce();
  expect(viewport.capture).not.toHaveBeenCalled();
  session.dispose();
});

it("publishes a case once and updates only replay scales on subsequent frames", async () => {
  const envelope = new Float32Array([40]);
  const roll = new Float32Array([12]);
  const vectors = new Float32Array([1, -2, 3]);
  const replayModel = { ...(model as object), currentInstances: new Uint32Array([0]),
    densityField: new Float32Array([1]), analysisField: { kind: "stress", values: envelope,
      maximum: 40, cases: { "roll-differential": { values: roll, maximum: 40,
        deformation: { values: new Float32Array([4]), vectors, maximum: 4,
          displacementUnit: "mm", sourceDisplacementUnit: "m" } } } },
    assemblyParts: [{ id: "east-load-vector", selectionId: "east", label: "load",
      appearance: "generated", kind: "load-vector", center: [0, 0, 0], forceN: [0, 0, -18], length: 1 }] } as never;
  const session = await mountSemanticFieldSession(document.createElement("canvas"), replayModel, "replay:case");
  viewport.setResultLayer.mockClear();
  const frame = flightFrameAt("roll", 0.25, [
    { id: "east", centerM: [0.105, 0, 0] }, { id: "north", centerM: [0, 0.105, 0] },
    { id: "west", centerM: [-0.105, 0, 0] }, { id: "south", centerM: [0, -0.105, 0] },
  ], 0.515);

  session.setFlightFrame(frame);
  session.setFlightFrame({ ...frame, timeS: 0.5 });
  expect(viewport.setResultLayer.mock.calls.filter(([layer, payload]) => layer === "stress" && payload))
    .toHaveLength(1);
  expect(viewport.setResultLayer).toHaveBeenCalledWith("displacement", expect.objectContaining({
    vectors, deformationScale: expect.any(Number),
  }));
  expect(viewport.setReplayScales).toHaveBeenCalledWith(expect.any(Number), expect.any(Number));
  expect(viewport.present).toHaveBeenCalled();
  session.setFlightFrame(undefined);
  expect(viewport.setResultLayer).toHaveBeenLastCalledWith("stress",
    expect.objectContaining({ values: envelope }));
  session.dispose();
});

it("coalesces replay presentation while keeping the newest state", async () => {
  let release!: () => void;
  viewport.present.mockReturnValueOnce(new Promise<void>((resolve) => { release = resolve; }));
  const replayModel = { ...(model as object), assemblyParts: [{ id: "east-load-vector",
    selectionId: "east", label: "load", appearance: "generated", kind: "load-vector",
    center: [0, 0, 0], forceN: [0, 0, -18], length: 1 }] } as never;
  const session = await mountSemanticFieldSession(document.createElement("canvas"), replayModel, "replay:coalesce");
  const frame = flightFrameAt("roll", 0.25, [
    { id: "east", centerM: [0.105, 0, 0] }, { id: "north", centerM: [0, 0.105, 0] },
    { id: "west", centerM: [-0.105, 0, 0] }, { id: "south", centerM: [0, -0.105, 0] },
  ], 0.515);

  session.setFlightFrame(frame);
  session.setFlightFrame({ ...frame, timeS: .5 });
  session.setFlightFrame({ ...frame, timeS: .75 });
  expect(viewport.present).toHaveBeenCalledOnce();
  release();
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(viewport.present).toHaveBeenCalledTimes(2);
  session.dispose();
});

it("publishes only the newest revision when model materialization completes out of order", async () => {
  const materialized = (id: string) => [{ id, selectionId: id, label: id, appearance: "component",
    kind: "mesh" as const, center: [0, 0, 0], mesh: { surfaces: [{ name: id,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]) }],
      sizeMm: [1, 1, 0] as const, triangleCount: 1 } }];
  const deferred = new Map<string, (parts: ReturnType<typeof materialized>) => void>();
  materializer.materialize.mockImplementation((parts) => {
    const id = parts[0]?.id;
    if (!id) return Promise.resolve(parts);
    return new Promise((resolve) => deferred.set(id, resolve));
  });
  const lifecycle = vi.fn();
  const session = await mountSemanticFieldSession(document.createElement("canvas"), model, "initial", undefined, {}, lifecycle);
  viewport.setDocument.mockClear();
  viewport.capture.mockClear();
  lifecycle.mockClear();
  const old = session.updateModel({ ...(model as object), assemblyParts: [{ id: "old", selectionId: "old", label: "old",
    appearance: "component", kind: "model", center: [0, 0, 0], assetUrl: "/old.glb", assetUnits: "m", size: [1, 1, 1] }] } as never, "old");
  const newest = session.updateModel({ ...(model as object), assemblyParts: [{ id: "new", selectionId: "new", label: "new",
    appearance: "component", kind: "model", center: [0, 0, 0], assetUrl: "/new.glb", assetUnits: "m", size: [1, 1, 1] }] } as never, "new");

  deferred.get("new")!(materialized("new"));
  await newest;
  deferred.get("old")!(materialized("old"));
  await old;

  expect(viewport.setDocument.mock.calls).toHaveLength(1);
  expect(viewport.setDocument.mock.calls[0]?.[0].revision).toBe("new");
  expect(viewport.capture).toHaveBeenCalledOnce();
  expect(lifecycle.mock.calls.map(([event]) => event)).toEqual([
    { revision: "new", state: "initializing" }, { revision: "new", state: "ready" },
  ]);
  session.dispose();
});
