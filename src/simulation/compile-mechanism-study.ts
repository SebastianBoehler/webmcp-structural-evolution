import type { ArtifactRecord } from "../cad/artifact-contract";
import { defineDesignDocument, type DesignDocument } from "../cad/document-schema";
import { resolveNamedSelections } from "../cad/kernel/named-selection-resolution";
import {
  applyDirection, applyPoint, inverseTransform, quaternionFromMatrix,
  resolveDocumentFrame, transpose, type RigidTransform, type Vec3Tuple,
} from "../cad/rigid-transform";
import { revisionId } from "../domain/revisions";
import { freezeSnapshot, type DeepReadonly } from "../domain/snapshots";
import { compileCollisionShape } from "./collision-approximation";
import {
  defineMechanismInput, MECHANISM_MAX_CLEARANCE_SAMPLES, type MechanismInput,
} from "./mechanism-contract";
import { rebuildMechanismExactSource } from "./mechanism-exact-source";
import { assertPrimitiveDynamics, exactPrimitiveOrConvexProof, indexBodyMeshes } from "./mechanism-geometry";
import { combineMassProperties, diagonalizeInertia } from "./mechanism-inertia";
import { canonicalPair, codeUnitCompare, MechanismDirectionSchema } from "./mechanism-math";
import { checkExactInitialOverlaps } from "./mechanism-overlap";

const MATE_ANCHOR_TOLERANCE_M = 1e-8;
const MAX_CLEARANCE_PAIRS = 512;
const abort = (signal: AbortSignal) => {
  if (signal.aborted) throw new DOMException("Mechanism compilation was cancelled", "AbortError");
};
const byId = <Entry extends { id: string }>(values: readonly Entry[]) =>
  [...values].sort((left, right) => codeUnitCompare(left.id, right.id));
const colliderId = async (instanceId: string, bodyId: string) =>
  `collider-${(await revisionId({ instanceId, bodyId })).slice(0, 32)}`;
const pairId = async (queryId: string, firstColliderId: string, secondColliderId: string) =>
  `clearance-${(await revisionId({ queryId, firstColliderId, secondColliderId })).slice(0, 32)}`;
const requireEntity = <Entry extends { readonly id: string }>(values: readonly Entry[], id: string, label: string) => {
  const value = values.find((entry) => entry.id === id);
  if (!value) throw new Error(`${label} is unresolved: ${id}`);
  return value;
};

export type CompiledMechanismStudy = DeepReadonly<{
  readonly input: MechanismInput;
  readonly sourceArtifacts: readonly [ArtifactRecord, ArtifactRecord];
}>;
const exactCompiledStudies = new WeakSet<object>();

export function defineCompiledMechanismStudy(
  input: MechanismInput, sourceArtifacts: readonly [ArtifactRecord, ArtifactRecord],
): CompiledMechanismStudy {
  const artifacts = [...sourceArtifacts].sort((left, right) => codeUnitCompare(left.id, right.id));
  const compiled = freezeSnapshot({ input, sourceArtifacts: artifacts as [ArtifactRecord, ArtifactRecord] });
  exactCompiledStudies.add(compiled);
  return compiled;
}

export function assertCompiledMechanismStudy(value: unknown): CompiledMechanismStudy {
  if (!value || typeof value !== "object" || !exactCompiledStudies.has(value)) {
    throw new Error("Mechanism solver requires in-process exact compiler authority");
  }
  return value as CompiledMechanismStudy;
}

