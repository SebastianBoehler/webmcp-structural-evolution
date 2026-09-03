import { describe, expect, it } from "vitest";

import * as THREE from "three";

import {
  TOPOLOGY_ISOLATION,
  createTopologySurface,
  topologyExtractionLayout,
} from "./topology-surface";

function grid(cellSize: readonly [number, number, number]) {
  return {
    dimensions: { width: 3, height: 3, depth: 3 }, cellSize,
    anchor: { position: [0, 0, 0] as const, orientation: [0, 0, 0, 1] as const },
  };
}

function positions(surface: THREE.Mesh): number[] {
  return Array.from(surface.geometry.getAttribute("position").array as Float32Array);
}

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

  it("caches extraction positions by density and geometry-producing grid inputs", () => {
    const density = new Float32Array(27).fill(1);
    density[13] = 0;
    const isotropic = grid([1, 1, 1]);
    const anisotropic = grid([4, 1, 1]);
    const resources: THREE.Mesh[] = [];
    const create = (source: Float32Array, sourceGrid: ReturnType<typeof grid>) => {
      const material = new THREE.MeshBasicMaterial();
      const surface = createTopologySurface(sourceGrid, source, material);
      resources.push(surface);
      return surface;
    };

    try {
      const sharedIsotropic = create(density, isotropic);
      const sharedAnisotropic = create(density, anisotropic);
      const uncachedIsotropic = create(new Float32Array(density), isotropic);
      const uncachedAnisotropic = create(new Float32Array(density), anisotropic);

      expect(positions(uncachedIsotropic)).not.toEqual(positions(uncachedAnisotropic));
      expect(positions(sharedIsotropic)).toEqual(positions(uncachedIsotropic));
      expect(positions(sharedAnisotropic)).toEqual(positions(uncachedAnisotropic));
    } finally {
      resources.forEach((surface) => {
        surface.geometry.dispose();
        (surface.material as THREE.Material).dispose();
      });
    }
  });

  it("budgets the live rectangular grid without cubic padding", () => {
    const layout = topologyExtractionLayout({
      dimensions: { width: 128, height: 128, depth: 16 }, cellSize: [1, 1, 1],
      anchor: { position: [0, 0, 0], orientation: [0, 0, 0, 1] },
    });

    expect(layout.sampleDimensions).toEqual([258, 258, 34]);
    expect(layout.scalarBytes).toBe(258 * 258 * 34 * Float32Array.BYTES_PER_ELEMENT);
    expect(layout.scalarBytes).toBeLessThan(16 * 1024 * 1024);
    expect(layout.scalarBytes + layout.triangleBytes).toBeLessThan(48 * 1024 * 1024);
  });
});
