import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { createWebGpuTransformDrag } from "./webgpu-transform-drag";

const down = (x: number, y: number, z = 10) => new THREE.Ray(
  new THREE.Vector3(x, y, z),
  new THREE.Vector3(0, 0, -1),
);

function harness(enabled = true) {
  let orbitEnabled = enabled;
  const onMove = vi.fn();
  const onPreview = vi.fn();
  const onDragState = vi.fn();
  const drag = createWebGpuTransformDrag({
    orbitEnabled: () => orbitEnabled,
    setOrbitEnabled: (next) => { orbitEnabled = next; },
    onMove,
    onPreview,
    onMoveError: vi.fn(),
    onDragState,
  });
  return { drag, onMove, onPreview, onDragState, orbitEnabled: () => orbitEnabled };
}

describe("WebGPU semantic transform drag", () => {
  it("snaps displacement along only the selected world axis and emits one paired lifecycle", () => {
    const object = new THREE.Group();
    object.position.set(1, 2, 3);
    object.updateMatrixWorld(true);
    const test = harness();
    test.drag.setOptions("world", .5);

    expect(test.drag.begin("component:arm", object, "x", down(1, 2))).toBe(true);
    expect(test.orbitEnabled()).toBe(false);
    test.drag.move(down(2.24, 3.26));
    expect(object.position.toArray()).toEqual([2, 2, 3]);
    expect(test.onMove).not.toHaveBeenCalled();
    expect(test.onPreview).toHaveBeenCalledOnce();
    test.drag.end();
    test.drag.end();

    expect(test.onMove).toHaveBeenCalledOnce();
    expect(test.onMove).toHaveBeenLastCalledWith("component:arm", [2, 2, 3]);
    expect(test.orbitEnabled()).toBe(true);
    expect(test.onDragState.mock.calls).toEqual([
      [true, "component:arm"],
      [false, "component:arm"],
    ]);
  });

  it("rotates a selected local axis into world space and snaps only along it", () => {
    const object = new THREE.Group();
    object.rotation.z = Math.PI / 2;
    object.updateMatrixWorld(true);
    const test = harness(false);
    test.drag.setOptions("local", 1);
    expect(test.drag.begin("component:joint", object, "x", down(0, 0))).toBe(true);
    test.drag.move(down(4, 1.2));
    test.drag.end();
    const position = test.onMove.mock.lastCall?.[1] as readonly number[];
    expect(position[0]).toBeCloseTo(0);
    expect(position[1]).toBeCloseTo(1);
    expect(position[2]).toBeCloseTo(0);
    expect(test.orbitEnabled()).toBe(false);
  });

  it("rotates snapped local-axis deltas back into world position", () => {
    const object = new THREE.Group();
    object.position.set(10, 0, 0);
    object.rotation.z = Math.PI / 4;
    object.updateMatrixWorld(true);
    const test = harness();
    test.drag.setOptions("local", 1);

    test.drag.begin("component:plate", object, "x", down(10, 0));
    test.drag.move(down(10 + .9, .9));
    test.drag.end();
    const position = test.onMove.mock.lastCall?.[1] as readonly number[];
    expect(position[0]).toBeCloseTo(10 + Math.SQRT1_2);
    expect(position[1]).toBeCloseTo(Math.SQRT1_2);
    expect(position[2]).toBeCloseTo(0);
  });

  it("commits only the final continuous position and reports a rejected commit", async () => {
    const object = new THREE.Group();
    object.position.set(1, 2, 3);
    object.updateMatrixWorld(true);
    const error = new Error("stale final layout");
    const rejected = Promise.reject(error);
    void rejected.catch(() => undefined);
    const onMove = vi.fn(() => rejected);
    const onPreview = vi.fn();
    const onMoveError = vi.fn();
    const drag = createWebGpuTransformDrag({
      orbitEnabled: () => true,
      setOrbitEnabled: vi.fn(),
      onMove,
      onPreview,
      onMoveError,
      onDragState: vi.fn(),
    });
    drag.setOptions("world", 0.5);

    drag.begin("component:arm", object, "x", down(1, 2));
    drag.move(down(1.74, 2));
    drag.move(down(2.74, 2));
    expect(onMove).not.toHaveBeenCalled();
    drag.end();
    await Promise.resolve();
    await Promise.resolve();

    expect(onMove).toHaveBeenCalledOnce();
    expect(onMove).toHaveBeenCalledWith("component:arm", [2.5, 2, 3]);
    expect(onPreview).toHaveBeenCalledTimes(2);
    expect(onMoveError).toHaveBeenCalledWith(error);
  });

  it("rejects a ray parallel to the selected axis without changing orbit state", () => {
    const object = new THREE.Group();
    object.updateMatrixWorld(true);
    const test = harness();

    expect(test.drag.begin("component:shaft", object, "z", down(0, 0))).toBe(false);
    expect(test.orbitEnabled()).toBe(true);
    expect(test.onDragState).not.toHaveBeenCalled();
  });
});
