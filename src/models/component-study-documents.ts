import { defineDesignDocument, type DesignDocument } from "../cad/document-schema";
import { applyPoint, resolveDocumentFrame } from "../cad/rigid-transform";
import {
  COBOT_THERMAL_CONDUCTIVITY_W_MK, COBOT_THERMAL_HEAT_FLUX_WM2,
  COBOT_THERMAL_MOUNT_TEMPERATURE_K,
} from "../samples/cobot/cobot-thermal-contract";

type FaceAxis = 0 | 1 | 2;
type FaceSpec = Readonly<{ id: string; axis: FaceAxis; side: -1 | 1 }>;
type Point = readonly [number, number, number];
type DroneStudyIntent = Readonly<{
  bodyId: string;
  supports: readonly Readonly<{ id: string; region: unknown }>[];
  loads: readonly Readonly<{ region: unknown; forceN: readonly number[] }>[];
  protectedInterfaces: readonly Readonly<{ id: string; mount: unknown }>[];
}>;

function literal(value: number | { readonly parameterId: string }): number {
  if (typeof value !== "number") throw new Error("Component study faces require literal geometry");
  return value;
}

function boxFaceSelections(
  document: DesignDocument, bodyId: string, faces: readonly FaceSpec[],
) {
  const body = document.bodies.find(({ id }) => id === bodyId);
  const feature = body && document.features.find(({ id }) => id === body.featureId);
  const sketch = feature?.kind === "extrude"
    ? document.sketches.find(({ id }) => id === feature.sketchId) : undefined;
  const rectangle = sketch?.entities.length === 1 ? sketch.entities[0] : undefined;
  if (!body || !feature || feature.kind !== "extrude" || !sketch || rectangle?.kind !== "rectangle") {
    throw new Error(`Component study body is not a box extrusion: ${bodyId}`);
  }
  const dimensions = [literal(rectangle.sizeM[0]), literal(rectangle.sizeM[1]), literal(feature.distanceM)] as const;
  const center = [literal(rectangle.centerM[0]), literal(rectangle.centerM[1]), dimensions[2] / 2] as [number, number, number];
  const frame = resolveDocumentFrame(document, sketch.plane.slice("frame:".length));
  return faces.map(({ id, axis, side }) => {
    const local = [...center] as [number, number, number];
    local[axis] += side * dimensions[axis] / 2;
    const other = [0, 1, 2].filter((value) => value !== axis) as [FaceAxis, FaceAxis];
    return { id, reference: {
      bodyId, ownerFeatureId: feature.id, expectedKind: "face" as const,
      signature: { geometry: "plane" as const, centroidM: applyPoint(frame, local),
        measureSI: dimensions[other[0]] * dimensions[other[1]],
        adjacentKinds: ["plane", "plane", "plane", "plane"] },
    } };
  });
}

function point(value: unknown, label: string): Point {
  if (Array.isArray(value) && value.length === 3
    && value.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
    return value as unknown as Point;
  }
  if (value && typeof value === "object") {
    const coordinates = ["x", "y", "z"].map((axis) => {
      const coordinate = (value as Record<string, unknown>)[axis];
      return coordinate && typeof coordinate === "object"
        ? (coordinate as { value?: unknown }).value : undefined;
    });
    if (coordinates.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
      return coordinates as unknown as Point;
    }
  }
  throw new Error(`Drone study ${label} lacks a finite source position`);
}

function sourceCenter(value: unknown, label: string): Point {
  if (!value || typeof value !== "object") throw new Error(`Drone study ${label} is unresolved`);
  const source = value as Record<string, unknown>;
  return point(source.centerM ?? source.center ?? source.position, label);
}

function faceToward(
  document: DesignDocument, bodyId: string, id: string, sourcePosition: Point,
): FaceSpec {
  const body = document.bodies.find((candidate) => candidate.id === bodyId);
  const feature = body && document.features.find((candidate) => candidate.id === body.featureId);
  const sketch = feature?.kind === "extrude"
    ? document.sketches.find((candidate) => candidate.id === feature.sketchId) : undefined;
  const rectangle = sketch?.entities.length === 1 ? sketch.entities[0] : undefined;
  if (!feature || feature.kind !== "extrude" || !sketch || rectangle?.kind !== "rectangle") {
    throw new Error(`Drone study body is not a box extrusion: ${bodyId}`);
  }
  const dimensions = [literal(rectangle.sizeM[0]), literal(rectangle.sizeM[1]), literal(feature.distanceM)] as const;
  const localCenter = [literal(rectangle.centerM[0]), literal(rectangle.centerM[1]), dimensions[2] / 2] as Point;
  const center = applyPoint(resolveDocumentFrame(document, sketch.plane.slice("frame:".length)), localCenter);
  const ranked = ([2, 1, 0] as const).map((axis) => ({ axis,
    score: Math.abs(sourcePosition[axis] - center[axis]) / dimensions[axis] }));
  const axis = ranked.sort((left, right) => right.score - left.score)[0]!.axis;
  return { id, axis, side: sourcePosition[axis] < center[axis] ? -1 : 1 };
}

