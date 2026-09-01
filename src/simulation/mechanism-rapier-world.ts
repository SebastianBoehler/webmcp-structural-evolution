import type * as Rapier from "@dimforge/rapier3d-deterministic-compat";

import type { MechanismInput } from "./mechanism-contract";
import {
  multiplyQuaternion, quaternionObject, rotateVector, vectorObject, type Quat,
} from "./mechanism-rapier-math";
import { assertRapierRepresentable, rapierColliderBoundingRadius } from "./mechanism-rapier-range";

export type RapierModule = typeof Rapier;
export const MECHANISM_SOLVER_ITERATIONS = 64;
export const MECHANISM_INTERNAL_PGS_ITERATIONS = 1;
export type RapierState = Readonly<{
  world: Rapier.World;
  bodies: ReadonlyMap<string, Rapier.RigidBody>;
  colliders: ReadonlyMap<string, Rapier.Collider>;
  joints: ReadonlyMap<string, Rapier.ImpulseJoint>;
  colliderIdsByHandle: ReadonlyMap<number, string>;
  colliderBodyIds: ReadonlyMap<string, string>;
  collisionMasks: ReadonlyMap<number, { readonly membership: number; readonly filter: number }>;
  colliderBoundingRadii: ReadonlyMap<string, number>;
  initialOrientations: ReadonlyMap<string, Quat>;
  physicsHooks: Rapier.PhysicsHooks;
}>;

function sameAxis(first: readonly number[], second: readonly number[]): boolean {
  return Math.hypot(...first.map((value, index) => value - second[index]!)) <= 1e-6;
}

function jointDescriptor(
  rapier: RapierModule,
  initialOrientations: ReadonlyMap<string, Quat>,
  joint: MechanismInput["joints"][number],
) {
  const firstInitial = initialOrientations.get(joint.firstBodyId)!;
  const secondInitial = initialOrientations.get(joint.secondBodyId)!;
  const firstAnchor = vectorObject(rotateVector(firstInitial, joint.firstAnchorLocalM));
  const secondAnchor = vectorObject(rotateVector(secondInitial, joint.secondAnchorLocalM));
  if (joint.kind === "rigid") return rapier.JointData.fixed(firstAnchor,
    quaternionObject(multiplyQuaternion(firstInitial, joint.firstFrameOrientationBody)), secondAnchor,
    quaternionObject(multiplyQuaternion(secondInitial, joint.secondFrameOrientationBody)));
  const firstAxis = rotateVector(firstInitial, joint.firstAxisLocal);
  const secondAxis = rotateVector(secondInitial, joint.secondAxisLocal);
  if (!sameAxis(firstAxis, secondAxis)) {
    throw new Error(`Mechanism joint axes do not coincide after runtime rebase: ${joint.id}`);
  }
  const descriptor = joint.kind === "revolute"
    ? rapier.JointData.revolute(firstAnchor, secondAnchor, vectorObject(firstAxis))
    : rapier.JointData.prismatic(firstAnchor, secondAnchor, vectorObject(firstAxis));
  descriptor.limitsEnabled = true;
  descriptor.limits = joint.kind === "revolute" ? [joint.lowerRad, joint.upperRad] : [joint.lowerM, joint.upperM];
  return descriptor;
}

function colliderDescriptor(rapier: RapierModule, collider: MechanismInput["colliders"][number]) {
  const { shape } = collider;
  if (shape.kind === "box") return rapier.ColliderDesc.cuboid(...shape.halfExtentsM);
  if (shape.kind === "sphere") return rapier.ColliderDesc.ball(shape.radiusM);
  if (shape.kind === "capsule") return rapier.ColliderDesc.capsule(shape.halfHeightM, shape.radiusM);
  if (shape.kind === "cylinder") return rapier.ColliderDesc.cylinder(shape.halfHeightM, shape.radiusM);
  const vertices = new Float32Array(shape.verticesM.flat());
  if (shape.kind === "convex-hull") {
    const descriptor = rapier.ColliderDesc.convexHull(vertices);
    if (!descriptor) throw new Error(`Rapier rejected convex collider: ${collider.id}`);
    return descriptor;
  }
  return rapier.ColliderDesc.trimesh(vertices, new Uint32Array(shape.triangles.flat()));
}

