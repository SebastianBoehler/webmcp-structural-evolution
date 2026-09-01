import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { describe, expect, it, vi } from "vitest";

import { createWebGpuCameraControls } from "./webgpu-camera-controls";

function sizedCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  Object.defineProperties(canvas, {
    clientWidth: { value: 200 },
    clientHeight: { value: 100 },
  });
  canvas.getBoundingClientRect = () => ({
    bottom: 100, height: 100, left: 0, right: 200, top: 0, width: 200,
    x: 0, y: 0, toJSON: () => ({}),
  });
  return canvas;
}

const envelope = { target: [1, 2, 3] as const, span: 10 };
const bounds = new THREE.Box3(
  new THREE.Vector3(-4, -3, -2).add(new THREE.Vector3(...envelope.target)),
  new THREE.Vector3(4, 3, 2).add(new THREE.Vector3(...envelope.target)),
);

function corners(box: THREE.Box3): readonly THREE.Vector3[] {
  return [box.min.x, box.max.x].flatMap((x) => [box.min.y, box.max.y].flatMap((y) =>
    [box.min.z, box.max.z].map((z) => new THREE.Vector3(x, y, z))));
}

function expectInsideSafeFrustum(camera: THREE.PerspectiveCamera, box: THREE.Box3) {
  camera.updateMatrixWorld(true);
  for (const corner of corners(box)) {
    const view = corner.clone().applyMatrix4(camera.matrixWorldInverse);
    const projected = corner.clone().project(camera);
    expect(view.z).toBeLessThan(-camera.near);
    expect(Math.abs(projected.x)).toBeLessThanOrEqual(.9);
    expect(Math.abs(projected.y)).toBeLessThanOrEqual(.9);
    expect(projected.z).toBeGreaterThanOrEqual(-1);
    expect(projected.z).toBeLessThanOrEqual(1);
  }
}

describe("WebGPU camera controls", () => {
  it("preserves an orbit camera across ordinary frames until a preset is requested", () => {
    const camera = new THREE.PerspectiveCamera(38, 2, .1, 1_000);
    const navigation = createWebGpuCameraControls(
      OrbitControls,
      camera,
      sizedCanvas(),
      vi.fn(),
    );

    navigation.frame(bounds, envelope.target, 2);
    const target = new THREE.Vector3(...envelope.target);
    expect(camera.position.distanceTo(target)).toBeGreaterThan(5);
    const orbited = camera.position.clone().sub(target)
      .applyAxisAngle(new THREE.Vector3(0, 0, 1), .05);
    camera.position.copy(target).add(orbited);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    const preserved = camera.position.toArray();
    navigation.frame(bounds, envelope.target, 2);
    expect(camera.position.toArray()).toEqual(preserved);

    navigation.setView("top");
    navigation.frame(bounds, envelope.target, 2);
    expect(camera.position.x).toBeCloseTo(1);
    expect(camera.position.y).toBeCloseTo(2);
    expect(camera.position.z).toBeGreaterThan(3);
    navigation.dispose();
  });

  it("uses one real OrbitControls listener and removes it exactly once on disposal", () => {
    const camera = new THREE.PerspectiveCamera(38, 2, .1, 1_000);
    camera.position.set(11, -8, 11);
    const canvas = sizedCanvas();
    const scheduleRender = vi.fn();
    const navigation = createWebGpuCameraControls(
      OrbitControls,
      camera,
      canvas,
      scheduleRender,
    );
    navigation.frame(bounds, envelope.target, 2);
    navigation.frame(bounds, envelope.target, 2);
    scheduleRender.mockClear();

    canvas.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 1,
    }));
    expect(scheduleRender).toHaveBeenCalledOnce();

    navigation.dispose();
    navigation.dispose();
    scheduleRender.mockClear();
    canvas.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 1,
    }));
    expect(scheduleRender).not.toHaveBeenCalled();
  });

  it("exposes the real OrbitControls enabled state for semantic transforms", () => {
    const navigation = createWebGpuCameraControls(
      OrbitControls,
      new THREE.PerspectiveCamera(38, 2, .1, 1_000),
      sizedCanvas(),
      vi.fn(),
    );

    expect(navigation.isEnabled()).toBe(true);
    navigation.setEnabled(false);
    expect(navigation.isEnabled()).toBe(false);
    navigation.setEnabled(true);
    expect(navigation.isEnabled()).toBe(true);
    navigation.dispose();
  });

  it("conditionally refits moved bounds at 390 aspect without disturbing contained pose updates", () => {
    const camera = new THREE.PerspectiveCamera(38, .5, .1, 1_000);
    const navigation = createWebGpuCameraControls(
      OrbitControls, camera, sizedCanvas(), vi.fn(),
    );
    navigation.frame(bounds, envelope.target, .5);
    const distance = camera.position.distanceTo(new THREE.Vector3(...envelope.target));
    const orbitDirection = new THREE.Vector3(-.4, -1, .25).normalize();
    camera.position.copy(new THREE.Vector3(...envelope.target))
      .addScaledVector(orbitDirection, distance);
    camera.lookAt(new THREE.Vector3(...envelope.target));
    camera.updateMatrixWorld(true);

    const contained = bounds.clone().translate(new THREE.Vector3(.05, 0, 0));
    const beforeContained = camera.position.clone();
    navigation.frame(contained, contained.getCenter(new THREE.Vector3()).toArray(), .5);
    expect(camera.position.toArray()).toEqual(beforeContained.toArray());

    const moved = bounds.clone().translate(new THREE.Vector3(30, 0, 0));
    const movedTarget = moved.getCenter(new THREE.Vector3());
    navigation.frame(moved, movedTarget.toArray(), .5);
    expect(camera.position.clone().sub(movedTarget).normalize().dot(orbitDirection))
      .toBeGreaterThan(.9999);
    expectInsideSafeFrustum(camera, moved);
    const afterRefit = camera.position.clone();
    navigation.frame(moved, movedTarget.toArray(), .5);
    expect(camera.position.toArray()).toEqual(afterRefit.toArray());
    navigation.dispose();
  });

  it("refits bounds that move behind the camera and leaves valid near and far planes", () => {
    const camera = new THREE.PerspectiveCamera(38, .5, .1, 1_000);
    const navigation = createWebGpuCameraControls(
      OrbitControls, camera, sizedCanvas(), vi.fn(),
    );
    navigation.frame(bounds, envelope.target, .5);
    const target = new THREE.Vector3(...envelope.target);
    const backward = camera.position.clone().sub(target).normalize();
    const behind = bounds.clone().translate(backward.multiplyScalar(
      camera.position.distanceTo(target) + 20,
    ));
    const behindTarget = behind.getCenter(new THREE.Vector3());

    navigation.frame(behind, behindTarget.toArray(), .5);
    expect(camera.near).toBeGreaterThan(0);
    expect(camera.far).toBeGreaterThan(camera.near);
    expectInsideSafeFrustum(camera, behind);
    navigation.dispose();
  });
});
