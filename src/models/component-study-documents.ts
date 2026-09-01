import { defineDesignDocument, type DesignDocument } from "../cad/document-schema";
import { applyPoint, resolveDocumentFrame } from "../cad/rigid-transform";
import {
  COBOT_THERMAL_CONDUCTIVITY_W_MK, COBOT_THERMAL_HEAT_FLUX_WM2,
  COBOT_THERMAL_MOUNT_TEMPERATURE_K,
} from "../samples/cobot/cobot-thermal-contract";

type FaceAxis = 0 | 1 | 2;
type FaceSpec = Readonly<{ id: string; axis: FaceAxis; side: -1 | 1 }>;

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

const content = (document: DesignDocument) => {
  const { revision: _revision, ...value } = document;
  return value;
};

export async function withDroneComponentStudies(
  document: DesignDocument, forceN: readonly number[],
): Promise<DesignDocument> {
  const bodyId = "body-interface-body";
  const selections = boxFaceSelections(document, bodyId, [
    { id: "body-fixed-region", axis: 2, side: -1 },
    { id: "body-mount-north", axis: 1, side: 1 },
    { id: "body-mount-south", axis: 1, side: -1 },
    { id: "motor-thrust-load", axis: 0, side: 1 },
  ]);
  return defineDesignDocument({ ...content(document), namedSelections: selections,
    studies: [{ id: "drone-arm-structural", kind: "structural-linear",
      bodyIds: [bodyId], materialId: document.materials[0]!.id,
      supports: selections.slice(0, 3).map(({ id }) => id),
      loads: [{ selectionId: selections[3]!.id, forceN }] },
    { id: "drone-arm-topology", kind: "topology", sourceStudyId: "drone-arm-structural",
      configurationState: "configured", objective: "minimum-compliance",
      targetVolumeFraction: .35, moveLimit: .2, filterRadiusM: .0012,
      minimumFeatureM: .0012, maxIterations: 32,
      extraction: { isoValue: .5, toleranceM: .0003 }, protectedVoidSelectionIds: [],
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
