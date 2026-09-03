import type * as THREE from "three";

import { assemblyMaterialProperties } from "./assembly-materials";
import type { SemanticNode } from "./semantic-scene";
import { spatialRenderSamples } from "./spatial-fields";
import type { SemanticRenderState } from "./webgpu-renderer-types";
import type { RenderEnvelope } from "./webgpu-renderer-helpers";
import { addSemanticFluxArrows } from "./semantic-flux-arrows";
import { sampleReplayDisplacement } from "./replay-deformation";

export type SemanticPbrRole = "surface" | "field";
export type SemanticPbrMaterial = THREE.Material & { readonly color: THREE.Color };
export type SemanticPbrMaterialFactory = (
  role: SemanticPbrRole,
  parameters: THREE.MeshStandardMaterialParameters,
) => SemanticPbrMaterial;

function resultColor(three: typeof THREE, state: SemanticRenderState): THREE.Color {
  if (state.resultLayers.temperature) return new three.Color(0xf2a24a);
  if (state.resultLayers.flux) return new three.Color(0x3be2ff);
  if (state.resultLayers.displacementMagnitude) return new three.Color(0x7b6ee6);
  if (state.resultLayers.stress) return new three.Color(0xd85744);
  return new three.Color(0x5c94d4);
}

function disposeTree(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    const owned = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    owned.filter(Boolean).forEach((material) => materials.add(material));
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
}

function addField(
  three: typeof THREE,
  root: THREE.Group,
  state: SemanticRenderState,
  pbr: SemanticPbrMaterialFactory,
) {
  const layer = state.resultLayers.stress ?? state.resultLayers.temperature ?? state.resultLayers.flux
    ?? state.resultLayers.displacementMagnitude ?? state.resultLayers.displacement ?? state.resultLayers.topology;
  if (!layer?.dimensions || !layer.cellSize || !layer.origin || !layer.active) return;
  const values = "values" in layer ? layer.values : layer.density;
  const maximum = "maximum" in layer ? Math.max(layer.maximum, Number.EPSILON) : 1;
  const samples = spatialRenderSamples({
    dimensions: layer.dimensions, cellSize: layer.cellSize, origin: layer.origin,
    active: layer.active, values, maximum,
    scalarScale: "scalarScale" in layer ? layer.scalarScale : undefined,
    displacementScale: state.resultLayers.displacement?.deformationScale,
    vectorKind: state.resultLayers.displacement && state.resultLayers.flux
      ? "displacement-and-flux" : state.resultLayers.displacement ? "displacement"
        : state.resultLayers.flux ? "flux" : "none",
    ...(state.resultLayers.displacement?.vectors ? { displacement: state.resultLayers.displacement.vectors } : {}),
    ...(state.resultLayers.flux?.vectors ? { flux: state.resultLayers.flux.vectors } : {}),
  });
  const geometry = new three.BoxGeometry(...layer.cellSize.map((value) => value * .94));
  const material = pbr("field", { vertexColors: true, roughness: .55,
    metalness: .05, transparent: true, opacity: .72 });
  const mesh = new three.InstancedMesh(geometry, material, samples.length);
  const matrix = new three.Matrix4(), color = new three.Color();
  samples.forEach((sample, index) => {
    matrix.makeTranslation(...sample.center);
    mesh.setMatrixAt(index, matrix);
    color.setHSL(Math.max(0, .66 - .66 * sample.colorValue), .8, .55);
    mesh.setColorAt(index, color);
  });
  root.add(mesh);
  addSemanticFluxArrows(three, root, samples);
}

function selectedNodes(state: SemanticRenderState) {
  const nodes = new Map(state.document.nodes.map((node) => [node.id, node]));
  const selected = new Set<string>();
  for (const node of state.document.nodes) {
    for (let parent: SemanticNode | undefined = node; parent; parent = parent.parentId ? nodes.get(parent.parentId) : undefined) {
      if (parent.id === state.selection) selected.add(node.id);
    }
  }
  return { nodes, selected };
}

