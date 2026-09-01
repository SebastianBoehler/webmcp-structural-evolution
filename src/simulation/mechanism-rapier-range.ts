import type { MechanismInput } from "./mechanism-contract";

const MAX_MAGNITUDE = 1e30;
const MIN_POSITIVE = 1e-30;

function values(label: string, entries: Iterable<number>): void {
  for (const value of entries) if (Math.abs(value) > MAX_MAGNITUDE) {
    throw new Error(`Mechanism ${label} exceeds Rapier's representable range`);
  }
}

function positive(label: string, entries: Iterable<number>): void {
  values(label, entries);
  for (const value of entries) if (value > 0 && value < MIN_POSITIVE) {
    throw new Error(`Mechanism ${label} is below Rapier's representable range`);
  }
}

export function assertRapierRepresentable(input: MechanismInput): void {
  values("gravity", input.gravityWorldMps2);
  for (const body of input.bodies) {
    values("body transform", body.transform.positionM);
    if (body.kind === "dynamic") {
      positive("body mass", [body.massKg]);
      positive("body inertia", body.principalInertiaKgM2);
      values("body center of mass", body.centerOfMassM);
      values("body linear velocity", body.initialLinearVelocityMps);
      values("body angular velocity", body.initialAngularVelocityRadS);
    }
  }
  for (const collider of input.colliders) {
    values("collider transform", collider.bodyLocalTransform.positionM);
    const shape = collider.shape;
    if (shape.kind === "box") positive("box extent", shape.halfExtentsM);
    else if (shape.kind === "sphere") positive("sphere radius", [shape.radiusM]);
    else if (shape.kind === "capsule" || shape.kind === "cylinder") {
      positive(`${shape.kind} extent`, [shape.halfHeightM, shape.radiusM]);
    } else for (const vertex of shape.verticesM) values("collider vertex", vertex);
  }
  for (const joint of input.joints) {
    values("joint first anchor", joint.firstAnchorLocalM);
    values("joint second anchor", joint.secondAnchorLocalM);
    if (joint.kind === "revolute") values("revolute limit", [joint.lowerRad, joint.upperRad]);
    else if (joint.kind === "prismatic") values("prismatic limit", [joint.lowerM, joint.upperM]);
  }
  for (const force of input.pointForces) {
    values("point force location", force.pointLocalM);
    values("point force value", force.forceWorldN);
  }
}

type ColliderShape = MechanismInput["colliders"][number]["shape"];

export function rapierColliderBoundingRadius(shape: ColliderShape): number {
  if (shape.kind === "box") return Math.hypot(...shape.halfExtentsM);
  if (shape.kind === "sphere") return shape.radiusM;
  if (shape.kind === "capsule") return shape.halfHeightM + shape.radiusM;
  if (shape.kind === "cylinder") return Math.hypot(shape.halfHeightM, shape.radiusM);
  let radius = 0;
  for (const [x, y, z] of shape.verticesM) radius = Math.max(radius, Math.hypot(x, y, z));
  return radius;
}
