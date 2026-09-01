import type { SemanticMeshPayload } from "../cad/rebuild-payload";
import type { AssemblyMaterialMetadata } from "./assembly-materials";
import type { ViewerRenderModel } from "./render-model-types";
import { artifactFromSemanticMesh, artifactFromViewerModel } from "./semantic-scene-adapter";

export type SemanticNodeKind = "assembly" | "component" | "body" | "feature" | "face" | "edge";
export interface SemanticGeometry {
  readonly positions: Float32Array;
  readonly indices?: Uint32Array;
  readonly normals?: Float32Array;
  readonly color?: readonly [number, number, number];
  readonly polyline?: Float32Array;
  readonly polylines?: readonly Float32Array[];
  readonly material?: AssemblyMaterialMetadata;
}
export interface SemanticTransform {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number];
}
export interface SemanticSourceTopology {
  readonly id: string;
  readonly bodyId: string;
  readonly ownerFeatureId: string;
}
export interface SemanticNode {
  readonly id: string;
  readonly kind: SemanticNodeKind;
  readonly parentId?: string;
  readonly transform?: SemanticTransform;
  readonly geometry?: SemanticGeometry;
  readonly movable?: boolean;
  readonly sourceSelectionId?: string;
  readonly ownerComponentId?: string;
  readonly sourceTopology?: SemanticSourceTopology;
}
export interface SemanticDocumentArtifact {
  readonly revision: string;
  readonly frame: { readonly lengthUnit: "mm"; readonly angleUnit: "radian" };
  readonly nodes: readonly SemanticNode[];
  readonly selectionRepairs?: Readonly<Record<string, string>>;
}

const parentKinds: Readonly<Record<SemanticNodeKind, readonly SemanticNodeKind[]>> = {
  assembly: [], component: ["assembly"], body: ["component"], feature: ["body"],
  face: ["feature"], edge: ["feature"],
};

export function validateSemanticDocument(document: SemanticDocumentArtifact): SemanticDocumentArtifact {
  if (document.frame?.lengthUnit !== "mm" || document.frame?.angleUnit !== "radian") {
    throw new Error("semantic frame must use millimetres and radians");
  }
  const nodes = new Map<string, SemanticNode>();
  const sourceSelections = new Set<string>();
  for (const node of document.nodes) {
    if (nodes.has(node.id)) throw new Error(`duplicate semantic ID: ${node.id}`);
    if (!node.parentId && node.kind !== "assembly") throw new Error(`invalid semantic parent: ${node.id}`);
    if (node.parentId) {
      const parent = nodes.get(node.parentId);
      if (!parent) throw new Error(`missing parent: ${node.parentId}`);
      if (!parentKinds[node.kind].includes(parent.kind)) throw new Error(`invalid semantic parent: ${node.id}`);
    }
    if (node.sourceSelectionId !== undefined) {
      if (node.kind !== "component" || node.sourceSelectionId.length === 0
        || sourceSelections.has(node.sourceSelectionId)) {
        throw new Error(`invalid or duplicate semantic source selection: ${node.id}`);
      }
      sourceSelections.add(node.sourceSelectionId);
    }
    nodes.set(node.id, node);
  }
  for (const node of document.nodes) {
    if (node.ownerComponentId && nodes.get(node.ownerComponentId)?.kind !== "component") {
      throw new Error(`invalid semantic component owner: ${node.id}`);
    }
  }
  return document;
}

export function semanticArtifactFromSemanticMesh(
  mesh: SemanticMeshPayload,
  revision: string,
): SemanticDocumentArtifact {
  return validateSemanticDocument(artifactFromSemanticMesh(mesh, revision));
}

export function semanticArtifactFromViewerModel(
  model: ViewerRenderModel,
  revision: string,
): SemanticDocumentArtifact {
  return validateSemanticDocument(artifactFromViewerModel(model, revision));
}
