import * as THREE from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";

import type { VoxelGrid } from "./field-instances";

export const TOPOLOGY_ISOLATION = 0.32;
const SURFACE_SAMPLING = 3;
function densityAt(
  density: Float32Array,
  dimensions: VoxelGrid["dimensions"],
  x: number,
  y: number,
  z: number,
): number {
  const { width, height, depth } = dimensions;
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const z0 = Math.max(0, Math.min(depth - 1, Math.floor(z)));
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const z1 = Math.min(depth - 1, z0 + 1);
  const tx = Math.max(0, Math.min(1, x - x0));
  const ty = Math.max(0, Math.min(1, y - y0));
  const tz = Math.max(0, Math.min(1, z - z0));
  const sample = (ix: number, iy: number, iz: number) => density[ix + width * (iy + height * iz)]!;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const lower = lerp(lerp(sample(x0, y0, z0), sample(x1, y0, z0), tx), lerp(sample(x0, y1, z0), sample(x1, y1, z0), tx), ty);
  const upper = lerp(lerp(sample(x0, y0, z1), sample(x1, y0, z1), tx), lerp(sample(x0, y1, z1), sample(x1, y1, z1), tx), ty);
  return lerp(lower, upper, tz);
}

export function createTopologySurface(
  grid: VoxelGrid,
  density: Float32Array,
  material: THREE.Material,
): MarchingCubes {
  const { width, height, depth } = grid.dimensions;
  if (density.length !== width * height * depth) {
    throw new Error("Density surface does not match the topology grid.");
  }
  const sampledWidth = width * SURFACE_SAMPLING;
  const sampledHeight = height * SURFACE_SAMPLING;
  const sampledDepth = depth * SURFACE_SAMPLING;
  const resolution = Math.max(sampledWidth, sampledHeight, sampledDepth) + 4;
  const maximumTriangles = 5 * (sampledWidth - 1) * (sampledHeight - 1) * (sampledDepth - 1);
  const surface = new MarchingCubes(resolution, material, false, false, maximumTriangles);
  surface.name = "verified-topology-surface";
  surface.isolation = TOPOLOGY_ISOLATION;
  const xOffset = Math.floor((resolution - sampledWidth) / 2);
  const yOffset = Math.floor((resolution - sampledHeight) / 2);
  const zOffset = Math.floor((resolution - sampledDepth) / 2);
  for (let z = 0; z < sampledDepth; z += 1) {
    for (let y = 0; y < sampledHeight; y += 1) {
      for (let x = 0; x < sampledWidth; x += 1) {
        const sourceX = (x + 0.5) / SURFACE_SAMPLING - 0.5;
        const sourceY = (y + 0.5) / SURFACE_SAMPLING - 0.5;
        const sourceZ = (z + 0.5) / SURFACE_SAMPLING - 0.5;
        const target = x + xOffset + resolution * (y + yOffset + resolution * (z + zOffset));
        surface.field[target] = densityAt(density, grid.dimensions, sourceX, sourceY, sourceZ);
      }
    }
  }
  surface.update();
  surface.geometry.computeVertexNormals();
  surface.scale.set(
    grid.cellSize[0] * resolution / (2 * SURFACE_SAMPLING),
    grid.cellSize[1] * resolution / (2 * SURFACE_SAMPLING),
    grid.cellSize[2] * resolution / (2 * SURFACE_SAMPLING),
  );
  surface.position.set(
    grid.anchor.position[0] + width * grid.cellSize[0] / 2,
    grid.anchor.position[1] + height * grid.cellSize[1] / 2,
    grid.anchor.position[2] + depth * grid.cellSize[2] / 2,
  );
  surface.quaternion.fromArray(grid.anchor.orientation);
  surface.updateMatrixWorld(true);
  return surface;
}
