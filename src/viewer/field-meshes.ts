import * as THREE from "three";
import { MarchingCubes } from "three/examples/jsm/objects/MarchingCubes.js";

import type { AlternativeLayer } from "./alternative-instances";
import type { CleanupLedger } from "./cleanup-ledger";
import type { PackedInstances, VoxelGrid } from "./field-instances";

export interface FieldMeshSet {
  readonly meshes: readonly THREE.InstancedMesh[];
  readonly ghostMaterials: ReadonlyMap<string, THREE.MeshBasicMaterial>;
}

interface MeshOwnership extends Pick<CleanupLedger, "own"> {
  attach(mesh: THREE.Object3D): void;
}

function densitySurface(grid: VoxelGrid, density: Float32Array, ownership: MeshOwnership): MarchingCubes {
  const { width, height, depth } = grid.dimensions;
  if (density.length !== width * height * depth) throw new Error("Density surface does not match the topology grid.");
  const resolution = Math.max(width, height, depth) + 4;
  const material = new THREE.MeshStandardMaterial({
    color: 0x5da9d6,
    metalness: 0.08,
    roughness: 0.38,
    side: THREE.DoubleSide,
  });
  ownership.own(() => material.dispose());
  const surface = new MarchingCubes(resolution, material, false, false, 180_000);
  surface.name = "verified-topology-surface";
  surface.isolation = 0.32;
  const xOffset = Math.floor((resolution - width) / 2);
  const yOffset = Math.floor((resolution - height) / 2);
  const zOffset = Math.floor((resolution - depth) / 2);
  for (let z = 0; z < depth; z += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const source = x + width * (y + height * z);
        const target = x + xOffset + resolution * (y + yOffset + resolution * (z + zOffset));
        surface.field[target] = density[source]!;
      }
    }
  }
  surface.update();
  ownership.own(() => surface.geometry.dispose());
  surface.scale.set(
    width * grid.cellSize[0] * resolution / (2 * width),
    height * grid.cellSize[1] * resolution / (2 * height),
    depth * grid.cellSize[2] * resolution / (2 * depth),
  );
  surface.position.set(
    grid.anchor.position[0] + width * grid.cellSize[0] / 2,
    grid.anchor.position[1] + height * grid.cellSize[1] / 2,
    grid.anchor.position[2] + depth * grid.cellSize[2] / 2,
  );
  surface.quaternion.fromArray(grid.anchor.orientation);
  surface.renderOrder = 1;
  ownership.attach(surface);
  return surface;
}

function addInstances(
  mesh: THREE.InstancedMesh,
  indices: PackedInstances,
  grid: VoxelGrid,
  color?: THREE.Color,
  startIndex = 0,
): void {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const orientation = new THREE.Quaternion();
  const scale = new THREE.Vector3(0.94, 0.94, 0.94);
  indices.forEach((fieldIndex, offset) => {
    const { width, height } = grid.dimensions;
    const x = fieldIndex % width;
    const y = Math.floor(fieldIndex / width) % height;
    const z = Math.floor(fieldIndex / (width * height));
    position.set(
      (x + 0.5) * grid.cellSize[0],
      (y + 0.5) * grid.cellSize[1],
      (z + 0.5) * grid.cellSize[2],
    );
    matrix.compose(position, orientation, scale);
    const index = startIndex + offset;
    mesh.setMatrixAt(index, matrix);
    if (color) mesh.setColorAt(index, color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function anchorMesh(mesh: THREE.InstancedMesh, grid: VoxelGrid, offset: readonly number[]): void {
  mesh.position.set(
    grid.anchor.position[0] + offset[0]!,
    grid.anchor.position[1] + offset[1]!,
    grid.anchor.position[2] + offset[2]!,
  );
  mesh.quaternion.fromArray(grid.anchor.orientation);
}

function buildMesh(
  grid: VoxelGrid,
  count: number,
  materialFactory: () => THREE.Material,
  configure: (mesh: THREE.InstancedMesh) => void,
  ownership: MeshOwnership,
): THREE.InstancedMesh {
  const geometry = new THREE.BoxGeometry(...grid.cellSize);
  ownership.own(() => geometry.dispose());
  const material = materialFactory();
  ownership.own(() => material.dispose());
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  ownership.own(() => mesh.dispose());
  configure(mesh);
  ownership.attach(mesh);
  return mesh;
}

function currentMesh(
  grid: VoxelGrid,
  records: PackedInstances,
  ownership: MeshOwnership,
): THREE.InstancedMesh {
  return buildMesh(
    grid,
    records.length,
    () => new THREE.MeshStandardMaterial({ color: 0x8fd6ff, metalness: 0.05, roughness: 0.62 }),
    (mesh) => {
      mesh.name = "verified-current-field";
      mesh.renderOrder = 1;
      anchorMesh(mesh, grid, [0, 0, 0]);
      addInstances(mesh, records, grid);
    },
    ownership,
  );
}

function ghostMesh(layer: AlternativeLayer, ownership: MeshOwnership): THREE.InstancedMesh {
  return buildMesh(
    layer.grid,
    layer.added.length + layer.removed.length,
    () => new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.34,
      depthTest: true,
      depthWrite: false,
      dithering: true,
      vertexColors: true,
    }),
    (mesh) => {
      mesh.name = `verified-delta-${layer.branchRevision}`;
      mesh.renderOrder = 2;
      anchorMesh(mesh, layer.grid, layer.displayOffset);
      addInstances(mesh, layer.added, layer.grid, new THREE.Color(0x55d6be));
      addInstances(mesh, layer.removed, layer.grid, new THREE.Color(0xff8b6b), layer.added.length);
    },
    ownership,
  );
}

export function createFieldMeshes(
  grid: VoxelGrid,
  currentInstances: PackedInstances,
  layers: readonly AlternativeLayer[],
  ownership: MeshOwnership,
  density?: Float32Array,
): FieldMeshSet {
  const meshes: THREE.InstancedMesh[] = [];
  const ghostMaterials = new Map<string, THREE.MeshBasicMaterial>();
  if (currentInstances.length > 0) {
    const voxels = currentMesh(grid, currentInstances, ownership);
    voxels.visible = !density;
    meshes.push(voxels);
  }
  if (density) densitySurface(grid, density, ownership);
  for (const layer of layers) {
    const mesh = ghostMesh(layer, ownership);
    meshes.push(mesh);
    ghostMaterials.set(layer.branchRevision, mesh.material as THREE.MeshBasicMaterial);
  }
  return { meshes: Object.freeze(meshes), ghostMaterials };
}

export function highlightFieldMesh(
  materials: ReadonlyMap<string, THREE.MeshBasicMaterial>,
  branchRevision: string | undefined,
): void {
  for (const [revision, material] of materials) {
    material.opacity = branchRevision === undefined || revision === branchRevision ? 0.34 : 0.12;
    material.needsUpdate = true;
  }
}
