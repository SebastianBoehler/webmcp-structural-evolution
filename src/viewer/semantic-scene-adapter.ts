import type { SemanticMeshPayload } from "../cad/rebuild-payload";
import { Euler, Quaternion, Vector3 } from "three";
import { geometryPieces, type VisualPiece } from "./assembly-geometries";
import type { AssemblyMaterialMetadata } from "./assembly-materials";
import type { AssemblyVisualPart, ViewerRenderModel } from "./render-model-types";
import type { SemanticDocumentArtifact, SemanticGeometry, SemanticNode,
  SemanticTransform } from "./semantic-scene";

const MM_PER_M = 1_000;
const encoded = (value: string) => encodeURIComponent(value);

function transform(center: readonly number[], rotation?: readonly number[]): SemanticTransform {
  return { position: [center[0]!, center[1]!, center[2]!],
    rotation: [rotation?.[0] ?? 0, rotation?.[1] ?? 0, rotation?.[2] ?? 0] };
}

function material(part: AssemblyVisualPart, piece?: VisualPiece): AssemblyMaterialMetadata {
  return { appearance: part.appearance,
    ...(part.material ? { token: part.material } : {}),
    ...(piece?.color === undefined ? {} : { color: piece.color }),
    ...(piece?.metalness === undefined ? {} : { metalness: piece.metalness }),
    ...(piece?.opacity === undefined ? {} : { opacity: piece.opacity }) };
}

function values(attribute: { readonly count: number; getX(index: number): number;
  getY(index: number): number; getZ(index: number): number }): Float32Array {
  const result = new Float32Array(attribute.count * 3);
  for (let index = 0; index < attribute.count; index += 1) {
    result.set([attribute.getX(index), attribute.getY(index), attribute.getZ(index)], index * 3);
  }
  return result;
}

function pieceGeometry(piece: VisualPiece, metadata: AssemblyMaterialMetadata): SemanticGeometry {
  const position = piece.geometry.getAttribute("position");
  const normal = piece.geometry.getAttribute("normal");
  const sourceIndex = piece.geometry.getIndex();
  return { positions: values(position), ...(normal ? { normals: values(normal) } : {}),
    ...(sourceIndex ? { indices: Uint32Array.from(sourceIndex.array) } : {}), material: metadata };
}

const millimetres = (source: Float32Array) =>
  Float32Array.from(source, (value) => value * MM_PER_M);

function edgePolylines(mesh: SemanticMeshPayload, edgeIndex: number): readonly Float32Array[] {
  const result: Float32Array[] = [];
  mesh.polylineEdgeIndices.forEach((owner, polyline) => {
    if (owner !== edgeIndex) return;
    const start = mesh.edgePointRanges[polyline * 2], count = mesh.edgePointRanges[polyline * 2 + 1];
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start! < 0
      || count! <= 0 || (start! + count!) * 3 > mesh.edgePointsM.length) {
      throw new Error(`Invalid exact edge polyline range at index ${polyline}.`);
    }
    result.push(millimetres(mesh.edgePointsM.slice(start! * 3, (start! + count!) * 3)));
  });
  return result;
}

interface ExactOptions { readonly mesh: SemanticMeshPayload; readonly scope: string;
  readonly componentId: (bodyId: string) => string; readonly transform?: SemanticTransform;
  readonly metadata?: AssemblyMaterialMetadata }

function appendExact(nodes: SemanticNode[], options: ExactOptions): void {
  const { mesh, scope } = options;
  const hierarchy = (bodyId: string, sourceFeatureId: string) => {
    const ownerComponentId = options.componentId(bodyId);
    const bodyNodeId = `body:${scope}:${encoded(bodyId)}`;
    const featureNodeId = `feature:${scope}:${encoded(bodyId)}:${encoded(sourceFeatureId)}`;
    if (!nodes.some(({ id }) => id === ownerComponentId)) {
      nodes.push({ id: ownerComponentId, kind: "component", parentId: "assembly:design" });
    }
    if (!nodes.some(({ id }) => id === bodyNodeId)) {
      nodes.push({ id: bodyNodeId, kind: "body", parentId: ownerComponentId,
        ...(options.transform ? { transform: options.transform } : {}) });
    }
    if (!nodes.some(({ id }) => id === featureNodeId)) {
      nodes.push({ id: featureNodeId, kind: "feature", parentId: bodyNodeId });
    }
    return { ownerComponentId, featureNodeId };
  };
  mesh.faces.forEach((face, faceIndex) => {
    const indices: number[] = [];
    mesh.triangleFaceIndices.forEach((owner, triangle) => {
      if (owner === faceIndex) indices.push(...mesh.indices.slice(triangle * 3, triangle * 3 + 3));
    });
    const owned = hierarchy(face.bodyId, face.signature.ownerFeatureId);
    nodes.push({ id: `face:${scope}:${encoded(face.id)}`, kind: "face",
      parentId: owned.featureNodeId, ownerComponentId: owned.ownerComponentId,
      sourceTopology: { id: face.id, bodyId: face.bodyId,
        ownerFeatureId: face.signature.ownerFeatureId },
      geometry: { positions: millimetres(mesh.positionsM), normals: mesh.normals,
        indices: Uint32Array.from(indices), ...(options.metadata ? { material: options.metadata } : {}) } });
  });
  mesh.edges.forEach((edge, edgeIndex) => {
    const polylines = edgePolylines(mesh, edgeIndex);
    if (polylines.length === 0) throw new Error(`Exact semantic edge has no polyline: ${edge.id}`);
    const owned = hierarchy(edge.bodyId, edge.signature.ownerFeatureId);
    nodes.push({ id: `edge:${scope}:${encoded(edge.id)}`, kind: "edge",
      parentId: owned.featureNodeId, ownerComponentId: owned.ownerComponentId,
      sourceTopology: { id: edge.id, bodyId: edge.bodyId,
        ownerFeatureId: edge.signature.ownerFeatureId },
      geometry: { positions: new Float32Array(), polylines } });
  });
}

