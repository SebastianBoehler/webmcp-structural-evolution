import * as THREE from "three";

import type { AlternativeLayer } from "./alternative-instances";
import type { CleanupLedger } from "./cleanup-ledger";
import type { PackedInstances, VoxelGrid } from "./field-instances";
import { createTopologySurface } from "./topology-surface";
import type { ScalarAnalysisField } from "./render-envelope";

export interface FieldMeshSet {
  readonly meshes: readonly THREE.InstancedMesh[];
  readonly ghostMaterials: ReadonlyMap<string, THREE.MeshBasicMaterial>;
  readonly analysisSurfaces: readonly AnalysisSurface[];
}

interface AnalysisSurface {
  readonly geometry: THREE.BufferGeometry;
  readonly utilization: Float32Array;
}

interface MeshOwnership extends Pick<CleanupLedger, "own"> {
  attach(mesh: THREE.Object3D): void;
}

const cold = new THREE.Color(0x16b9ff);
const hot = new THREE.Color(0xff2d55);

function colorAnalysisSurface(surface: AnalysisSurface, loadFactor = 1): void {
  const colors = new Float32Array(surface.utilization.length * 3);
  surface.utilization.forEach((value, index) => {
    const color = cold.clone().lerp(hot, Math.min(1, value * loadFactor));
    colors.set([color.r, color.g, color.b], index * 3);
  });
  surface.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  surface.geometry.getAttribute("color").needsUpdate = true;
}

export function updateAnalysisSurfaceLoadFactor(surfaces: readonly AnalysisSurface[], loadFactor: number): void {
  surfaces.forEach((surface) => colorAnalysisSurface(surface, loadFactor));
}

function densitySurface(grid: VoxelGrid, density: Float32Array, ownership: MeshOwnership, analysis?: ScalarAnalysisField, ghosted = false) {
  const material = new THREE.MeshStandardMaterial({
    color: analysis ? 0xffffff : 0x5da9d6,
    metalness: 0.08,
    roughness: 0.38,
    vertexColors: Boolean(analysis),
    side: THREE.DoubleSide,
    transparent: ghosted,
    opacity: ghosted ? 0.18 : 1,
  });
  ownership.own(() => material.dispose());
  const surface = createTopologySurface(grid, density, material);
  let analysisSurface: AnalysisSurface | undefined;
  if (analysis) {
    const position = surface.geometry.getAttribute("position");
    const utilization = new Float32Array(position.count);
    const world = new THREE.Vector3();
    const gridLocal = new THREE.Vector3();
    const inverseAnchor = new THREE.Quaternion(...grid.anchor.orientation).invert();
    for (let index = 0; index < position.count; index += 1) {
      world.fromBufferAttribute(position, index);
      surface.localToWorld(world);
      gridLocal.copy(world).sub(new THREE.Vector3(...grid.anchor.position)).applyQuaternion(inverseAnchor);
      const x = Math.max(0, Math.min(grid.dimensions.width - 1, Math.floor(gridLocal.x / grid.cellSize[0])));
      const y = Math.max(0, Math.min(grid.dimensions.height - 1, Math.floor(gridLocal.y / grid.cellSize[1])));
      const z = Math.max(0, Math.min(grid.dimensions.depth - 1, Math.floor(gridLocal.z / grid.cellSize[2])));
      const fieldIndex = x + grid.dimensions.width * (y + grid.dimensions.height * z);
      utilization[index] = Math.max(0, Math.min(1, analysis.values[fieldIndex]! / Math.max(analysis.maximum, 1e-12)));
    }
    analysisSurface = { geometry: surface.geometry, utilization };
    colorAnalysisSurface(analysisSurface);
  }
  ownership.own(() => surface.geometry.dispose());
  surface.renderOrder = 1;
  ownership.attach(surface);
  return { surface, analysisSurface };
}

function addInstances(
  mesh: THREE.InstancedMesh,
  indices: PackedInstances,
  grid: VoxelGrid,
  color?: THREE.Color,
  startIndex = 0,
  colorForField?: (fieldIndex: number) => THREE.Color,
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
    if (colorForField) mesh.setColorAt(index, colorForField(fieldIndex));
    else if (color) mesh.setColorAt(index, color);
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

const ANALYSIS_BANDS = 7;

function analysisMeshes(
  grid: VoxelGrid,
  records: PackedInstances,
  analysis: ScalarAnalysisField,
  ownership: MeshOwnership,
): readonly THREE.InstancedMesh[] {
  const bands = Array.from({ length: ANALYSIS_BANDS }, () => [] as number[]);
  const maximum = Math.max(analysis.maximum, 1.0e-12);
  records.forEach((fieldIndex) => {
    const normalized = Math.max(0, Math.min(1, analysis.values[fieldIndex]! / maximum));
    bands[Math.min(ANALYSIS_BANDS - 1, Math.floor(normalized * ANALYSIS_BANDS))]!.push(fieldIndex);
  });
  return bands.flatMap((indices, band) => {
    if (indices.length === 0) return [];
    const normalized = band / (ANALYSIS_BANDS - 1);
    const color = new THREE.Color(0x16b9ff).lerp(new THREE.Color(0xff2d55), normalized);
    return [buildMesh(
      grid,
      indices.length,
      () => new THREE.MeshBasicMaterial({ color, toneMapped: false }),
      (mesh) => {
        mesh.name = `verified-${analysis.kind}-band-${band}`;
        mesh.renderOrder = 1;
        anchorMesh(mesh, grid, [0, 0, 0]);
        addInstances(mesh, new Uint32Array(indices), grid);
      },
      ownership,
    )];
  });
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
  analysis?: ScalarAnalysisField,
): FieldMeshSet {
  const meshes: THREE.InstancedMesh[] = [];
  const ghostMaterials = new Map<string, THREE.MeshBasicMaterial>();
  const analysisSurfaces: AnalysisSurface[] = [];
  if (currentInstances.length > 0) {
    if (analysis && !density) meshes.push(...analysisMeshes(grid, currentInstances, analysis, ownership));
    else {
      const voxels = currentMesh(grid, currentInstances, ownership);
      voxels.visible = !density;
      meshes.push(voxels);
    }
  }
  if (density) {
    const rendered = densitySurface(grid, density, ownership, analysis);
    if (rendered.analysisSurface) analysisSurfaces.push(rendered.analysisSurface);
  }
  for (const layer of layers) {
    const mesh = ghostMesh(layer, ownership);
    meshes.push(mesh);
    ghostMaterials.set(layer.branchRevision, mesh.material as THREE.MeshBasicMaterial);
  }
  return { meshes: Object.freeze(meshes), ghostMaterials, analysisSurfaces };
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