export async function compileMechanismStudy(
  document: DesignDocument,
  studyId: string,
  signal: AbortSignal,
): Promise<CompiledMechanismStudy> {
  abort(signal);
  const canonical = await defineDesignDocument(document);
  abort(signal);
  const study = canonical.studies.find(({ id }) => id === studyId);
  if (!study || study.kind !== "mechanism") throw new Error(`Mechanism study is unresolved: ${studyId}`);
  if (study.configurationState !== "configured") throw new Error(`Mechanism study requires configuration: ${studyId}`);
  const instances = byId(study.instanceIds.map((id) => requireEntity(canonical.instances, id, "Mechanism instance")));
  const components = new Map(instances.map((instance) => [instance.id,
    requireEntity(canonical.components, instance.componentId, "Mechanism component")]));
  const placedColliderCount = instances.reduce((sum, instance) => sum + components.get(instance.id)!.bodyIds.length, 0);
  if (placedColliderCount > 512) throw new Error("Mechanism placed-collider budget exceeded");
  abort(signal);
  const exact = await rebuildMechanismExactSource(canonical, signal);
  abort(signal);
  const bodyDynamics = exact.bodyDynamics;
  const semanticMesh = exact.semanticMeshPayload;
  const dynamics = new Map(bodyDynamics.bodies.map((body) => [body.bodyId, body]));
  const facesByBody = new Map([...new Set(semanticMesh.faces.map(({ bodyId }) => bodyId))]
    .map((bodyId) => [bodyId, semanticMesh.faces.filter((face) => face.bodyId === bodyId)]));
  const studyBodyIds = [...new Set(instances.flatMap((instance) =>
    components.get(instance.id)!.bodyIds))].sort(codeUnitCompare);
  const meshes = indexBodyMeshes(semanticMesh, studyBodyIds);
  abort(signal);
  const materials = new Map(canonical.materials.map((material) => [material.id, material]));
  const assignments = new Map(study.materialAssignments.map((value) => [value.instanceId, value.materialId]));
  const groups = new Map(study.collisionGroups.flatMap((group) =>
    group.instanceIds.map((instanceId) => [instanceId, group] as const)));
  const transforms = new Map(instances.map((instance) => [instance.id, resolveDocumentFrame(canonical, instance.frameId)]));
  const bodyColliders = new Map<string, string[]>();
  const bodies: unknown[] = [], colliders: unknown[] = [];
  const overlapInputs = [];
  for (const instance of instances) {
    abort(signal);
    const component = components.get(instance.id)!;
    const sourceBodyIds = [...component.bodyIds].sort(codeUnitCompare);
    const transform = transforms.get(instance.id)!;
    const group = groups.get(instance.id);
    if (!group) throw new Error(`Mechanism collision group is unresolved: ${instance.id}`);
    const kind = study.fixedInstanceIds.includes(instance.id) ? "fixed" as const : "dynamic" as const;
    const material = materials.get(assignments.get(instance.id) ?? "");
    if (!material) throw new Error(`Mechanism material is unresolved: ${instance.id}`);
    const runtimeTransform = { positionM: transform.positionM, orientation: quaternionFromMatrix(transform.rotation) };
    if (kind === "fixed") bodies.push({ id: instance.id, kind, sourceBodyIds, transform: runtimeTransform });
    else {
      const parts = sourceBodyIds.map((bodyId) => {
        const source = dynamics.get(bodyId);
        if (!source) throw new Error(`Exact body dynamics is unresolved: ${bodyId}`);
        return { massKg: source.volumeM3 * material.densityKgM3, centerOfMassM: source.centerOfMassM,
          centroidalInertiaKgM2: source.centroidalInertiaUnitDensityKgM2.map((value) =>
            value * material.densityKgM3) as never };
      });
      const aggregate = combineMassProperties(parts);
      bodies.push({ id: instance.id, kind, sourceBodyIds, transform: runtimeTransform,
        massKg: aggregate.massKg, centerOfMassM: aggregate.centerOfMassM,
        ...diagonalizeInertia(aggregate.centroidalInertiaKgM2),
        initialLinearVelocityMps: [0, 0, 0], initialAngularVelocityRadS: [0, 0, 0] });
    }
    const ids: string[] = [];
    for (const bodyId of sourceBodyIds) {
      const source = dynamics.get(bodyId);
      if (!source) throw new Error(`Exact body dynamics is unresolved: ${bodyId}`);
      const id = await colliderId(instance.id, bodyId);
      abort(signal);
      const proof = exactPrimitiveOrConvexProof(canonical, bodyId);
      assertPrimitiveDynamics(proof, source, facesByBody.get(bodyId) ?? []);
      const collision = compileCollisionShape({ bodyKind: kind,
        toleranceM: study.maximumCollisionApproximationErrorM,
        mesh: meshes.get(bodyId)!, ...proof });
      abort(signal);
      colliders.push({ id, bodyId: instance.id, sourceBodyId: bodyId,
        sourceArtifactIds: [exact.brepArtifact.id, exact.semanticArtifact.id], ...collision,
        membershipMask: group.membershipMask, filterMask: group.filterMask });
      ids.push(id);
    }
    bodyColliders.set(instance.id, ids.sort(codeUnitCompare));
    overlapInputs.push({ instanceId: instance.id, membershipMask: group.membershipMask,
      filterMask: group.filterMask, transform,
      bodyIds: sourceBodyIds });
  }
  const overlapSources = studyBodyIds.map((bodyId) => {
    const source = dynamics.get(bodyId);
    if (!source) throw new Error(`Exact overlap body is unresolved: ${bodyId}`);
    return { bodyId, brepBytes: source.brep.bytes };
  });
  await checkExactInitialOverlaps(overlapSources, overlapInputs, signal);
  abort(signal);
  const selectedMates = byId(study.mateIds.map((id) => requireEntity(canonical.mates, id, "Mechanism mate")));
  const selectionIds = new Set(selectedMates.flatMap((mate) => [mate.firstSelectionId, mate.secondSelectionId]));
  const selectionDocument = { mates: selectedMates,
    namedSelections: canonical.namedSelections.filter(({ id }) => selectionIds.has(id)) };
  if (selectionDocument.namedSelections.some(({ reference }) => reference.expectedKind !== "face")) {
    throw new Error("Mechanism mate endpoints must resolve to exact semantic faces");
  }
  const resolved = resolveNamedSelections(selectionDocument,
    [...semanticMesh.faces, ...semanticMesh.edges]);
  const topology = new Map([...semanticMesh.faces, ...semanticMesh.edges].map((value) => [value.id, value]));
  const selectedTopology = new Map(resolved.map(({ selectionId, topologyId }) => {
    const selection = requireEntity(selectionDocument.namedSelections, selectionId, "Mechanism named selection");
    const exactTopology = topology.get(topologyId);
    if (!exactTopology || exactTopology.bodyId !== selection.reference.bodyId) {
      throw new Error(`Mechanism mate selection resolved to the wrong exact body: ${selectionId}`);
    }
    return [selectionId, exactTopology] as const;
  }));
  const joints = selectedMates.map((mate) => compileJoint(mate, transforms, selectedTopology));
  const pointForces = study.pointForces.map((force) => ({ bodyId: force.instanceId,
    pointLocalM: force.pointLocalM, forceWorldN: force.forceWorldN }));
  const clearancePairs = [];
  for (const query of byId(study.clearancePairs)) {
    const first = bodyColliders.get(query.firstInstanceId)!, second = bodyColliders.get(query.secondInstanceId)!;
    if (clearancePairs.length + first.length * second.length > MAX_CLEARANCE_PAIRS) {
      throw new Error("Mechanism clearance collider-pair budget exceeded");
    }
    for (const firstColliderId of first) for (const secondColliderId of second) {
      const [canonicalFirst, canonicalSecond] = canonicalPair(firstColliderId, secondColliderId);
      const id = await pairId(query.id, canonicalFirst, canonicalSecond);
      abort(signal);
      clearancePairs.push({ id, sourceQueryId: query.id,
        firstColliderId: canonicalFirst, secondColliderId: canonicalSecond });
    }
  }
  const frames = study.durationSteps / study.outputStrideSteps + 1;
  if (frames * clearancePairs.length > MECHANISM_MAX_CLEARANCE_SAMPLES) {
    throw new Error("Mechanism replay clearance-sample budget exceeded before expansion");
  }
  const input = await defineMechanismInput({ sourceRevision: canonical.revision, studyId,
    bodies, colliders, joints, gravityWorldMps2: study.gravityWorldMps2, pointForces,
    durationSteps: study.durationSteps, outputStrideSteps: study.outputStrideSteps, clearancePairs });
  abort(signal);
  return defineCompiledMechanismStudy(input, [exact.brepArtifact, exact.semanticArtifact]);
}