export function createRapierState(rapier: RapierModule, input: MechanismInput): RapierState {
  assertRapierRepresentable(input);
  const world = new rapier.World(vectorObject(input.gravityWorldMps2));
  world.timestep = 1 / 240;
  world.numSolverIterations = MECHANISM_SOLVER_ITERATIONS;
  world.numInternalPgsIterations = MECHANISM_INTERNAL_PGS_ITERATIONS;
  const bodies = new Map<string, Rapier.RigidBody>();
  const initialOrientations = new Map<string, Quat>();
  for (const body of input.bodies) {
    const initial = body.transform.orientation as Quat;
    initialOrientations.set(body.id, initial);
    let descriptor = (body.kind === "fixed" ? rapier.RigidBodyDesc.fixed() : rapier.RigidBodyDesc.dynamic())
      .setTranslation(...body.transform.positionM).setRotation(quaternionObject([0, 0, 0, 1]));
    if (body.kind === "dynamic") {
      descriptor = descriptor
        .setLinvel(...body.initialLinearVelocityMps).setAngvel(vectorObject(body.initialAngularVelocityRadS))
        .setAdditionalMassProperties(body.massKg, vectorObject(rotateVector(initial, body.centerOfMassM)),
          vectorObject(body.principalInertiaKgM2),
          quaternionObject(multiplyQuaternion(initial, body.principalInertiaFrameToBody)));
    }
    bodies.set(body.id, world.createRigidBody(descriptor));
  }
  const colliders = new Map<string, Rapier.Collider>();
  const colliderIdsByHandle = new Map<number, string>();
  const colliderBodyIds = new Map<string, string>();
  const colliderBoundingRadii = new Map<string, number>();
  const masks = new Map<number, { readonly membership: number; readonly filter: number }>();
  for (const collider of input.colliders) {
    const initial = initialOrientations.get(collider.bodyId)!;
    const descriptor = colliderDescriptor(rapier, collider).setDensity(0)
      .setTranslation(...rotateVector(initial, collider.bodyLocalTransform.positionM))
      .setRotation(quaternionObject(multiplyQuaternion(initial, collider.bodyLocalTransform.orientation)))
      .setCollisionGroups(0xffff_ffff).setSolverGroups(0xffff_ffff)
      .setActiveHooks(rapier.ActiveHooks.FILTER_CONTACT_PAIRS);
    const runtime = world.createCollider(descriptor, bodies.get(collider.bodyId)!);
    colliders.set(collider.id, runtime);
    colliderIdsByHandle.set(runtime.handle, collider.id);
    colliderBodyIds.set(collider.id, collider.bodyId);
    colliderBoundingRadii.set(collider.id, rapierColliderBoundingRadius(collider.shape));
    masks.set(runtime.handle, { membership: collider.membershipMask, filter: collider.filterMask });
  }
  for (const body of input.bodies) if (body.kind === "dynamic") {
    bodies.get(body.id)!.recomputeMassPropertiesFromColliders();
  }
  const physicsHooks: Rapier.PhysicsHooks = {
    filterContactPair(first, second) {
      const a = masks.get(first), b = masks.get(second);
      if (!a || !b) throw new Error("Rapier contact hook received an unknown collider mask");
      return (a.membership & b.filter) !== 0 && (b.membership & a.filter) !== 0
        ? rapier.SolverFlags.COMPUTE_IMPULSE : null;
    },
    filterIntersectionPair() { return false; },
  };
  const joints = new Map<string, Rapier.ImpulseJoint>();
  for (const joint of input.joints) {
    const descriptor = jointDescriptor(rapier, initialOrientations, joint);
    const runtime = world.createImpulseJoint(descriptor,
      bodies.get(joint.firstBodyId)!, bodies.get(joint.secondBodyId)!, true);
    if (joint.kind === "revolute") (runtime as Rapier.RevoluteImpulseJoint).setLimits(joint.lowerRad, joint.upperRad);
    else if (joint.kind === "prismatic") (runtime as Rapier.PrismaticImpulseJoint).setLimits(joint.lowerM, joint.upperM);
    joints.set(joint.id, runtime);
  }
  return { world, bodies, colliders, joints, colliderIdsByHandle, colliderBodyIds, collisionMasks: masks,
    colliderBoundingRadii, initialOrientations, physicsHooks };
}
