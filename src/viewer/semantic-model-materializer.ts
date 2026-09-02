import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { CadMesh, CadSurface } from "../assembly/step-import";
import type { AssemblyVisualPart } from "./render-envelope";

const MILLIMETRES_PER_METRE = 1_000;
const loadedScenes = new Map<string, Promise<THREE.Object3D>>();

export interface SemanticModelLoader {
  loadAsync(assetUrl: string): Promise<{ scene: THREE.Object3D }>;
}

function failure(part: Extract<AssemblyVisualPart, { kind: "model" }>, reason: unknown): Error {
  const message = reason instanceof Error ? reason.message : String(reason);
  return new Error(`Could not materialize semantic model part ${part.id} (${part.assetUrl}): ${message}`);
}

interface VectorAttribute { readonly itemSize: number; readonly count: number;
  getX(index: number): number; getY(index: number): number; getZ(index: number): number }

function copiedVectors(attribute: VectorAttribute | undefined, label: string): Float32Array {
  if (!attribute || attribute.itemSize !== 3 || attribute.count < 3 || !Number.isSafeInteger(attribute.count)) {
    throw new Error(`geometry has no valid ${label}`);
  }
  const values = new Float32Array(attribute.count * 3);
  for (let index = 0; index < attribute.count; index += 1) {
    values.set([attribute.getX(index), attribute.getY(index), attribute.getZ(index)], index * 3);
  }
  if (!values.every(Number.isFinite)) throw new Error(`geometry ${label} are not finite`);
  return values;
}

function copiedPositions(geometry: THREE.BufferGeometry): Float32Array {
  return copiedVectors(geometry.getAttribute("position"), "triangle positions");
}

function floatAttributes(geometry: THREE.BufferGeometry): void {
  const positions = copiedPositions(geometry);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const normal = geometry.getAttribute("normal");
  if (normal) geometry.setAttribute("normal", new THREE.Float32BufferAttribute(copiedVectors(normal, "normals"), 3));
}

function copiedIndices(geometry: THREE.BufferGeometry, vertices: number): Uint32Array {
  const source = geometry.getIndex();
  if (!source) {
    if (vertices % 3 !== 0) throw new Error("non-indexed geometry is not a triangle list");
    return Uint32Array.from({ length: vertices }, (_value, index) => index);
  }
  if (source.itemSize !== 1 || source.count === 0 || source.count % 3 !== 0) {
    throw new Error("geometry indices are not a triangle list");
  }
  const indices = new Uint32Array(source.count);
  for (let index = 0; index < source.count; index += 1) {
    const value = source.getX(index);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("geometry indices are not finite vertex references");
    }
    indices[index] = value;
  }
  if (indices.some((index) => index >= vertices)) throw new Error("geometry indices exceed its vertices");
  return indices;
}

function copiedNormals(geometry: THREE.BufferGeometry, positions: Float32Array): Float32Array {
  let normal = geometry.getAttribute("normal");
  if (!normal) {
    geometry.computeVertexNormals();
    normal = geometry.getAttribute("normal");
  }
  if (!normal || normal.count * 3 !== positions.length) {
    throw new Error("geometry normals do not match its positions");
  }
  const normals = copiedVectors(normal, "normals");
  if (!normals.every(Number.isFinite)) throw new Error("geometry normals are not finite");
  return normals;
}

function sourceColor(mesh: THREE.Mesh): CadSurface["color"] {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (!material || !("color" in material) || !(material.color instanceof THREE.Color)) return undefined;
  return [material.color.r, material.color.g, material.color.b];
}

function materializedMesh(scene: THREE.Object3D, part: Extract<AssemblyVisualPart, { kind: "model" }>): CadMesh {
  const root = scene.clone(true);
  const asset = new THREE.Group();
  asset.scale.setScalar(part.assetUnits === "m" ? MILLIMETRES_PER_METRE : 1);
  asset.add(root);
  asset.updateMatrixWorld(true);
  const surfaces: CadSurface[] = [];
  let minimum = [Infinity, Infinity, Infinity];
  let maximum = [-Infinity, -Infinity, -Infinity];
  asset.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry.clone();
    try {
      floatAttributes(geometry);
      geometry.applyMatrix4(object.matrixWorld);
      const positions = copiedPositions(geometry);
      const indices = copiedIndices(geometry, positions.length / 3);
      const normals = copiedNormals(geometry, positions);
      for (let index = 0; index < positions.length; index += 3) {
        for (let axis = 0; axis < 3; axis += 1) {
          minimum[axis] = Math.min(minimum[axis]!, positions[index + axis]!);
          maximum[axis] = Math.max(maximum[axis]!, positions[index + axis]!);
        }
      }
      const color = sourceColor(object);
      surfaces.push({ name: object.name || `surface-${surfaces.length + 1}`, positions, normals, indices,
        ...(color ? { color } : {}) });
    } finally {
      geometry.dispose();
    }
  });
  if (surfaces.length === 0) throw new Error("asset contains no triangle meshes");
  return { surfaces, sizeMm: maximum.map((value, axis) => value - minimum[axis]!) as [number, number, number],
    triangleCount: surfaces.reduce((total, surface) => total + surface.indices.length / 3, 0) };
}

function sceneFor(assetUrl: string, loader: SemanticModelLoader): Promise<THREE.Object3D> {
  let scene = loadedScenes.get(assetUrl);
  if (!scene) {
    scene = loader.loadAsync(assetUrl).then(({ scene: source }) => source);
    loadedScenes.set(assetUrl, scene);
  }
  return scene;
}

export async function materializeSemanticModelParts(
  parts: readonly AssemblyVisualPart[],
  loader: SemanticModelLoader = new GLTFLoader(),
): Promise<readonly AssemblyVisualPart[]> {
  return await Promise.all(parts.map(async (part) => {
    if (part.kind !== "model") return part;
    try {
      return { ...part, kind: "mesh" as const, mesh: materializedMesh(await sceneFor(part.assetUrl, loader), part) };
    } catch (reason) {
      throw failure(part, reason);
    }
  }));
}
