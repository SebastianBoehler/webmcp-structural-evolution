import { OcctKernel } from "occt-wasm";

import type { BodyDynamicsPayload } from "../cad/body-dynamics-payload";
import { defineDesignDocument, type DesignDocument } from "../cad/document-schema";
import { buildCadEvaluationResults } from "../cad/kernel/rebuild-results";
import type { CadEvaluationRequest } from "../cad/runtime-contracts";

const zeroTransform = {
  position: { x: { value: 0, unit: "m" as const }, y: { value: 0, unit: "m" as const }, z: { value: 0, unit: "m" as const } },
  orientation: { roll: { value: 0, unit: "rad" as const }, pitch: { value: 0, unit: "rad" as const }, yaw: { value: 0, unit: "rad" as const } },
};
const signature = (bodyId: string) => ({
  bodyId, ownerFeatureId: bodyId === "base-body" ? "base-feature" : "link-feature",
  expectedKind: "face" as const, stableId: `${bodyId}-face`,
  signature: { geometry: "plane" as const, centroidM: [0, 0, 0.5] as const, measureSI: 1, adjacentKinds: ["line"] },
});

export async function mechanismDocument(
  mate: "rigid" | "revolute" | "prismatic" = "revolute",
  configurationState: "configured" | "requires-configuration" = "configured",
): Promise<DesignDocument> {
  const mateValue = mate === "rigid" ? { kind: mate }
    : mate === "revolute"
      ? { kind: mate, axisFirstLocal: [1, 0, 0], lowerRad: -1, upperRad: 1 }
      : { kind: mate, axisFirstLocal: [1, 0, 0], lowerM: -0.2, upperM: 0.3 };
  const configured = {
    configurationState: "configured" as const,
    fixedInstanceIds: ["base"],
    materialAssignments: [{ instanceId: "base", materialId: "steel" }, { instanceId: "link", materialId: "steel" }],
    gravityWorldMps2: [0, 0, -9.81],
    pointForces: [{ instanceId: "link", pointLocalM: [0, 0, 0.5], forceWorldN: [0, 1, 0] }],
    maximumCollisionApproximationErrorM: 1e-3,
    initialOverlapPolicy: "reject-any-positive-volume" as const,
    durationSteps: 240, outputStrideSteps: 4,
    collisionGroups: [
      { id: "base-group", instanceIds: ["base"], membershipMask: 1, filterMask: 0 },
      { id: "link-group", instanceIds: ["link"], membershipMask: 2, filterMask: 0 },
    ],
    clearancePairs: [{ id: "base-link-query", firstInstanceId: "base", secondInstanceId: "link" }],
  };
  return defineDesignDocument({
    id: "mechanism-compile", label: "Mechanism compiler", schemaVersion: 6,
    units: { length: "m", angle: "rad", mass: "kg" }, createdBy: { kind: "agent", id: "test" },
    frames: [
      { id: "world", label: "World", transform: zeroTransform },
      { id: "base-place", label: "Base", parentId: "world", transform: zeroTransform },
      { id: "link-parent", label: "Link parent", parentId: "world", transform: {
        ...zeroTransform, orientation: { ...zeroTransform.orientation, yaw: { value: Math.PI / 2, unit: "rad" } },
      } },
      { id: "link-place", label: "Link", parentId: "link-parent", transform: zeroTransform },
    ],
    parameters: [],
    sketches: ["base", "link"].map((id) => ({
      id: `${id}-sketch`, plane: "frame:world",
      entities: [{ id: `${id}-outline`, kind: "rectangle", centerM: [0, 0], sizeM: [1, 1] }], constraints: [],
    })),
    features: ["base", "link"].map((id) => ({ id: `${id}-feature`, kind: "extrude", sketchId: `${id}-sketch`, distanceM: 1 })),
    bodies: ["base", "link"].map((id) => ({ id: `${id}-body`, featureId: `${id}-feature` })),
    components: ["base", "link"].map((id) => ({ id: `${id}-component`, bodyIds: [`${id}-body`] })),
    instances: [
      { id: "base", componentId: "base-component", frameId: "base-place" },
      { id: "link", componentId: "link-component", frameId: "link-place" },
    ],
    mates: [{ id: "joint", firstInstanceId: "base", secondInstanceId: "link",
      firstSelectionId: "base-face-selection", secondSelectionId: "link-face-selection", ...mateValue }],
    namedSelections: [
      { id: "base-face-selection", reference: signature("base-body") },
      { id: "link-face-selection", reference: signature("link-body") },
    ],
    materials: [{ id: "steel", kind: "isotropic", densityKgM3: 2,
      youngsModulusPa: 1, poissonRatio: 0.3, failureStressPa: 1 }],
    studies: [{ id: "motion", kind: "mechanism", instanceIds: ["base", "link"], mateIds: ["joint"],
      ...(configurationState === "configured" ? configured : { configurationState }) }],
  });
}

