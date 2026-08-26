import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

import type { VoxelGrid } from "../viewer/field-instances";
import { createTopologySurface } from "../viewer/topology-surface";

export function serializeTopologyStl(grid: VoxelGrid, density: Float32Array): DataView {
  const material = new THREE.MeshBasicMaterial();
  const surface = createTopologySurface(grid, density, material);
  const compact = new THREE.BufferGeometry();
  try {
    const count = surface.geometry.drawRange.count;
    const source = surface.geometry.getAttribute("position");
    const positions = new Float32Array(count * 3);
    positions.set((source.array as Float32Array).subarray(0, count * 3));
    compact.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    compact.applyMatrix4(surface.matrixWorld);
    const output = new STLExporter().parse(new THREE.Mesh(compact, material), { binary: true });
    if (!(output instanceof DataView)) throw new Error("Binary STL export did not produce a DataView.");
    return output;
  } finally {
    surface.geometry.dispose();
    compact.dispose();
    material.dispose();
  }
}

export function downloadTopologyStl(
  grid: VoxelGrid,
  density: Float32Array,
  filename = "topology-optimized-drone-frame.stl",
): void {
  const output = serializeTopologyStl(grid, density);
  const bytes = new Uint8Array(output.byteLength);
  bytes.set(new Uint8Array(output.buffer, output.byteOffset, output.byteLength));
  const url = URL.createObjectURL(new Blob([bytes], { type: "model/stl" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
