import type * as THREE from "three";

import type { SpatialRenderSample } from "./spatial-fields";

export const MAX_VISIBLE_FLUX_ARROWS = 2_048;

function arrow(
  three: typeof THREE,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
): THREE.Group | undefined {
  const start = new three.Vector3(...from);
  const direction = new three.Vector3(...to).sub(start);
  const length = direction.length();
  if (!Number.isFinite(length) || length <= 0) return undefined;
  direction.normalize();
  const headLength = length * .28;
  const shaftLength = length - headLength;
  const radius = Math.max(length * .035, Number.EPSILON);
  const root = new three.Group();
  root.name = "semantic-flux-arrow";
  root.position.copy(start);
  root.quaternion.setFromUnitVectors(new three.Vector3(0, 1, 0), direction);
  const shaft = new three.Mesh(
    new three.CylinderGeometry(radius, radius, shaftLength, 8),
    new three.MeshBasicMaterial({ color: 0x3be2ff }),
  );
  shaft.name = "semantic-flux-arrow-shaft";
  shaft.position.y = shaftLength / 2;
  const head = new three.Mesh(
    new three.ConeGeometry(radius * 2.4, headLength, 10),
    new three.MeshBasicMaterial({ color: 0x3be2ff }),
  );
  head.name = "semantic-flux-arrow-head";
  head.position.y = shaftLength + headLength / 2;
  root.add(shaft, head);
  return root;
}

export function addSemanticFluxArrows(
  three: typeof THREE,
  root: THREE.Group,
  samples: readonly SpatialRenderSample[],
): void {
  const directed = samples.filter((sample) => sample.fluxTo !== undefined);
  const stride = Math.max(1, Math.ceil(directed.length / MAX_VISIBLE_FLUX_ARROWS));
  for (let index = 0; index < directed.length; index += stride) {
    const sample = directed[index]!;
    const object = arrow(three, sample.center, sample.fluxTo!);
    if (object) root.add(object);
  }
}