export async function unitBoxBrep(): Promise<Uint8Array> {
  const kernel = await OcctKernel.init();
  try {
    const shape = kernel.makeBox(1, 1, 1);
    return kernel.toBREPBinary(shape);
  } finally {
    kernel[Symbol.dispose]();
  }
}

export async function exactCompilerSuccess(
  request: CadEvaluationRequest,
  brepBytes: Uint8Array,
  linkFaceCentroidM: [number, number, number] = [0, 0, 0.5],
  linkFaceNormal: [number, number, number] = [0, -1, 0],
  selectedGeometry: "plane" | "sphere" = "plane",
) {
  const faces = request.document.bodies.flatMap(({ id: bodyId, featureId }) => Array.from({ length: 6 }, (_value, index) => ({
    id: index === 0 ? `${bodyId}-face` : `${bodyId}-face-${index}`, bodyId,
    signature: { ownerFeatureId: featureId,
      kind: "face" as const, geometry: index === 0 ? selectedGeometry : "plane" as const,
      centroidM: index === 0
        ? bodyId === "link-body" ? linkFaceCentroidM : [0, 0, 0.5] as [number, number, number]
        : [index, 0, 0.5] as [number, number, number],
      measureSI: 1, adjacentKinds: ["line"] },
    ...(index === 0 && selectedGeometry !== "plane" ? {} : { surfaceEvidence: { kind: "plane" as const,
      normal: bodyId === "link-body" ? linkFaceNormal
        : [1, 0, 0] as [number, number, number] } }),
  })));
  const tetra = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const positions = new Float32Array(request.document.bodies.flatMap(() => tetra.flat()));
  const localIndices = [0, 1, 2, 0, 1, 3, 0, 2, 3, 1, 2, 3];
  const indices = new Uint32Array(request.document.bodies.flatMap((_body, bodyIndex) =>
    localIndices.map((index) => index + bodyIndex * 4)));
  const semanticMesh = {
    positionsM: positions, normals: new Float32Array(positions.length), indices, faces,
    triangleFaceIndices: new Uint32Array(request.document.bodies.flatMap((_body, bodyIndex) =>
      [bodyIndex * 6, bodyIndex * 6, bodyIndex * 6, bodyIndex * 6])),
    edgePointsM: new Float32Array(), edgePointRanges: new Uint32Array(),
    edges: [], polylineEdgeIndices: new Uint32Array(),
  };
  const dynamics: BodyDynamicsPayload = { bodies: [...request.document.bodies]
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0).map(({ id: bodyId }) => ({
    bodyId, brep: { bytes: brepBytes.slice() }, volumeM3: 1,
    centerOfMassM: bodyId === "link-second-body" ? [2, 0, 0.5] : [0, 0, 0.5],
    centroidalInertiaUnitDensityKgM2: [1 / 6, 0, 0, 0, 1 / 6, 0, 0, 0, 1 / 6],
  })) };
  const results = await buildCadEvaluationResults(request, {
    featureIds: request.document.features.map(({ id }) => id), bodyIds: request.document.bodies.map(({ id }) => id),
    brep: { bytes: new Uint8Array([1]) }, semanticMesh, bodyDynamics: dynamics,
  });
  return { requestId: request.requestId, state: "succeeded" as const,
    sourceRevision: request.sourceRevision, requestedOutputs: [...request.requestedOutputs], results };
}
