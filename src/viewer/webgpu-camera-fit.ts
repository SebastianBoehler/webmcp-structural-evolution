import type * as THREE from "three";

function boxCorners(three: typeof THREE, bounds: THREE.Box3): readonly THREE.Vector3[] {
  const { min, max } = bounds;
  return [min.x, max.x].flatMap((x) => [min.y, max.y].flatMap((y) =>
    [min.z, max.z].map((z) => new three.Vector3(x, y, z))));
}

export function perspectiveBoundsInsideSafeFrustum(
  three: typeof THREE,
  camera: THREE.PerspectiveCamera,
  bounds: THREE.Box3,
  margin = .9,
): boolean {
  if (bounds.isEmpty() || !Number.isFinite(margin) || margin <= 0 || margin > 1) return false;
  camera.updateMatrixWorld(true);
  return boxCorners(three, bounds).every((corner) => {
    const view = corner.clone().applyMatrix4(camera.matrixWorldInverse);
    const projected = corner.project(camera);
    return Number.isFinite(view.z) && view.z < -camera.near
      && Number.isFinite(projected.x) && Number.isFinite(projected.y) && Number.isFinite(projected.z)
      && Math.abs(projected.x) <= margin && Math.abs(projected.y) <= margin
      && projected.z >= -1 && projected.z <= 1;
  });
}

export function fitPerspectiveCameraToBounds(
  three: typeof THREE,
  camera: THREE.PerspectiveCamera,
  bounds: THREE.Box3,
  target: THREE.Vector3,
  backwardDirection: THREE.Vector3,
  aspect: number,
): void {
  if (!Number.isFinite(aspect) || aspect <= 0 || bounds.isEmpty()) {
    throw new Error("Semantic camera fit requires finite bounds and a positive aspect ratio.");
  }
  const backward = backwardDirection.clone().normalize();
  if (backward.lengthSq() === 0) throw new Error("Semantic camera fit direction is empty.");
  const nominalUp = camera.up.clone().normalize();
  if (Math.abs(nominalUp.dot(backward)) > .999) {
    nominalUp.set(Math.abs(backward.y) < .999 ? 0 : 1, Math.abs(backward.y) < .999 ? 1 : 0, 0);
  }
  const right = nominalUp.clone().cross(backward).normalize();
  const up = backward.clone().cross(right).normalize();
  const tangentY = Math.tan(three.MathUtils.degToRad(camera.fov) / 2);
  const tangentX = tangentY * aspect;
  let distance = 0;
  for (const corner of boxCorners(three, bounds)) {
    const relative = corner.sub(target);
    const depthOffset = relative.dot(backward);
    const horizontal = Math.abs(relative.dot(right)) / tangentX;
    const vertical = Math.abs(relative.dot(up)) / tangentY;
    distance = Math.max(distance, depthOffset + Math.max(horizontal, vertical) * 1.12);
  }
  const size = bounds.getSize(new three.Vector3()).length();
  distance = Math.max(distance, size * .6, .001);
  camera.aspect = aspect;
  camera.position.copy(target).addScaledVector(backward, distance);
  camera.lookAt(target);
  camera.near = Math.max(size / 10000, .00001);
  camera.far = Math.max(distance + size * 4, camera.near * 100);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
}