function compileJoint(
  mate: DesignDocument["mates"][number],
  transforms: ReadonlyMap<string, RigidTransform>,
  topology: ReadonlyMap<string, { readonly surfaceEvidence?:
    | { readonly kind: "plane"; readonly normal: Vec3Tuple }
    | { readonly kind: "cylinder"; readonly axis: Vec3Tuple; readonly originM: Vec3Tuple; readonly radiusM: number };
    readonly signature: {
    readonly centroidM: Vec3Tuple; readonly geometry: "plane" | "cylinder" | "cone" | "sphere" | "curve" | "other";
  } }>,
) {
  const first = transforms.get(mate.firstInstanceId)!, second = transforms.get(mate.secondInstanceId)!;
  const firstTopology = topology.get(mate.firstSelectionId), secondTopology = topology.get(mate.secondSelectionId);
  if (!firstTopology || !secondTopology) throw new Error(`Mechanism mate selection is unresolved: ${mate.id}`);
  if (mate.kind === "rigid") {
    const firstAnchorLocalM = firstTopology.signature.centroidM;
    const secondAnchorLocalM = secondTopology.signature.centroidM;
    assertCoincidentAnchors(mate.id, first, second, firstAnchorLocalM, secondAnchorLocalM);
    return { id: mate.id, firstBodyId: mate.firstInstanceId, secondBodyId: mate.secondInstanceId,
      kind: mate.kind, firstAnchorLocalM, secondAnchorLocalM,
      firstFrameOrientationBody: quaternionFromMatrix(transpose(first.rotation)),
      secondFrameOrientationBody: quaternionFromMatrix(transpose(second.rotation)) };
  }
  const firstAxisEvidence = exactSurfaceAxis(firstTopology, mate.id);
  const secondAxisEvidence = exactSurfaceAxis(secondTopology, mate.id);
  const firstAnchorLocalM = firstTopology.surfaceEvidence?.kind === "cylinder"
    ? firstTopology.surfaceEvidence.originM : firstTopology.signature.centroidM;
  const secondAnchorLocalM = secondTopology.surfaceEvidence?.kind === "cylinder"
    ? secondTopology.surfaceEvidence.originM : secondTopology.signature.centroidM;
  assertCoincidentAnchors(mate.id, first, second, firstAnchorLocalM, secondAnchorLocalM);
  const common = { id: mate.id, firstBodyId: mate.firstInstanceId, secondBodyId: mate.secondInstanceId,
    firstAnchorLocalM, secondAnchorLocalM };
  const firstAxisLocal = MechanismDirectionSchema.parse(mate.axisFirstLocal);
  const worldAxis = applyDirection(first, firstAxisLocal);
  const secondAxisLocal = MechanismDirectionSchema.parse(applyDirection(inverseTransform(second), worldAxis));
  if (!parallel(firstAxisLocal, firstAxisEvidence) || !parallel(secondAxisLocal, secondAxisEvidence)) {
    throw new Error(`Mechanism mate intent axis does not match exact face geometry: ${mate.id}`);
  }
  return mate.kind === "revolute"
    ? { ...common, kind: mate.kind, firstAxisLocal, secondAxisLocal,
      lowerRad: mate.lowerRad, upperRad: mate.upperRad }
    : { ...common, kind: mate.kind, firstAxisLocal, secondAxisLocal,
      lowerM: mate.lowerM, upperM: mate.upperM };
}

