import * as THREE from "three";
import type { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { geometryPieces } from "../viewer/assembly-geometries";
import type { VoxelGrid } from "../viewer/field-instances";
import type { AssemblyVisualPart } from "../viewer/render-envelope";
import { createTopologySurface } from "../viewer/topology-surface";

function material(color = 0x8aa7b8, opacity = 1, metalness = 0.15): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    metalness,
    opacity,
    roughness: 0.42,
    transparent: opacity < 1,
  });
}

function compactFrame(grid: VoxelGrid, density: Float32Array): THREE.Mesh {
  const sourceMaterial = material(0x19252e, 1, 0.08);
  const surface = createTopologySurface(grid, density, sourceMaterial);
  const geometry = new THREE.BufferGeometry();
  const source = surface.geometry.getAttribute("position");
  const count = source.count;
  const positions = source.array as Float32Array;
  const compact = new Float32Array(count * 3);
  compact.set(positions.subarray(0, count * 3));
  geometry.setAttribute("position", new THREE.BufferAttribute(compact, 3));
  geometry.applyMatrix4(surface.matrixWorld);
  geometry.computeVertexNormals();
  surface.geometry.dispose();
  sourceMaterial.dispose();
  const frame = new THREE.Mesh(geometry, material(0x17242d, 1, 0.05));
  frame.name = "verified_topology_frame_PLA";
  return frame;
}

function proceduralPart(part: Parameters<typeof geometryPieces>[0]): THREE.Group {
  const root = new THREE.Group();
  for (const piece of geometryPieces(part)) {
    const item = new THREE.Mesh(
      piece.geometry,
      material(piece.color, piece.opacity, piece.metalness),
    );
    if (piece.position) item.position.set(...piece.position);
    if (piece.rotation) item.rotation.set(...piece.rotation);
    root.add(item);
  }
  return root;
}

function importedMesh(part: Extract<AssemblyVisualPart, { kind: "mesh" }>): THREE.Group {
  const root = new THREE.Group();
  for (const surface of part.mesh.surfaces) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(surface.positions.slice(), 3));
    if (surface.normals) geometry.setAttribute("normal", new THREE.BufferAttribute(surface.normals.slice(), 3));
    else geometry.computeVertexNormals();
    geometry.setIndex(new THREE.BufferAttribute(surface.indices.slice(), 1));
    const color = surface.color ? new THREE.Color(...surface.color).getHex() : undefined;
    root.add(new THREE.Mesh(geometry, material(color, 1, 0.45)));
  }
  return root;
}

async function partObject(
  part: AssemblyVisualPart,
  loader: GLTFLoader,
  cache: Map<string, THREE.Object3D>,
): Promise<THREE.Object3D> {
  if (part.kind === "model") {
    let source = cache.get(part.assetUrl);
    if (!source) {
      source = (await loader.loadAsync(part.assetUrl)).scene;
      cache.set(part.assetUrl, source);
    }
    const clone = source.clone(true);
    clone.scale.setScalar(part.assetUnits === "m" ? 1_000 : 1);
    return clone;
  }
  if (part.kind === "mesh") return importedMesh(part);
  return proceduralPart(part as Parameters<typeof geometryPieces>[0]);
}

function disposeScene(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((entry) => entry.dispose());
  });
}

export async function serializeEngineeringAssemblyGlb(
  grid: VoxelGrid,
  density: Float32Array,
  parts: readonly AssemblyVisualPart[],
): Promise<ArrayBuffer> {
  const assembly = new THREE.Group();
  assembly.name = "verified_5inch_fpv_engineering_assembly";
  assembly.add(compactFrame(grid, density));
  const [{ GLTFExporter }, { GLTFLoader }] = await Promise.all([
    import("three/examples/jsm/exporters/GLTFExporter.js"),
    import("three/examples/jsm/loaders/GLTFLoader.js"),
  ]);
  const loader = new GLTFLoader();
  const cache = new Map<string, THREE.Object3D>();
  for (const part of parts.filter(({ appearance }) => appearance === "component")) {
    const object = await partObject(part, loader, cache);
    const root = new THREE.Group();
    root.name = part.label.replaceAll(/[^A-Za-z0-9_-]+/g, "_");
    root.position.set(...part.center);
    if (part.rotation) root.rotation.set(...part.rotation);
    root.add(object);
    assembly.add(root);
  }
  assembly.scale.setScalar(0.001);
  try {
    const output = await new GLTFExporter().parseAsync(assembly, {
      binary: true,
      onlyVisible: true,
      trs: true,
    });
    if (!(output instanceof ArrayBuffer)) throw new Error("GLB export did not produce an ArrayBuffer.");
    return output;
  } finally {
    disposeScene(assembly);
  }
}

export async function downloadEngineeringAssemblyGlb(
  grid: VoxelGrid,
  density: Float32Array,
  parts: readonly AssemblyVisualPart[],
  filename = "verified-fpv-engineering-assembly.glb",
): Promise<void> {
  const output = await serializeEngineeringAssemblyGlb(grid, density, parts);
  const url = URL.createObjectURL(new Blob([output], { type: "model/gltf-binary" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
