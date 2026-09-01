import { defineDesignDocument, type DesignDocument } from "../../cad/document-schema";
import type { SemanticMeshPayload } from "../../cad/rebuild-payload";
import { createOcctCadAdapter } from "../../cad/kernel/occt-adapter";
import { defineCadEvaluationRequest, type CadEvaluationEvent, type CadKernelAdapter } from "../../cad/runtime-contracts";
import type { AssemblyVisualPart } from "../../viewer/render-envelope";
import { SE6_INSTANCE_GROUPS, se6Assembly } from "./cobot-assembly";
import { SE6_CATALOG } from "./cobot-catalog";
import {
  createSe6MechanismGeometry, SE6_DISPLAY_JOINT_ANCHORS_MM, SE6_JOINTS,
} from "./cobot-mechanism-geometry";
import {
  validateMechanismDisplayRegistration,
  type MechanismDisplayRegistration,
} from "./cobot-display-registration";
import { renderSe6Assembly } from "./cobot-visuals";

type CylinderEvidence = Readonly<{
  kind: "cylinder"; axis: readonly [number, number, number];
  originM: readonly [number, number, number]; radiusM: number;
}>;
export interface Se6JointEvidence {
  readonly jointId: string; readonly first: CylinderEvidence; readonly second: CylinderEvidence;
}
export interface Se6MechanismBenchmark {
  readonly document: DesignDocument;
  readonly visualParts: readonly AssemblyVisualPart[];
  readonly partBodyIds: Readonly<Record<string, string>>;
  readonly jointEvidence: readonly Se6JointEvidence[];
  readonly displayRegistration: MechanismDisplayRegistration;
}

async function discover(
  document: DesignDocument, signal: AbortSignal, adapter: CadKernelAdapter,
): Promise<SemanticMeshPayload> {
  const terminals: CadEvaluationEvent[] = [];
  await adapter.evaluate(await defineCadEvaluationRequest({
    requestId: "se6-mechanism-discovery", document, sourceRevision: document.revision,
    requestedOutputs: ["semantic-mesh"], settings: { gate: "mechanism-browser-v1" },
  }), signal, (event) => { if (event.state !== "progress") terminals.push(event); });
  if (terminals.length !== 1) throw new Error("SE-6 exact discovery emitted an invalid terminal sequence");
  const terminal = terminals[0]!;
  if (terminal.state !== "succeeded") throw new Error(terminal.state === "failed"
    ? `SE-6 exact discovery failed (${terminal.error.code}): ${terminal.error.message}`
    : "SE-6 exact discovery was cancelled");
  const mesh = terminal.results.find(({ output }) => output === "semantic-mesh");
  if (!mesh || mesh.output !== "semantic-mesh") throw new Error("SE-6 exact discovery omitted its semantic mesh");
  return mesh.payload;
}

const dot = (left: readonly number[], right: readonly number[]) =>
  left.reduce((sum, value, axis) => sum + value * right[axis]!, 0);
function cylinderFace(mesh: SemanticMeshPayload, bodyId: string, axis: readonly number[]) {
  const faces = mesh.faces.filter((face) => face.bodyId === bodyId
    && face.surfaceEvidence?.kind === "cylinder"
    && Math.abs(dot(face.surfaceEvidence.axis, axis)) >= 1 - 1e-9);
  if (faces.length !== 1 || faces[0]!.surfaceEvidence?.kind !== "cylinder") {
    throw new Error(`SE-6 exact cylindrical joint face is unresolved: ${bodyId}`);
  }
  return faces[0]! as typeof faces[number] & { surfaceEvidence: CylinderEvidence };
}
const reference = (face: SemanticMeshPayload["faces"][number]) => ({
  bodyId: face.bodyId, ownerFeatureId: face.signature.ownerFeatureId,
  expectedKind: "face" as const, stableId: face.id,
  signature: { geometry: face.signature.geometry,
    centroidM: [...face.signature.centroidM] as [number, number, number],
    measureSI: face.signature.measureSI, adjacentKinds: [...face.signature.adjacentKinds] },
});

function collisionGroups() {
  return ["base", "axis-1", "axis-2", "axis-3", "axis-4", "axis-5", "axis-6"].map((id, index, ids) => {
    let filterMask = 0;
    ids.forEach((_candidate, other) => { if (Math.abs(other - index) > 1) filterMask |= 1 << other; });
    return { id: `${id}-collision`, instanceIds: [id], membershipMask: 1 << index, filterMask };
  });
}

