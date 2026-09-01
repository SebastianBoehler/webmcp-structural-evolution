import * as THREE from "three";
import { expect, it } from "vitest";

import { fitPerspectiveCameraToBounds } from "./webgpu-camera-fit";
import { createWebGpuResizeSession } from "./webgpu-resize-session";

function corners(bounds: THREE.Box3): THREE.Vector3[] {
  const { min, max } = bounds;
  return [min.x, max.x].flatMap((x) => [min.y, max.y].flatMap((y) =>
    [min.z, max.z].map((z) => new THREE.Vector3(x, y, z))));
}

function expectInside(camera: THREE.PerspectiveCamera, bounds: THREE.Box3) {
  for (const point of corners(bounds)) {
    const projected = point.clone().project(camera);
    expect(Math.abs(projected.x)).toBeLessThanOrEqual(.92);
    expect(Math.abs(projected.y)).toBeLessThanOrEqual(.92);
    expect(projected.z).toBeGreaterThanOrEqual(-1);
    expect(projected.z).toBeLessThanOrEqual(1);
  }
}

it("fits the same semantic bounds at desktop and 390px portrait aspect using both FOV axes", () => {
  const bounds = new THREE.Box3(
    new THREE.Vector3(-.21, -.08, 0),
    new THREE.Vector3(.21, .08, .9),
  );
  const target = bounds.getCenter(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(38, 1440 / 900, .001, 100);
  const isometric = new THREE.Vector3(1, -1, .8).normalize();
  fitPerspectiveCameraToBounds(THREE, camera, bounds, target, isometric, 1440 / 900);
  expectInside(camera, bounds);

  const orbited = new THREE.Vector3(-.4, -1, .25).normalize();
  camera.position.copy(target).addScaledVector(orbited, 2);
  camera.lookAt(target);
  let resize!: (width: number, height: number) => void;
  let frame!: () => void;
  const session = createWebGpuResizeSession({
    observe(callback) { resize = callback; return { disconnect() {} }; },
    requestFrame(callback) { frame = callback; return 1; },
    cancelFrame() {},
    onResize(width, height) {
      fitPerspectiveCameraToBounds(THREE, camera, bounds, target,
        camera.position.clone().sub(target).normalize(), width / height);
    },
    render() {},
  });
  resize(390, 780);
  frame();

  expect(camera.position.clone().sub(target).normalize().dot(orbited)).toBeGreaterThan(.9999);
  expectInside(camera, bounds);
  session.dispose();
});
