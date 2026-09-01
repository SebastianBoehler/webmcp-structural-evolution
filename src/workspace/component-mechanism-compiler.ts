import { revisionId } from "../domain/revisions";
import type { AuthoritativeComponentDocument } from "../models/component-documents";
import { compileCollisionShape } from "../simulation/collision-approximation";
import { defineCompiledMechanismStudy } from "../simulation/compile-mechanism-study";
import { defineMechanismInput } from "../simulation/mechanism-contract";
import {
  assertPrimitiveDynamics, exactPrimitiveOrConvexProof, indexBodyMeshes,
} from "../simulation/mechanism-geometry";
import { combineMassProperties, diagonalizeInertia } from "../simulation/mechanism-inertia";
import type { ExactComponentSource } from "./exact-component-source";

const identity = { positionM: [0, 0, 0] as const, orientation: [0, 0, 0, 1] as const };
const stageIds = ["base", "axis-1", "axis-2", "axis-3", "axis-4", "axis-5", "axis-6"] as const;

function collisionMasks(stage: number) {
  let filterMask = 0;
  for (let other = 0; other < stageIds.length; other += 1) {
    if (Math.abs(other - stage) > 1) filterMask |= 1 << other;
  }
  return { membershipMask: 1 << stage, filterMask };
}

export async function compileExactComponentMechanism(
  model: AuthoritativeComponentDocument, exact: ExactComponentSource,
) {
  if (exact.sourceRevision !== model.document.revision
    || Object.keys(model.stages).length !== stageIds.length
    || model.joints.length !== stageIds.length - 1) {
    throw new Error("SE-6 mechanism source does not match its active exact component revision");
  }
  const dynamics = new Map(exact.bodyDynamics.bodies.map((body) => [body.bodyId, body]));
  const bodyIds = Object.values(model.stages).flat().map((id) => `${id}-body`);
  if (bodyIds.length !== 52 || new Set(bodyIds).size !== 52
    || bodyIds.some((id) => !dynamics.has(id) || model.bodyMassKg[id] === undefined)) {
    throw new Error("SE-6 exact body dynamics and mass ownership must cover all 52 parts");
  }
  const meshes = indexBodyMeshes(exact.semanticMeshPayload, bodyIds);
  const faces = new Map(bodyIds.map((id) => [id,
    exact.semanticMeshPayload.faces.filter(({ bodyId }) => bodyId === id)]));
  const bodies = [], colliders: Array<ReturnType<typeof compileCollisionShape> & Readonly<{
    id: string; bodyId: string; sourceBodyId: string; sourceArtifactIds: readonly string[];
    membershipMask: number; filterMask: number;
  }>> = [];
  for (const [stageIndex, stageId] of stageIds.entries()) {
    const sourceBodyIds = model.stages[stageId]!.map((id) => `${id}-body`).sort();
    const kind = stageIndex === 0 ? "fixed" as const : "dynamic" as const;
    const parts = sourceBodyIds.map((bodyId) => {
      const source = dynamics.get(bodyId)!;
      const density = model.bodyMassKg[bodyId]! / source.volumeM3;
      return { massKg: model.bodyMassKg[bodyId]!, centerOfMassM: source.centerOfMassM,
        centroidalInertiaKgM2: source.centroidalInertiaUnitDensityKgM2
          .map((value) => value * density) as never };
    });
    if (kind === "fixed") bodies.push({ id: stageId, kind, sourceBodyIds, transform: identity });
    else {
      const aggregate = combineMassProperties(parts);
      bodies.push({ id: stageId, kind, sourceBodyIds, transform: identity,
        massKg: aggregate.massKg, centerOfMassM: aggregate.centerOfMassM,
        ...diagonalizeInertia(aggregate.centroidalInertiaKgM2),
        initialLinearVelocityMps: [0, 0, 0], initialAngularVelocityRadS: [0, 0, 0] });
    }
    for (const bodyId of sourceBodyIds) {
      const proof = exactPrimitiveOrConvexProof(model.document, bodyId);
      assertPrimitiveDynamics(proof, dynamics.get(bodyId)!, faces.get(bodyId)!);
      const collision = compileCollisionShape({ bodyKind: kind, toleranceM: 2e-4,
        mesh: meshes.get(bodyId)!, ...proof });
      colliders.push({ id: `collider-${(await revisionId({ stageId, bodyId })).slice(0, 32)}`,
        bodyId: stageId, sourceBodyId: bodyId,
        sourceArtifactIds: [...exact.artifacts, exact.bodyDynamicsArtifact].map(({ id }) => id), ...collision,
        ...collisionMasks(stageIndex) });
    }
  }
  const joints = model.joints.map((joint) => ({
    id: joint.id, firstBodyId: joint.first, secondBodyId: joint.second,
    kind: "revolute" as const, firstAnchorLocalM: joint.anchor,
    secondAnchorLocalM: joint.anchor, firstAxisLocal: joint.axis,
    secondAxisLocal: joint.axis, lowerRad: joint.limits[0], upperRad: joint.limits[1],
  }));
  const partnerStages = [2, 3, 4, 5, 6, 0, 0] as const;
  const clearancePairs = stageIds.flatMap((stageId, stageIndex) => {
    const partnerIndex = partnerStages[stageIndex]!;
    const partner = colliders.find(({ bodyId }) => bodyId === stageIds[partnerIndex])!;
    return colliders.filter(({ bodyId }) => bodyId === stageId)
      .map(({ id }, colliderIndex) => ({
        id: `clearance-${stageIndex}-${colliderIndex}`,
        sourceQueryId: `stage-clearance-${stageIndex}-${partnerIndex}`,
        firstColliderId: id, secondColliderId: partner.id,
      }));
  });
  const input = await defineMechanismInput({ sourceRevision: model.document.revision,
    studyId: "se6-motion", bodies, colliders, joints, gravityWorldMps2: [0, 0, -9.80665],
    pointForces: [], durationSteps: 240, outputStrideSteps: 4, clearancePairs });
  return defineCompiledMechanismStudy(input, exact.artifacts);
}
