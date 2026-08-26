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
    expect(geometryDispose).toHaveBeenCalledTimes(2);
    expect(materialDispose).toHaveBeenCalledTimes(2);

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
});