const content = (document: DesignDocument) => {
  const { revision: _revision, ...value } = document;
  return value;
};

export async function withDroneComponentStudies(
  document: DesignDocument, intent: DroneStudyIntent,
): Promise<DesignDocument> {
  if (intent.supports.length !== 1 || intent.loads.length !== 1) {
    throw new Error("Drone component study requires one retained support and load region");
  }
  const instanceId = intent.bodyId.slice(0, -"-body".length);
  const protectedInterfaces = intent.protectedInterfaces
    .filter(({ id }) => id.startsWith(`${instanceId}-`));
  if (protectedInterfaces.length === 0) {
    throw new Error("Drone component study has no retained interface on its exact body");
  }
  const support = intent.supports[0]!, load = intent.loads[0]!;
  const loadRegion = load.region as { id?: unknown };
  if (typeof loadRegion.id !== "string") throw new Error("Drone load region requires a canonical ID");
  sourceCenter(support.region, "support");
  const loadFace = faceToward(
    document, intent.bodyId, loadRegion.id, sourceCenter(load.region, "load region"),
  );
  const specs = [
    { id: support.id, axis: loadFace.axis, side: -loadFace.side as -1 | 1 },
    loadFace,
    ...protectedInterfaces.map(({ id, mount }) =>
      faceToward(document, intent.bodyId, id, sourceCenter(mount, `interface ${id}`))),
  ];
  const selections = boxFaceSelections(document, intent.bodyId, specs);
  const requiredSelectionIds = protectedInterfaces.map(({ id }) => id);
  return defineDesignDocument({ ...content(document), namedSelections: selections,
    studies: [{ id: "drone-arm-structural", kind: "structural-linear",
      bodyIds: [intent.bodyId], materialId: document.materials[0]!.id,
      supports: [support.id], loads: [{ selectionId: loadRegion.id, forceN: load.forceN }] },
    { id: "drone-arm-topology", kind: "topology", sourceStudyId: "drone-arm-structural",
      configurationState: "configured", objective: "minimum-compliance",
      targetVolumeFraction: .35, moveLimit: .2, filterRadiusM: .0012,
      minimumFeatureM: .0012, maxIterations: 32,
      extraction: { isoValue: .5, toleranceM: .0003 }, requiredSelectionIds,
      protectedVoidSelectionIds: [],
      acceptance: { maximumDisplacementM: .0015,
        maximumVonMisesStressPa: document.materials[0]!.failureStressPa,
        minimumSafetyFactor: 1, maximumMaterialFraction: .35 } }],
  });
}

export async function withUpperArmThermalStudy(document: DesignDocument): Promise<DesignDocument> {
  const bodyId = "upper-arm-housing-body";
  const selections = boxFaceSelections(document, bodyId, [
    { id: "mounting-interface", axis: 0, side: -1 },
    { id: "motor-interface", axis: 0, side: 1 },
  ]);
  return defineDesignDocument({ ...content(document), namedSelections: selections,
    materials: document.materials.map((material) => ({
      ...material, thermalConductivityWmK: COBOT_THERMAL_CONDUCTIVITY_W_MK,
    })),
    studies: [{ id: "se6-upper-arm-thermal", kind: "thermal-steady", bodyIds: [bodyId],
      materialId: document.materials[0]!.id, boundaries: {
        temperatures: [{ selectionId: "mounting-interface",
          temperatureK: COBOT_THERMAL_MOUNT_TEMPERATURE_K }],
        heatFluxes: [{ selectionId: "motor-interface", heatFluxWm2: COBOT_THERMAL_HEAT_FLUX_WM2 }],
      } }],
  });
}

export async function withSe6MechanismStudy(document: DesignDocument): Promise<DesignDocument> {
  return defineDesignDocument({ ...content(document), studies: [{
    id: "se6-motion", kind: "mechanism",
    instanceIds: document.instances.map(({ id }) => id), mateIds: [],
    configurationState: "requires-configuration",
  }] });
}
