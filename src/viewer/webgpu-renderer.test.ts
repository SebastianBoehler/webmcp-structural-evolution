import { describe, expect, it, vi } from "vitest";
import { createSemanticViewport, renderEnvelope, type SemanticViewportEnvironment } from "./webgpu-renderer";

const documentArtifact = Object.freeze({
  revision: "rev-1",
  frame: { lengthUnit: "mm", angleUnit: "radian" },
  nodes: [
    { id: "assembly:airframe", kind: "assembly" },
    { id: "component:arm", parentId: "assembly:airframe", kind: "component" },
    { id: "body:arm", parentId: "component:arm", kind: "body" },
    { id: "feature:fillet", parentId: "body:arm", kind: "feature" },
    { id: "face:top", parentId: "feature:fillet", kind: "face" },
  ],
} as const);

interface TestEnvironment extends SemanticViewportEnvironment {
  readonly loseDevice: (info: { reason: string; message: string }) => void;
  readonly renderer: { readonly render: ReturnType<typeof vi.fn>; readonly present: ReturnType<typeof vi.fn>;
    readonly dispose: ReturnType<typeof vi.fn>; readonly onDeviceLost: ReturnType<typeof vi.fn> };
  readonly destroy: ReturnType<typeof vi.fn>;
}

function environment(): TestEnvironment {
  let loseDevice!: (info: { reason: string; message: string }) => void;
  const lost = new Promise<{ reason: string; message: string }>((resolve) => { loseDevice = resolve; });
  const renderer = {
    render: vi.fn(async () => new Blob(["capture"], { type: "image/png" })),
    present: vi.fn(async () => undefined),
    dispose: vi.fn(), onDeviceLost: vi.fn(),
  };
  const destroy = vi.fn();
  return {
    acquireDevice: vi.fn(async () => ({ label: "authoritative-device", lost, destroy })),
    createRenderer: vi.fn(async () => renderer),
    createFallbackRenderer: vi.fn(() => { throw new Error("WebGL fallback must not run"); }),
    loseDevice,
    renderer,
    destroy,
  };
}

