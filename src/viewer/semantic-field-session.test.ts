import { beforeEach, expect, it, vi } from "vitest";

const viewport = vi.hoisted(() => ({
  capture: vi.fn(async () => new Blob()),
  dispose: vi.fn(),
  focus: vi.fn(),
  setDocument: vi.fn(),
  setGridVisible: vi.fn(),
  onDeviceLost: vi.fn((_listener: (info: { reason: string; message: string }) => void) => vi.fn()),
  setInteractionHandlers: vi.fn(),
  setMeasurements: vi.fn(),
  setMechanismFrame: vi.fn(),
  setResultLayer: vi.fn(),
  setSectionPlane: vi.fn(),
  setSelection: vi.fn(),
  setTransformOptions: vi.fn(),
  setView: vi.fn(),
}));

vi.mock("./webgpu-renderer", () => ({
  createSemanticViewport: vi.fn(async () => viewport),
}));

import { mountSemanticFieldSession } from "./semantic-field-session";
import type { AssemblyVisualPart } from "./render-envelope";

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
