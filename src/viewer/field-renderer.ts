import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { AlternativeLayer } from "./alternative-instances";
import type { InstanceRecord, VoxelGrid } from "./field-instances";

// A 2x DPR ceiling is a rendering-budget decision: voxel comparisons favor legibility over 3x pixels.
export const MAX_RENDER_DPR = 2;

export interface ResizeEntryLike {
  readonly devicePixelContentBoxSize?: readonly {
    readonly inlineSize: number;
    readonly blockSize: number;
  }[];
  readonly contentRect: { readonly width: number; readonly height: number };
}

interface RendererLike {
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: THREE.Scene, camera: THREE.Camera): void;
  dispose(): void;
}

interface ControlsLike {
  enableDamping: boolean;
  readonly target: { set(x: number, y: number, z: number): unknown };
  addEventListener(type: "change", listener: () => void): void;
  removeEventListener(type: "change", listener: () => void): void;
  update(): void;
  dispose(): void;
}

interface ObserverLike {
  observe(target: Element): void;
  disconnect(): void;
}

export interface FieldViewerEnvironment {
  readonly createRenderer: (canvas: HTMLCanvasElement) => RendererLike;
  readonly createControls: (camera: THREE.PerspectiveCamera, canvas: HTMLCanvasElement) => ControlsLike;
  readonly createResizeObserver: (
    callback: (entries: readonly ResizeEntryLike[]) => void,
  ) => ObserverLike;
  readonly requestFrame: (callback: FrameRequestCallback) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly devicePixelRatio: () => number;
  readonly prefersReducedMotion: () => boolean;
}

export interface ViewerRenderModel {
  readonly grid: VoxelGrid;
  readonly currentInstances: readonly InstanceRecord[];
  readonly alternativeLayers: readonly AlternativeLayer[];
  readonly highlightedBranch?: string;
}

const defaultEnvironment: FieldViewerEnvironment = {
  createRenderer: (canvas) => new THREE.WebGLRenderer({ antialias: true, canvas }),
  createControls: (camera, canvas) => new OrbitControls(camera, canvas),
  createResizeObserver: (callback) => new ResizeObserver((entries) => callback(entries)),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
  devicePixelRatio: () => window.devicePixelRatio || 1,
  prefersReducedMotion: () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
};

export function viewerEnvironment(
  override: FieldViewerEnvironment | undefined,
): FieldViewerEnvironment {
  return override ?? defaultEnvironment;
}

function addInstances(
  mesh: THREE.InstancedMesh,
  records: readonly InstanceRecord[],
  color?: THREE.Color,
): void {
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const orientation = new THREE.Quaternion();
  const scale = new THREE.Vector3(0.94, 0.94, 0.94);
  for (let index = 0; index < records.length; index += 1) {
    position.fromArray(records[index]!.localPosition);
    matrix.compose(position, orientation, scale);
    mesh.setMatrixAt(index, matrix);
    if (color) mesh.setColorAt(index, color);
  }
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

function currentMesh(grid: VoxelGrid, records: readonly InstanceRecord[]): THREE.InstancedMesh {
  const geometry = new THREE.BoxGeometry(...grid.cellSize);
  const material = new THREE.MeshStandardMaterial({
    color: 0x8fd6ff,
    metalness: 0.05,
    roughness: 0.62,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, records.length);
  mesh.name = "verified-current-field";
  mesh.renderOrder = 1;
  anchorMesh(mesh, grid, [0, 0, 0]);
  addInstances(mesh, records);
  return mesh;
}

function ghostMesh(layer: AlternativeLayer, highlighted?: string): THREE.InstancedMesh {
  const records = [...layer.added, ...layer.removed];
  const focused = highlighted === undefined || highlighted === layer.branchRevision;
  const geometry = new THREE.BoxGeometry(...layer.grid.cellSize);
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: focused ? 0.34 : 0.12,
    depthTest: true,
    depthWrite: false,
    dithering: true,
    vertexColors: true,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, records.length);
  mesh.name = `verified-delta-${layer.branchRevision}`;
  mesh.renderOrder = 2;
  anchorMesh(mesh, layer.grid, layer.displayOffset);
  addInstances(mesh, layer.added, new THREE.Color(0x55d6be));
  const removedColor = new THREE.Color(0xff8b6b);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const orientation = new THREE.Quaternion();
  const scale = new THREE.Vector3(0.94, 0.94, 0.94);
  layer.removed.forEach((record, offset) => {
    position.fromArray(record.localPosition);
    matrix.compose(position, orientation, scale);
    const index = layer.added.length + offset;
    mesh.setMatrixAt(index, matrix);
    mesh.setColorAt(index, removedColor);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function cameraFor(grid: VoxelGrid): THREE.PerspectiveCamera {
  const size = grid.dimensions;
  const span = Math.max(
    size.width * grid.cellSize[0],
    size.height * grid.cellSize[1],
    size.depth * grid.cellSize[2],
  );
  const camera = new THREE.PerspectiveCamera(38, 1, Math.max(0.01, span / 1000), span * 20);
  camera.position.set(
    grid.anchor.position[0] + span * 1.4,
    grid.anchor.position[1] + span,
    grid.anchor.position[2] + span * 1.8,
  );
  camera.lookAt(...grid.anchor.position);
  return camera;
}

export function mountFieldRenderer(
  canvas: HTMLCanvasElement,
  model: ViewerRenderModel,
  environment: FieldViewerEnvironment,
): () => void {
  const renderer = environment.createRenderer(canvas);
  const scene = new THREE.Scene();
  const camera = cameraFor(model.grid);
  const controls = environment.createControls(camera, canvas);
  environment.prefersReducedMotion();
  // Event-driven rendering deliberately avoids damping/automatic motion for every motion preference.
  controls.enableDamping = false;
  controls.target.set(...model.grid.anchor.position);
  controls.update();
  scene.add(new THREE.HemisphereLight(0xdcefff, 0x101724, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.6);
  key.position.set(5, 8, 12);
  scene.add(key);

  const meshes = [
    currentMesh(model.grid, model.currentInstances),
    ...model.alternativeLayers.map((layer) => ghostMesh(layer, model.highlightedBranch)),
  ];
  scene.add(...meshes);

  let frame: number | undefined;
  let width = 1;
  let height = 1;
  const render = () => {
    frame = undefined;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  };
  const scheduleRender = () => {
    if (frame === undefined) frame = environment.requestFrame(render);
  };
  const observer = environment.createResizeObserver(([entry]) => {
    if (!entry) return;
    const dpr = Math.min(MAX_RENDER_DPR, Math.max(1, environment.devicePixelRatio()));
    const deviceSize = entry.devicePixelContentBoxSize?.[0];
    width = Math.max(1, deviceSize ? deviceSize.inlineSize / dpr : entry.contentRect.width);
    height = Math.max(1, deviceSize ? deviceSize.blockSize / dpr : entry.contentRect.height);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    scheduleRender();
  });
  observer.observe(canvas);
  controls.addEventListener("change", scheduleRender);
  scheduleRender();

  return () => {
    if (frame !== undefined) environment.cancelFrame(frame);
    observer.disconnect();
    controls.removeEventListener("change", scheduleRender);
    controls.dispose();
    for (const mesh of meshes) {
      scene.remove(mesh);
      mesh.dispose();
      mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      materials.forEach((material) => material.dispose());
    }
    renderer.dispose();
  };
}
