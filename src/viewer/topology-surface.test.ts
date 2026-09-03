import { describe, expect, it } from "vitest";

import * as THREE from "three";

import { TOPOLOGY_ISOLATION, createTopologySurface } from "./topology-surface";

describe("topology surface preparation", () => {
  it("uses the signed-distance display boundary while retaining the mesh contract", () => {
    const density = new Float32Array(27).fill(1);
    density[13] = 0;
    const material = new THREE.MeshBasicMaterial();
    const surface = createTopologySurface({
      dimensions: { width: 3, height: 3, depth: 3 }, cellSize: [2, 2, 1],
      anchor: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
    }, density, material);

    expect(TOPOLOGY_ISOLATION).toBe(0.5);
    expect(surface).toBeInstanceOf(THREE.Mesh);
    expect(surface.name).toBe("verified-topology-surface");
    expect(surface.userData.surfaceTreatment).toBe(
      "Density-derived signed-distance reconstruction; post-reconstruction solver field remains canonical",
    );
    surface.geometry.dispose();
    material.dispose();
  });
});
