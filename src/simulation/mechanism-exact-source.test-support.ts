import { defineDesignDocument, type DesignDocument } from "../cad/document-schema";
import type { BodyDynamicsPayload } from "../cad/body-dynamics-payload";
import { buildCadEvaluationResults } from "../cad/kernel/rebuild-results";
import type { CadEvaluationRequest } from "../cad/runtime-contracts";

export async function exactSourceDocument(): Promise<DesignDocument> {
  return defineDesignDocument({
    id: "mechanism-exact", label: "Mechanism exact source", schemaVersion: 4,
    units: { length: "mm", angle: "deg", mass: "kg" },
    createdBy: { kind: "agent", id: "test" },
    frames: [{
      id: "world", label: "World",
      transform: {
        position: { x: { value: 0, unit: "m" }, y: { value: 0, unit: "m" }, z: { value: 0, unit: "m" } },
        orientation: { roll: { value: 0, unit: "rad" }, pitch: { value: 0, unit: "rad" }, yaw: { value: 0, unit: "rad" } },
      },
    }],
    parameters: [],
    sketches: [{
      id: "sketch", plane: "frame:world",
      entities: [{ id: "outline", kind: "rectangle", centerM: [0, 0], sizeM: [0.02, 0.01] }],
      constraints: [
        { id: "width", kind: "distance", first: { entityId: "outline", point: "left" }, second: { entityId: "outline", point: "right" }, axis: "x", valueM: 0.02 },
        { id: "height", kind: "distance", first: { entityId: "outline", point: "bottom" }, second: { entityId: "outline", point: "top" }, axis: "y", valueM: 0.01 },
      ],
    }],
    features: [{ id: "feature", kind: "extrude", sketchId: "sketch", distanceM: 0.01 }],
    bodies: [{ id: "body", featureId: "feature" }],
    components: [], instances: [], mates: [], namedSelections: [], materials: [], studies: [],
  });
}

export const semanticMesh = () => ({
  positionsM: new Float32Array(), normals: new Float32Array(), indices: new Uint32Array(),
  faces: [], triangleFaceIndices: new Uint32Array(), edgePointsM: new Float32Array(),
  edgePointRanges: new Uint32Array(), edges: [], polylineEdgeIndices: new Uint32Array(),
});

export const bodyDynamics = (overrides: Record<string, unknown> = {}) => ({
  bodies: [{
    bodyId: "body", brep: { bytes: new Uint8Array([4, 5, 6]) }, volumeM3: 0.000002,
    centerOfMassM: [0, 0, 0.005],
    centroidalInertiaUnitDensityKgM2: [2, 0, 0, 0, 3, 0, 0, 0, 4],
    ...overrides,
  }],
});

export async function exactSuccess(request: CadEvaluationRequest) {
  const results = await buildCadEvaluationResults(request, {
    featureIds: ["feature"], bodyIds: ["body"],
    brep: { bytes: new Uint8Array([1, 2, 3]) },
    semanticMesh: semanticMesh(), bodyDynamics: bodyDynamics() as BodyDynamicsPayload,
  });
  return {
    requestId: request.requestId, state: "succeeded" as const,
    sourceRevision: request.sourceRevision,
    requestedOutputs: [...request.requestedOutputs], results,
  };
}