function addNode(three: typeof THREE, group: THREE.Group, node: SemanticNode, selected: boolean,
  state: SemanticRenderState, pbr: SemanticPbrMaterialFactory) {
  if (!node.geometry) return;
  const polylines = node.geometry.polylines
    ?? (node.geometry.polyline?.length ? [node.geometry.polyline] : []);
  if (polylines.length) {
    for (const polyline of polylines) {
      const geometry = new three.BufferGeometry();
      geometry.setAttribute("position", new three.BufferAttribute(polyline, 3));
      const line = new three.Line(geometry,
        new three.LineBasicMaterial({ color: selected ? 0x5ad3ff : 0x203040 }));
      line.userData.semanticId = node.id;
      group.add(line);
    }
    return;
  }
  const geometry = new three.BufferGeometry();
  geometry.setAttribute("position", new three.BufferAttribute(node.geometry.positions, 3));
  if (node.geometry.normals) geometry.setAttribute("normal", new three.BufferAttribute(node.geometry.normals, 3));
  else geometry.computeVertexNormals();
  if (node.geometry.indices) geometry.setIndex(new three.BufferAttribute(node.geometry.indices, 1));
  const properties = node.geometry.material
    ? assemblyMaterialProperties(node.geometry.material)
    : { color: resultColor(three, state).getHex(), roughness: .62, metalness: .12,
      opacity: 1, transparent: false, wireframe: false };
  const color = node.geometry.color
    ? new three.Color().fromArray(node.geometry.color)
    : new three.Color(properties.color);
  const material = pbr("surface", { ...properties, color,
    emissive: color.clone().multiplyScalar(.18), emissiveIntensity: .45,
    clippingPlanes: state.sectionPlane ? [new three.Plane(new three.Vector3(...state.sectionPlane.normal), state.sectionPlane.constant)] : [] });
  if (selected) material.color.setHex(0x5ad3ff);
  const mesh = new three.Mesh(geometry, material);
  mesh.userData.semanticId = node.id;
  group.add(mesh, new three.LineSegments(new three.EdgesGeometry(geometry), new three.LineBasicMaterial({ color: 0x203040 })));
}

export function addSemanticScene(three: typeof THREE, scene: THREE.Scene, state: SemanticRenderState,
  gridVisible: boolean, materialFactory?: SemanticPbrMaterialFactory) {
  const root = new three.Group();
  root.name = `semantic-revision:${state.revision}`;
  const content = new three.Group();
  content.name = "semantic-fit-content";
  root.add(content);
  const pbr: SemanticPbrMaterialFactory = materialFactory
    ?? ((_role, parameters) => new three.MeshStandardMaterial(parameters));
  const groups = new Map<string, THREE.Group>();
  const { nodes, selected } = selectedNodes(state);
  for (const node of state.document.nodes) {
    const group = new three.Group();
    group.name = `semantic:${node.id}`;
    group.userData.semanticId = node.id;
    group.userData.movable = node.movable === true;
    if (node.transform) {
      group.position.set(...node.transform.position);
      group.rotation.set(...node.transform.rotation);
    }
    ((node.parentId ? groups.get(node.parentId) : undefined) ?? content).add(group);
    groups.set(node.id, group);
    addNode(three, group, node, selected.has(node.id), state, pbr);
  }
  const frame = state.resultLayers.mechanism;
  const deformation = state.resultLayers.displacement;
  if (deformation?.deformationScale) for (const node of state.document.nodes) {
    if (node.kind !== "component") continue;
    const group = groups.get(node.id);
    if (!group) continue;
    group.position.add(new three.Vector3(...sampleReplayDisplacement(
      deformation, deformation.vectors, group.position.toArray() as [number, number, number],
      deformation.deformationScale,
    )));
  }
  if (frame) groups.get(frame.componentId)?.matrix.fromArray(frame.transform).decompose(
    groups.get(frame.componentId)!.position, groups.get(frame.componentId)!.quaternion, groups.get(frame.componentId)!.scale,
  );
  for (const measurement of state.measurements) {
    root.add(new three.Line(new three.BufferGeometry().setFromPoints([
      new three.Vector3(...measurement.from), new three.Vector3(...measurement.to),
    ]), new three.LineBasicMaterial({ color: 0xf9d648 })));
  }
  if (gridVisible) {
    const grid = new three.GridHelper(1, 12, 0x7892a8, 0x425463);
    grid.name = "semantic-reference-grid";
    grid.rotation.x = Math.PI / 2;
    root.add(grid);
  }
  const fieldParent = frame && nodes.get(frame.componentId)?.kind === "assembly"
    ? groups.get(frame.componentId) ?? content
    : content;
  addField(three, fieldParent, state, pbr);
  scene.add(root);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    scene.remove(root);
    disposeTree(root);
  };
}

export function semanticSceneBounds(three: typeof THREE, scene: THREE.Scene): THREE.Box3 {
  const content = scene.getObjectByName("semantic-fit-content");
  if (!content) throw new Error("Semantic scene has no fit content.");
  const bounds = new three.Box3().setFromObject(content);
  if (bounds.isEmpty()) bounds.expandByPoint(new three.Vector3());
  return bounds;
}

export function configureSemanticReferenceGrid(
  scene: THREE.Scene,
  bounds: THREE.Box3,
  envelope: RenderEnvelope,
): void {
  const grid = scene.getObjectByName("semantic-reference-grid");
  if (!grid) return;
  const size = envelope.span * 1.4;
  grid.position.set(envelope.target[0], envelope.target[1], bounds.min.z);
  grid.scale.set(size, 1, size);
  grid.updateMatrixWorld(true);
}
