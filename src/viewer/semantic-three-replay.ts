import type * as THREE from "three";

import { sampleReplayDisplacement } from "./replay-deformation";
import type { FieldGrid, ResultLayerPayloads } from "./result-layers";
import type { SemanticRenderState } from "./webgpu-renderer-types";
import { updateTopologySurfaceField } from "./topology-surface-field";

type ScalarLayer = FieldGrid & { readonly values: Float32Array; readonly maximum: number;
  readonly scalarScale?: number };

function scalarLayer(state: SemanticRenderState): ScalarLayer | undefined {
  const scalar = state.resultLayers.stress ?? state.resultLayers.temperature ?? state.resultLayers.flux
    ?? state.resultLayers.displacementMagnitude ?? state.resultLayers.displacement;
  if (scalar) return scalar;
  const topology = state.resultLayers.topology;
  return topology ? { ...topology, values: topology.density, maximum: 1 } : undefined;
}

function sameShape(mesh: THREE.InstancedMesh, layer: FieldGrid): boolean {
  const expected = [...layer.dimensions, ...layer.cellSize, ...layer.origin];
  const actual = mesh.userData.fieldShape as readonly number[] | undefined;
  return actual?.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function restoreGroups(three: typeof THREE, scene: THREE.Scene): void {
  scene.traverse((object) => {
    if (!(object instanceof three.Group)) return;
    const position = object.userData.semanticBasePosition as readonly number[] | undefined;
    const quaternion = object.userData.semanticBaseQuaternion as readonly number[] | undefined;
    const scale = object.userData.semanticBaseScale as readonly number[] | undefined;
    if (position) object.position.fromArray(position);
    if (quaternion) object.quaternion.fromArray(quaternion);
    if (scale) object.scale.fromArray(scale);
  });
}

function updateComponents(three: typeof THREE, scene: THREE.Scene,
  deformation: ResultLayerPayloads["displacement"] | undefined): void {
  if (!deformation?.deformationScale) return;
  const scale = deformation.deformationScale;
  scene.traverse((object) => {
    if (!(object instanceof three.Group) || !object.name.startsWith("semantic:component:")) return;
    object.position.add(new three.Vector3(...sampleReplayDisplacement(
      deformation, deformation.vectors,
      object.position.toArray() as [number, number, number], scale,
    )));
  });
}

function updateField(three: typeof THREE, mesh: THREE.InstancedMesh,
  layer: ScalarLayer, deformation: ResultLayerPayloads["displacement"] | undefined): boolean {
  const indices = mesh.userData.fieldIndices as Uint32Array | undefined;
  if (!indices || indices.length !== mesh.count || !sameShape(mesh, layer)
    || (deformation && !sameShape(mesh, deformation))) return false;
  const [width, height] = layer.dimensions;
  const matrix = new three.Matrix4(), color = new three.Color();
  const displacementScale = deformation?.deformationScale ?? 0;
  indices.forEach((cell, instance) => {
    const x = cell % width, y = Math.floor(cell / width) % height;
    const z = Math.floor(cell / (width * height));
    const offset = cell * 3;
    matrix.makeTranslation(
      layer.origin[0] + (x + .5) * layer.cellSize[0]
        + (deformation?.vectors[offset] ?? 0) * displacementScale,
      layer.origin[1] + (y + .5) * layer.cellSize[1]
        + (deformation?.vectors[offset + 1] ?? 0) * displacementScale,
      layer.origin[2] + (z + .5) * layer.cellSize[2]
        + (deformation?.vectors[offset + 2] ?? 0) * displacementScale,
    );
    mesh.setMatrixAt(instance, matrix);
    const utilization = Math.max(0, Math.min(1,
      layer.values[cell]! * (layer.scalarScale ?? 1) / Math.max(layer.maximum, Number.EPSILON)));
    color.setHSL(Math.max(0, .66 - .66 * utilization), .8, .55);
    mesh.setColorAt(instance, color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return true;
}

function updateSurface(mesh: THREE.Mesh, layer: ScalarLayer,
  deformation: ResultLayerPayloads["displacement"] | undefined): boolean {
  return updateTopologySurfaceField(mesh, layer, deformation ? {
    vectors: deformation.vectors,
    scale: deformation.deformationScale ?? 0,
    displacementUnit: deformation.displacementUnit,
    sourceDisplacementUnit: deformation.sourceDisplacementUnit,
  } : undefined);
}

export function updateRetainedSemanticReplay(
  three: typeof THREE,
  scene: THREE.Scene,
  previous: SemanticRenderState,
  next: SemanticRenderState,
): boolean {
  if (previous.document !== next.document || previous.revision !== next.revision
    || previous.selection !== next.selection || previous.resultLayers.flux || next.resultLayers.flux) return false;
  const field = scene.getObjectByName("verified-topology-surface")
    ?? scene.getObjectByName("semantic-result-field");
  const layer = scalarLayer(next);
  if (!(field instanceof three.Mesh) || !layer) return false;
  restoreGroups(three, scene);
  const updated = field instanceof three.InstancedMesh
    ? updateField(three, field, layer, next.resultLayers.displacement)
    : updateSurface(field, layer, next.resultLayers.displacement);
  if (!updated) return false;
  updateComponents(three, scene, next.resultLayers.displacement);
  const frame = next.resultLayers.mechanism;
  const frameGroup = frame ? scene.getObjectByName(`semantic:${frame.componentId}`) : undefined;
  if (frame && !frameGroup) return false;
  if (frame && frameGroup) frameGroup.matrix.fromArray(frame.transform).decompose(
    frameGroup.position, frameGroup.quaternion, frameGroup.scale,
  );
  const targetParent = frame && frameGroup ? frameGroup : scene.getObjectByName("semantic-fit-content");
  if (!targetParent) return false;
  targetParent.add(field);
  scene.updateMatrixWorld(true);
  return true;
}