function partScopes(parts: readonly AssemblyVisualPart[]): readonly string[] {
  const occurrences = new Map<string, number>();
  return parts.map((part) => {
    const base = part.selectionId === part.id ? encoded(part.id)
      : `${encoded(part.selectionId)}:${encoded(part.id)}`;
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return occurrence === 1 ? base : `${base}:${occurrence}`;
  });
}

function appendVisual(nodes: SemanticNode[], part: Exclude<AssemblyVisualPart,
{ kind: "model" }>, scope: string, bodyTransform: SemanticTransform): void {
  const bodyId = `body:${scope}`;
  nodes.push({ id: bodyId, kind: "body", parentId: `component:${part.selectionId}`,
    transform: bodyTransform });
  if (part.kind !== "mesh") {
    for (const piece of geometryPieces(part)) {
      nodes.push({ id: `feature:${scope}:${encoded(piece.id!)}`, kind: "feature", parentId: bodyId,
        ...(piece.position || piece.rotation
          ? { transform: transform(piece.position ?? [0, 0, 0], piece.rotation) } : {}),
        geometry: pieceGeometry(piece, material(part, piece)) });
      piece.geometry.dispose();
    }
    return;
  }
  const occurrences = new Map<string, number>();
  part.mesh.surfaces.forEach((surface) => {
    const occurrence = (occurrences.get(surface.name) ?? 0) + 1;
    occurrences.set(surface.name, occurrence);
    const name = encoded(surface.name.trim() || "surface");
    const piece = occurrence === 1 ? name : `${name}:${occurrence}`;
    nodes.push({ id: `feature:${scope}:${piece}`, kind: "feature", parentId: bodyId,
      geometry: { positions: surface.positions, indices: surface.indices,
        normals: surface.normals, color: surface.color, material: material(part) } });
  });
}

const artifact = (revision: string, nodes: SemanticNode[]): SemanticDocumentArtifact =>
  Object.freeze({ revision, frame: { lengthUnit: "mm" as const, angleUnit: "radian" as const },
    nodes: Object.freeze(nodes) });

interface ComponentFrame { readonly transform: SemanticTransform; readonly position: Vector3;
  readonly rotation: Quaternion; movable: boolean }

function componentFrame(part: AssemblyVisualPart): ComponentFrame {
  const semanticTransform = transform(part.center, part.rotation);
  return { transform: semanticTransform, position: new Vector3(...semanticTransform.position),
    rotation: new Quaternion().setFromEuler(new Euler(...semanticTransform.rotation)),
    movable: part.movable === true };
}

function relativePartTransform(part: AssemblyVisualPart, frame: ComponentFrame): SemanticTransform {
  const position = new Vector3(...part.center).sub(frame.position)
    .applyQuaternion(frame.rotation.clone().invert());
  const partRotation = new Quaternion().setFromEuler(new Euler(...(part.rotation ?? [0, 0, 0])));
  const rotation = new Euler().setFromQuaternion(frame.rotation.clone().invert().multiply(partRotation));
  return transform(position.toArray(), [rotation.x, rotation.y, rotation.z]);
}

export function artifactFromSemanticMesh(mesh: SemanticMeshPayload,
  revision: string): SemanticDocumentArtifact {
  const nodes: SemanticNode[] = [{ id: "assembly:design", kind: "assembly" }];
  appendExact(nodes, { mesh, scope: "standalone", componentId: (body) => `component:${body}` });
  return artifact(revision, nodes);
}

export function artifactFromViewerModel(model: ViewerRenderModel,
  revision: string): SemanticDocumentArtifact {
  const nodes: SemanticNode[] = [{ id: "assembly:design", kind: "assembly" }];
  if (model.currentInstances.length > 0) nodes.push(
    { id: "component:topology-field", kind: "component", parentId: "assembly:design" },
    { id: "body:topology-field", kind: "body", parentId: "component:topology-field",
      transform: transform(model.grid.anchor.position, [0, 0, 0]) },
    { id: "feature:topology-field", kind: "feature", parentId: "body:topology-field" },
  );
  const parts = model.assemblyParts ?? [], scopes = partScopes(parts);
  const selections = new Map<string, ComponentFrame>();
  parts.forEach((part) => {
    const existing = selections.get(part.selectionId);
    if (existing) existing.movable ||= part.movable === true;
    else selections.set(part.selectionId, componentFrame(part));
  });
  selections.forEach((frame, selectionId) => nodes.push({ id: `component:${selectionId}`,
    kind: "component", parentId: "assembly:design", transform: frame.transform,
    sourceSelectionId: selectionId,
    ...(frame.movable ? { movable: true } : {}) }));
  parts.forEach((part, index) => {
    if (part.kind === "model") throw new Error(`Unsupported WebGPU semantic model asset: ${part.id}`);
    const scope = scopes[index]!;
    const bodyTransform = relativePartTransform(part, selections.get(part.selectionId)!);
    if (part.kind === "mesh" && part.mesh.semanticMesh) appendExact(nodes, {
      mesh: part.mesh.semanticMesh, scope, componentId: () => `component:${part.selectionId}`,
      transform: bodyTransform, metadata: material(part),
    });
    else appendVisual(nodes, part, scope, bodyTransform);
  });
  return artifact(revision, nodes);
}
