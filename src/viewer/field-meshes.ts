import * as THREE from "three";

import type { AlternativeLayer } from "./alternative-instances";
import type { CleanupLedger } from "./cleanup-ledger";
import type { InstanceRecord, VoxelGrid } from "./field-instances";

export interface FieldMeshSet {
  readonly meshes: readonly THREE.InstancedMesh[];
  readonly ghostMaterials: ReadonlyMap<string, THREE.MeshBasicMaterial>;
}

interface MeshOwnership extends Pick<CleanupLedger, "own"> {
  attach(mesh: THREE.InstancedMesh): void;
}

function addInstances(
  mesh: THREE.InstancedMesh,
  records: readonly InstanceRecord[],
  color?: THREE.Color,
  startIndex = 0,
): void {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const orientation = new THREE.Quaternion();
  const scale = new THREE.Vector3(0.94, 0.94, 0.94);
  records.forEach((record, offset) => {
    position.fromArray(record.localPosition);
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
  records: readonly InstanceRecord[],
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
      addInstances(mesh, records);
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
      addInstances(mesh, layer.added, new THREE.Color(0x55d6be));
      addInstances(mesh, layer.removed, new THREE.Color(0xff8b6b), layer.added.length);
    },
    ownership,
  );
}

export function createFieldMeshes(
  grid: VoxelGrid,
  currentInstances: readonly InstanceRecord[],
  layers: readonly AlternativeLayer[],
  ownership: MeshOwnership,
): FieldMeshSet {
  const meshes: THREE.InstancedMesh[] = [];
  const ghostMaterials = new Map<string, THREE.MeshBasicMaterial>();
  meshes.push(currentMesh(grid, currentInstances, ownership));
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