function assertCoincidentAnchors(
  mateId: string, first: RigidTransform, second: RigidTransform,
  firstAnchorLocalM: Vec3Tuple, secondAnchorLocalM: Vec3Tuple,
): void {
  const firstWorld = applyPoint(first, firstAnchorLocalM), secondWorld = applyPoint(second, secondAnchorLocalM);
  if (Math.hypot(...firstWorld.map((value, index) => value - secondWorld[index]!)) > MATE_ANCHOR_TOLERANCE_M) {
    throw new Error(`Mechanism mate anchors do not coincide: ${mateId}`);
  }
}

function exactSurfaceAxis(
  topology: { readonly signature: { readonly geometry: string }; readonly surfaceEvidence?:
    | { readonly kind: "plane"; readonly normal: Vec3Tuple }
    | { readonly kind: "cylinder"; readonly axis: Vec3Tuple } },
  mateId: string,
): Vec3Tuple {
  const evidence = topology.surfaceEvidence;
  if (!evidence || evidence.kind !== topology.signature.geometry) {
    throw new Error(`Mechanism mate requires exact planar or cylindrical face evidence: ${mateId}`);
  }
  return MechanismDirectionSchema.parse(evidence.kind === "plane" ? evidence.normal : evidence.axis);
}

const parallel = (first: Vec3Tuple, second: Vec3Tuple) =>
  Math.abs(first[0] * second[0] + first[1] * second[1] + first[2] * second[2]) >= 1 - 1e-9;