describe("createSemanticViewport", () => {
  it("rejects missing or mixed semantic frame units at the viewport boundary", async () => {
    const runtime = environment();
    const viewport = await createSemanticViewport(document.createElement("canvas"), runtime);

    expect(() => viewport.setDocument({
      revision: "missing-units", nodes: [{ id: "assembly:test", kind: "assembly" }],
    } as never)).toThrow("semantic frame");
    expect(() => viewport.setDocument({
      revision: "mixed-units", frame: { lengthUnit: "m", angleUnit: "radian" },
      nodes: [{ id: "assembly:test", kind: "assembly" }],
    } as never)).toThrow("semantic frame");
    viewport.dispose();
  });

  it("fits a nonzero semantic envelope around small meter-scale and larger millimetre-scale artifacts", () => {
    expect(renderEnvelope([0, 0, 0], [.02, .01, .01])).toEqual({ target: [.01, .005, .005], span: expect.any(Number) });
    expect(renderEnvelope([-500, -200, -100], [500, 200, 100]).span).toBeGreaterThan(1_000);
  });

  it("acquires one WebGPU renderer only after a device, renders immutable artifacts, and disposes after device loss", async () => {
    const runtime = environment();
    const viewport = await createSemanticViewport(document.createElement("canvas"), runtime);
    const snapshot = structuredClone(documentArtifact);

    expect(runtime.acquireDevice).toHaveBeenCalledOnce();
    expect(runtime.createRenderer).toHaveBeenCalledWith(expect.objectContaining({ label: "authoritative-device" }), expect.any(HTMLCanvasElement));
    expect(runtime.createFallbackRenderer).not.toHaveBeenCalled();
    viewport.setDocument(documentArtifact);
    viewport.setSelection("face:top");
    viewport.setResultLayer("stress", { values: new Float32Array([10]), maximum: 10,
      dimensions: [1, 1, 1], cellSize: [1, 1, 1], origin: [0, 0, 0], active: new Uint8Array([1]) });
    viewport.setMechanismFrame({ componentId: "component:arm", transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 5, 6, 1] });
    viewport.setSectionPlane({ normal: [0, 0, 1], constant: 2 });
    viewport.setMeasurements([{ from: [0, 0, 0], to: [3, 4, 0] }]);
    await expect(viewport.capture()).resolves.toMatchObject({ type: "image/png" });
    expect(runtime.renderer.render).toHaveBeenCalledWith(expect.objectContaining({
      revision: "rev-1", selection: "face:top", resultLayers: expect.objectContaining({ stress: expect.any(Object) }),
      sectionPlane: { normal: [0, 0, 1], constant: 2 }, measurements: [{ from: [0, 0, 0], to: [3, 4, 0] }],
    }));
    await viewport.present();
    expect(runtime.renderer.present).toHaveBeenCalledWith(expect.objectContaining({
      revision: "rev-1", selection: "face:top",
    }));
    viewport.setDocument({ ...documentArtifact, revision: "rev-2" });
    await viewport.capture();
    expect(runtime.renderer.render).toHaveBeenLastCalledWith(expect.objectContaining({ revision: "rev-2", selection: "face:top" }));
    viewport.setDocument({
      ...documentArtifact, revision: "rev-3",
      nodes: documentArtifact.nodes.map((node) => node.id === "face:top" ? { ...node, id: "face:repaired" } : node),
      selectionRepairs: { "face:top": "face:repaired" },
    });
    await viewport.capture();
    expect(runtime.renderer.render).toHaveBeenLastCalledWith(expect.objectContaining({ revision: "rev-3", selection: "face:repaired" }));
    expect(documentArtifact).toStrictEqual(snapshot);
    expect(runtime.createRenderer).toHaveBeenCalledOnce();

    const onLoss = vi.fn();
    viewport.onDeviceLost(onLoss);
    runtime.loseDevice({ reason: "unknown", message: "test loss" });
    await Promise.resolve();
    expect(onLoss).toHaveBeenCalledWith(expect.objectContaining({ message: "test loss" }));
    expect(runtime.renderer.onDeviceLost).toHaveBeenCalledWith(expect.objectContaining({ message: "test loss" }));
    expect(runtime.renderer.dispose).toHaveBeenCalledOnce();
    expect(runtime.destroy).toHaveBeenCalledOnce();
    viewport.dispose();
    expect(runtime.renderer.dispose).toHaveBeenCalledOnce();
  });

  it("rejects an aborted capture without replacing the renderer", async () => {
    const runtime = environment();
    const viewport = await createSemanticViewport(document.createElement("canvas"), runtime);
    const abort = new AbortController();
    abort.abort();

    await expect(viewport.capture(abort.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(runtime.renderer.render).not.toHaveBeenCalled();
    expect(runtime.createRenderer).toHaveBeenCalledOnce();
    viewport.dispose();
  });

  it("surfaces backend initialization failure and never constructs a fallback renderer", async () => {
    const runtime = environment();
    vi.mocked(runtime.createRenderer).mockRejectedValueOnce(new Error("WebGPU backend unavailable"));

    await expect(createSemanticViewport(document.createElement("canvas"), runtime))
      .rejects.toThrow("WebGPU backend unavailable");
    expect(runtime.createFallbackRenderer).not.toHaveBeenCalled();
    expect(runtime.destroy).toHaveBeenCalledOnce();
  });

  it("fails closed when selection names no semantic node", async () => {
    const runtime = environment();
    const viewport = await createSemanticViewport(document.createElement("canvas"), runtime);
    viewport.setDocument(documentArtifact);

    expect(() => viewport.setSelection("face:unknown")).toThrow("unknown semantic selection");
    expect(runtime.renderer.render).not.toHaveBeenCalled();
    viewport.dispose();
  });

  it("forwards semantic pick handlers to the live renderer boundary", async () => {
    const runtime = environment();
    const setInteractionHandlers = vi.fn();
    Object.assign(runtime.renderer, { setInteractionHandlers });
    const viewport = await createSemanticViewport(document.createElement("canvas"), runtime);
    const onSelect = vi.fn();

    viewport.setInteractionHandlers({ onSelect });
    expect(setInteractionHandlers).toHaveBeenCalledWith({ onSelect });
    viewport.dispose();
  });
});