function visualOwnership(parts: readonly AssemblyVisualPart[]): Readonly<Record<string, string>> {
  const ownership: Record<string, string> = {};
  const assign = (bodyId: string, ids: readonly string[]) => ids.forEach((id) => { ownership[id] = bodyId; });
  assign("base", SE6_INSTANCE_GROUPS.base);
  assign("axis-1", [...SE6_INSTANCE_GROUPS.shoulder, "cable-segment-shoulder"]);
  assign("axis-2", [...SE6_INSTANCE_GROUPS.upperArm, "cable-segment-upper"]);
  assign("axis-3", [...SE6_INSTANCE_GROUPS.forearm, "cable-segment-elbow"]);
  assign("axis-4", [...SE6_INSTANCE_GROUPS.wrist.filter((id) => id.startsWith("j4-")), "cable-segment-wrist"]);
  assign("axis-5", SE6_INSTANCE_GROUPS.wrist.filter((id) => id.startsWith("j5-")));
  assign("axis-6", [...SE6_INSTANCE_GROUPS.wrist.filter((id) => id.startsWith("j6-")),
    ...SE6_INSTANCE_GROUPS.tooling, "wrist-strain-relief"]);
  const missing = parts.filter(({ selectionId }) => ownership[selectionId] === undefined);
  if (missing.length > 0 || Object.keys(ownership).length !== parts.length) {
    throw new Error(`SE-6 mechanism visual ownership is incomplete: ${missing.map(({ selectionId }) => selectionId).join(", ")}`);
  }
  return Object.freeze(ownership);
}

function displayRegistration(): MechanismDisplayRegistration {
  const registration = Object.freeze({ jointAnchors: Object.freeze(SE6_JOINTS.map((joint, index) => Object.freeze({
    jointId: joint.id, firstBodyId: joint.first, secondBodyId: joint.second,
    exactAnchorM: joint.anchor,
    displayAnchorMm: SE6_DISPLAY_JOINT_ANCHORS_MM[index]!,
  }))) });
  validateMechanismDisplayRegistration(registration);
  return registration;
}

export async function buildSe6MechanismBenchmark(
  signal: AbortSignal, adapter?: CadKernelAdapter,
  createAdapter: () => CadKernelAdapter = createOcctCadAdapter,
): Promise<Se6MechanismBenchmark> {
  const owned = adapter === undefined, activeAdapter = adapter ?? createAdapter();
  try {
    const geometry = await createSe6MechanismGeometry();
    const mesh = await discover(geometry, signal, activeAdapter);
    const namedSelections = [], mates = [], jointEvidence: Se6JointEvidence[] = [];
    for (const joint of SE6_JOINTS) {
      const first = cylinderFace(mesh, `${joint.id}-first-interface-body`, joint.axis);
      const second = cylinderFace(mesh, `${joint.id}-second-interface-body`, joint.axis);
      const firstSelectionId = `${joint.id}-first-cylinder`, secondSelectionId = `${joint.id}-second-cylinder`;
      namedSelections.push({ id: firstSelectionId, reference: reference(first) },
        { id: secondSelectionId, reference: reference(second) });
      mates.push({ id: joint.id, kind: "revolute" as const, firstInstanceId: joint.first,
        secondInstanceId: joint.second, firstSelectionId, secondSelectionId,
        axisFirstLocal: [...joint.axis], lowerRad: joint.limits[0], upperRad: joint.limits[1] });
      jointEvidence.push({ jointId: joint.id, first: first.surfaceEvidence, second: second.surfaceEvidence });
    }
    const { revision: _revision, ...content } = geometry;
    const ids = ["base", "axis-1", "axis-2", "axis-3", "axis-4", "axis-5", "axis-6"];
    const document = await defineDesignDocument({
      ...content, namedSelections, mates,
      materials: [{ id: "aluminum", kind: "isotropic", densityKgM3: 2_700,
        youngsModulusPa: 69e9, poissonRatio: .33, failureStressPa: 276e6 }],
      studies: [{ id: "se6-motion", kind: "mechanism", instanceIds: ids,
        mateIds: SE6_JOINTS.map(({ id }) => id), configurationState: "configured",
        fixedInstanceIds: ["base"], materialAssignments: ids.map((instanceId) => ({ instanceId, materialId: "aluminum" })),
        gravityWorldMps2: [0, 0, -.05],
        pointForces: [{ instanceId: "axis-6", pointLocalM: [.94, .05, .45], forceWorldN: [0, 0, -.1] }],
        maximumCollisionApproximationErrorM: 2e-4, initialOverlapPolicy: "reject-any-positive-volume",
        durationSteps: 240, outputStrideSteps: 4, collisionGroups: collisionGroups(),
        clearancePairs: ids.slice(0, -2).map((firstInstanceId, index) => ({
          id: `clearance-${index + 1}-${index + 3}`, firstInstanceId, secondInstanceId: ids[index + 2]!,
        })) }],
    });
    const visualParts = renderSe6Assembly(se6Assembly, SE6_CATALOG, {})
      .filter(({ appearance }) => appearance === "component");
    return Object.freeze({ document, visualParts, partBodyIds: visualOwnership(visualParts),
      jointEvidence: Object.freeze(jointEvidence), displayRegistration: displayRegistration() });
  } finally {
    if (owned) activeAdapter.dispose?.();
  }
}
