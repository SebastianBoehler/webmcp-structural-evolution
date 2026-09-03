import * as THREE from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import type { VoxelGrid } from "./field-instances";
import { buildTopologyDistanceField } from "./topology-distance-field";
import {
  extractRectangularTopologySurface,
  topologyExtractionLayout,
} from "./topology-surface-extractor";

export { topologyExtractionLayout } from "./topology-surface-extractor";

export const TOPOLOGY_ISOLATION = 0.5;
const DENSITY_ISOLATION = 0.32;
const SURFACE_SAMPLING = 2;
const surfaceCache = new WeakMap<Float32Array, Map<string, Float32Array>>();

function surfaceCacheKey(grid: VoxelGrid): string {
  const { width, height, depth } = grid.dimensions;
  return [
    width, height, depth, ...grid.cellSize,
    DENSITY_ISOLATION, TOPOLOGY_ISOLATION, SURFACE_SAMPLING,
  ].join(":");
}

function extractSurfacePositions(grid: VoxelGrid, density: Float32Array): Float32Array {
  const cacheKey = surfaceCacheKey(grid);
  const cached = surfaceCache.get(density)?.get(cacheKey);
  if (cached) return cached;
  const { width, height, depth } = grid.dimensions;
  if (density.length !== width * height * depth) {
    throw new Error("Density surface does not match the topology grid.");
  }
  const displayDensity = buildTopologyDistanceField(
    density, grid.dimensions, grid.cellSize, DENSITY_ISOLATION,
  );
  const positions = extractRectangularTopologySurface(displayDensity, grid, TOPOLOGY_ISOLATION);
  const cachedByGrid = surfaceCache.get(density) ?? new Map<string, Float32Array>();
  cachedByGrid.set(cacheKey, positions);
  surfaceCache.set(density, cachedByGrid);
  return positions;
}

export function createTopologySurface(
  grid: VoxelGrid,
  density: Float32Array,
  material: THREE.Material,
): THREE.Mesh {
  const { width, height, depth } = grid.dimensions;
  if (density.length !== width * height * depth) {
    throw new Error("Density surface does not match the topology grid.");
  }
  const rawGeometry = new THREE.BufferGeometry();
  rawGeometry.setAttribute("position", new THREE.BufferAttribute(extractSurfacePositions(grid, density), 3));
  const geometry = mergeVertices(rawGeometry, 1e-4);
  rawGeometry.dispose();
  geometry.computeVertexNormals();
  const surface = new THREE.Mesh(geometry, material);
  surface.name = "verified-topology-surface";
  surface.userData.surfaceTreatment =
    "Density-derived signed-distance reconstruction; post-reconstruction solver field remains canonical";
  surface.position.fromArray(grid.anchor.position);
  surface.quaternion.fromArray(grid.anchor.orientation);
  surface.userData.extractionLayout = topologyExtractionLayout(grid);
  surface.updateMatrixWorld(true);
  return surface;
}
