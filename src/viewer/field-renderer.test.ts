import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { extractAlternativeLayers } from "./alternative-instances";
import { mountFieldRenderer } from "./field-renderer";
import { visibleInstances } from "./field-instances";
import {
  alternative,
  current,
  harness,
  region,
  renderedMeshes,
} from "./field-viewer-test-support";
import type { VoxelGrid } from "./field-instances";

function model() {
  if (current.result.status !== "verified") throw new Error("fixture must be verified");
  return {
    grid: current.grid,
    currentInstances: visibleInstances(current.result.output, current.grid, 0.5),
    alternativeLayers: extractAlternativeLayers(
      current,
      [alternative],
      region,
      0.5,
      "overlay",
    ).layers,
  };
}

describe("mountFieldRenderer", () => {
  it("observes physical pixels explicitly and separates actual DPR from render DPR", () => {
    const test = harness({ dpr: 3 });
    const canvas = document.createElement("canvas");
    const session = mountFieldRenderer(canvas, model(), test.environment);

    expect(test.observe).toHaveBeenCalledWith(canvas, { box: "device-pixel-content-box" });
    test.emitResize({
      devicePixelContentBoxSize: [{ inlineSize: 900, blockSize: 450 }],
      contentRect: { width: 280, height: 140 },
    });
    expect(test.renderer.setPixelRatio).toHaveBeenLastCalledWith(2);
    expect(test.renderer.setSize).toHaveBeenLastCalledWith(300, 150, false);
    session.dispose();
  });

  it("falls back explicitly when device-pixel observation options are unsupported", () => {
    const test = harness({ rejectDevicePixelObserve: true });
    const session = mountFieldRenderer(document.createElement("canvas"), model(), test.environment);

    expect(test.observe).toHaveBeenCalledTimes(2);
    expect(test.observe.mock.calls[1]?.[1]).toBeUndefined();
    session.dispose();
  });

  it("uses the content rectangle when the browser reports an invalid DPR", () => {
    const test = harness({ dpr: Number.NaN });
    const session = mountFieldRenderer(document.createElement("canvas"), model(), test.environment);

    test.emitResize({
      devicePixelContentBoxSize: [{ inlineSize: 900, blockSize: 450 }],
      contentRect: { width: 300, height: 150 },
    });
    expect(test.renderer.setPixelRatio).toHaveBeenLastCalledWith(1);
    expect(test.renderer.setSize).toHaveBeenLastCalledWith(300, 150, false);
    session.dispose();
  });

  it("releases partial ownership when controls or later observer setup fails", () => {
    const controlsFailure = harness({ controlsFailure: new Error("controls failed") });
    expect(() =>
      mountFieldRenderer(document.createElement("canvas"), model(), controlsFailure.environment),
    ).toThrow(/controls failed/i);
    expect(controlsFailure.renderer.dispose).toHaveBeenCalledOnce();

    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const materialDispose = vi.spyOn(THREE.Material.prototype, "dispose");
    const meshDispose = vi.spyOn(THREE.InstancedMesh.prototype, "dispose");
    const observerFailure = harness({ observerFailure: new Error("observer failed") });
    expect(() =>
      mountFieldRenderer(document.createElement("canvas"), model(), observerFailure.environment),
    ).toThrow(/observer failed/i);
    expect(observerFailure.controls.dispose).toHaveBeenCalledOnce();
    expect(observerFailure.renderer.dispose).toHaveBeenCalledOnce();
    expect(meshDispose).toHaveBeenCalledTimes(2);
    expect(geometryDispose.mock.calls.length).toBeGreaterThan(2);
    expect(materialDispose.mock.calls.length).toBeGreaterThan(2);

    const frameFailure = harness({ frameFailure: new Error("frame failed") });
    expect(() =>
      mountFieldRenderer(document.createElement("canvas"), model(), frameFailure.environment),
    ).toThrow(/frame failed/i);
    expect(frameFailure.disconnect).toHaveBeenCalledOnce();
    expect(frameFailure.controls.dispose).toHaveBeenCalledOnce();
    expect(frameFailure.renderer.dispose).toHaveBeenCalledOnce();
  });

  it("makes disposal idempotent and ignores late observer, control, and RAF callbacks", () => {
    const test = harness();
    const session = mountFieldRenderer(document.createElement("canvas"), model(), test.environment);

    session.dispose();
    session.dispose();
    test.emitResize({ contentRect: { width: 320, height: 180 } });
    test.emitControlChange();
    test.flushFrame();

    expect(test.renderer.dispose).toHaveBeenCalledOnce();
    expect(test.controls.dispose).toHaveBeenCalledOnce();
    expect(test.environment.requestFrame).toHaveBeenCalledTimes(1);
    expect(test.renderer.render).not.toHaveBeenCalled();
  });

  it("retries only the transiently failed RAF owner and keeps callbacks inactive", () => {
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const materialDispose = vi.spyOn(THREE.Material.prototype, "dispose");
    const meshDispose = vi.spyOn(THREE.InstancedMesh.prototype, "dispose");
    const test = harness();
    test.cancelFrame.mockImplementationOnce(() => {
      throw new Error("cancel failed once");
    });
    const session = mountFieldRenderer(document.createElement("canvas"), model(), test.environment);

    expect(() => session.dispose()).not.toThrow();
    test.emitResize({ contentRect: { width: 320, height: 180 } });
    test.emitControlChange();

    expect(test.environment.requestFrame).toHaveBeenCalledOnce();
    expect(test.renderer.render).not.toHaveBeenCalled();
    expect(test.cancelFrame).toHaveBeenCalledOnce();
    expect(test.disconnect).toHaveBeenCalledOnce();
    expect(test.controls.dispose).toHaveBeenCalledOnce();
    expect(meshDispose).toHaveBeenCalledTimes(2);
    const disposedGeometry = geometryDispose.mock.calls.length;
    const disposedMaterials = materialDispose.mock.calls.length;
    expect(disposedGeometry).toBeGreaterThan(2);
    expect(disposedMaterials).toBeGreaterThan(2);
    expect(test.renderer.dispose).toHaveBeenCalledOnce();

    session.dispose();
    expect(test.cancelFrame).toHaveBeenCalledTimes(2);
    expect(test.disconnect).toHaveBeenCalledOnce();
    expect(test.controls.dispose).toHaveBeenCalledOnce();
    expect(meshDispose).toHaveBeenCalledTimes(2);
    expect(geometryDispose).toHaveBeenCalledTimes(disposedGeometry);
    expect(materialDispose).toHaveBeenCalledTimes(disposedMaterials);
    expect(test.renderer.dispose).toHaveBeenCalledOnce();

    session.dispose();
    expect(test.cancelFrame).toHaveBeenCalledTimes(2);
    expect(test.disconnect).toHaveBeenCalledOnce();
    expect(test.controls.dispose).toHaveBeenCalledOnce();
    expect(meshDispose).toHaveBeenCalledTimes(2);
    expect(geometryDispose).toHaveBeenCalledTimes(disposedGeometry);
    expect(materialDispose).toHaveBeenCalledTimes(disposedMaterials);
    expect(test.renderer.dispose).toHaveBeenCalledOnce();
  });

  it("retries only a transiently failed material owner", () => {
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const materialDispose = vi.spyOn(THREE.Material.prototype, "dispose");
    const meshDispose = vi.spyOn(THREE.InstancedMesh.prototype, "dispose");
    materialDispose.mockImplementationOnce(() => {
      throw new Error("material failed once");
    });
    const test = harness();
    const session = mountFieldRenderer(document.createElement("canvas"), model(), test.environment);

    session.dispose();
    const initialMaterialCalls = materialDispose.mock.calls.length;
    const initialGeometryCalls = geometryDispose.mock.calls.length;
    expect(initialMaterialCalls).toBeGreaterThan(2);
    expect(initialGeometryCalls).toBeGreaterThan(2);
    expect(meshDispose).toHaveBeenCalledTimes(2);
    expect(test.disconnect).toHaveBeenCalledOnce();
    expect(test.controls.dispose).toHaveBeenCalledOnce();
    expect(test.renderer.dispose).toHaveBeenCalledOnce();

    session.dispose();
    expect(materialDispose).toHaveBeenCalledTimes(initialMaterialCalls + 1);
    expect(geometryDispose).toHaveBeenCalledTimes(initialGeometryCalls);
    expect(meshDispose).toHaveBeenCalledTimes(2);
    expect(test.disconnect).toHaveBeenCalledOnce();
    expect(test.controls.dispose).toHaveBeenCalledOnce();
    expect(test.renderer.dispose).toHaveBeenCalledOnce();

    session.dispose();
    expect(materialDispose).toHaveBeenCalledTimes(initialMaterialCalls + 1);
    expect(geometryDispose).toHaveBeenCalledTimes(initialGeometryCalls);
    expect(meshDispose).toHaveBeenCalledTimes(2);
    expect(test.disconnect).toHaveBeenCalledOnce();
    expect(test.controls.dispose).toHaveBeenCalledOnce();
    expect(test.renderer.dispose).toHaveBeenCalledOnce();
  });

  it("rejects non-f32 geometry before allocating a renderer", () => {
    const oversizedGrid = {
      ...model(),
      grid: {
        ...current.grid,
        cellSize: [1e100, 1, 1] as const,
      },
      currentInstances: new Uint32Array(),
      alternativeLayers: [],
    };
    const oversizedPeel = {
      ...model(),
      alternativeLayers: model().alternativeLayers.map((layer) => ({
        ...layer,
        displayOffset: [1e100, 0, 0] as const,
      })),
    };

    for (const invalidModel of [oversizedGrid, oversizedPeel]) {
      const test = harness();
      expect(() =>
        mountFieldRenderer(document.createElement("canvas"), invalidModel, test.environment),
      ).toThrow(/f32/i);
      expect(test.environment.createRenderer).not.toHaveBeenCalled();
    }
  });

  it.each([
    [
      "scaled voxel corner",
      {
        dimensions: { width: 1, height: 1, depth: 1 },
        cellSize: [1e37, 1, 1],
        anchor: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
      },
      [3.36e38, 0, 0],
    ],
    [
      "near-unit quaternion transform",
      {
        dimensions: { width: 1, height: 1, depth: 1 },
        cellSize: [1, 1, 1],
        anchor: {
          position: [0, 0, 0],
          orientation: [0.707113145, 0.707113145, 0, 0],
        },
      },
      [3.4028e38, 0, 0],
    ],
  ])("rejects a %s outside the assembly world envelope before allocation", (_name, grid, position) => {
    const test = harness();

    expect(() =>
      mountFieldRenderer(
        document.createElement("canvas"),
        {
          grid: {
            ...grid,
            anchor: { ...grid.anchor, position },
          } as unknown as VoxelGrid,
          currentInstances: new Uint32Array([0]),
          alternativeLayers: [],
        },
        test.environment,
      ),
    ).toThrow(/world envelope|finite f32/i);
    expect(test.environment.createRenderer).not.toHaveBeenCalled();
  });

  it("normalizes a copied near-unit anchor and renders an engineering-scale fixture", () => {
    const orientation = [0.707113145, 0.707113145, 0, 0] as const;
    const sourceGrid: VoxelGrid = {
      ...current.grid,
      anchor: { ...current.grid.anchor, orientation },
    };
    const test = harness();
    const session = mountFieldRenderer(
      document.createElement("canvas"),
      { ...model(), grid: sourceGrid, alternativeLayers: [] },
      test.environment,
    );

    const [mesh] = renderedMeshes(test);
    expect(mesh?.quaternion.length()).toBeCloseTo(1, 12);
    expect(sourceGrid.anchor.orientation).toEqual(orientation);
    session.dispose();
  });
});
