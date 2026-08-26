import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { extractAlternativeLayers } from "./alternative-instances";
import { mountFieldRenderer } from "./field-renderer";
import { visibleInstances } from "./field-instances";
import {
  alternative,
  current,
  harness,
  region,
} from "./field-viewer-test-support";

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

describe("failed field renderer mounts", () => {
  afterEach(() => vi.restoreAllMocks());

  it("retains partial mesh ownership and retries only a transient cleanup failure", () => {
    vi.spyOn(THREE.InstancedMesh.prototype, "setMatrixAt").mockImplementationOnce(() => {
      throw new Error("mesh construction failed");
    });
    const sceneRemove = vi.spyOn(THREE.Object3D.prototype, "remove");
    const meshDispose = vi.spyOn(THREE.InstancedMesh.prototype, "dispose");
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const materialDispose = vi.spyOn(THREE.Material.prototype, "dispose");
    materialDispose.mockImplementationOnce(() => {
      throw new Error("material cleanup failed once");
    });
    const test = harness();
    let failure: unknown;

    try {
      mountFieldRenderer(document.createElement("canvas"), model(), test.environment);
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({
      name: "FieldRendererMountError",
      cleanupSession: { dispose: expect.any(Function) },
    });
    expect(sceneRemove).toHaveBeenCalledTimes(2);
    expect(meshDispose).not.toHaveBeenCalled();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(materialDispose).toHaveBeenCalledOnce();
    expect(test.controls.dispose).toHaveBeenCalledOnce();
    expect(test.renderer.dispose).toHaveBeenCalledOnce();

    const cleanupSession = (failure as { cleanupSession: { dispose(): void } }).cleanupSession;
    cleanupSession.dispose();
    expect(materialDispose).toHaveBeenCalledTimes(2);
    expect(sceneRemove).toHaveBeenCalledTimes(2);
    expect(meshDispose).not.toHaveBeenCalled();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(test.controls.dispose).toHaveBeenCalledOnce();
    expect(test.renderer.dispose).toHaveBeenCalledOnce();

    cleanupSession.dispose();
    expect(materialDispose).toHaveBeenCalledTimes(2);
    expect(sceneRemove).toHaveBeenCalledTimes(2);
    expect(meshDispose).not.toHaveBeenCalled();
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(test.controls.dispose).toHaveBeenCalledOnce();
    expect(test.renderer.dispose).toHaveBeenCalledOnce();
  });
});
