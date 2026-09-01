import type * as Rapier from "@dimforge/rapier3d-deterministic-compat";

import type { MechanismInput } from "./mechanism-contract";
import { rotateVector, vectorObject, type Vec3 } from "./mechanism-rapier-math";
import type { RapierState } from "./mechanism-rapier-world";

type RebasedPoint = Readonly<{ body: Rapier.RigidBody; localPoint: Vec3; localCenterOfMass: Vec3 }>;
export type BoundPointForce = RebasedPoint & Readonly<{ forceWorldN: Vec3 }>;

type PointMotion = Readonly<{
  translation: Vec3; rotation: readonly [number, number, number, number];
  linearVelocity: Vec3; angularVelocity: Vec3; localPoint: Vec3; localCenterOfMass: Vec3;
}>;

export function pointKinematics(motion: PointMotion) {
  const pointOffset = rotateVector(motion.rotation, motion.localPoint);
  const { localCenterOfMass, localPoint, translation, angularVelocity: angular, linearVelocity: linear } = motion;
  const centerOffset = localPoint.map((value, axis) => value - localCenterOfMass[axis]!) as [number, number, number];
  const velocityOffset = rotateVector(motion.rotation, centerOffset);
  return { point: { x: translation[0] + pointOffset[0], y: translation[1] + pointOffset[1],
    z: translation[2] + pointOffset[2] }, velocity: [
    linear[0] + angular[1] * velocityOffset[2] - angular[2] * velocityOffset[1],
    linear[1] + angular[2] * velocityOffset[0] - angular[0] * velocityOffset[2],
    linear[2] + angular[0] * velocityOffset[1] - angular[1] * velocityOffset[0],
  ] as Vec3 };
}

export function rapierPointKinematics({ body, localPoint, localCenterOfMass }: RebasedPoint) {
  const rotation = body.rotation(), translation = body.translation(), linear = body.linvel(), angular = body.angvel();
  return pointKinematics({ localPoint, localCenterOfMass,
    rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
    translation: [translation.x, translation.y, translation.z],
    linearVelocity: [linear.x, linear.y, linear.z], angularVelocity: [angular.x, angular.y, angular.z] });
}

export function bindPointForces(input: MechanismInput, state: RapierState): readonly BoundPointForce[] {
  const localCenters = new Map(input.bodies.map((body) => [body.id, body.kind === "dynamic"
    ? rotateVector(state.initialOrientations.get(body.id)!, body.centerOfMassM) : [0, 0, 0] as const]));
  return input.pointForces.map((force) => ({ body: state.bodies.get(force.bodyId)!,
    localPoint: rotateVector(state.initialOrientations.get(force.bodyId)!, force.pointLocalM),
    localCenterOfMass: localCenters.get(force.bodyId)!, forceWorldN: force.forceWorldN }));
}

export function applyPointForces(forces: readonly BoundPointForce[]): void {
  for (const force of forces) {
    const { point } = rapierPointKinematics(force);
    force.body.addForceAtPoint(vectorObject(force.forceWorldN), point, true);
  }
}
