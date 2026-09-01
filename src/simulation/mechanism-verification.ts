import type {
  MechanismFrame, MechanismInput, MechanismWorkerResultEvidenceCandidate,
} from "./mechanism-contract";
import type { DeepReadonly } from "../domain/snapshots";
import { canonicalScalar, multiplyQuaternion, rotateVector, type Quat, type Vec3 } from "./mechanism-rapier-math";
import { pointKinematics } from "./mechanism-rapier-points";

type Verification = MechanismWorkerResultEvidenceCandidate["verification"];
type ReplayFrame = DeepReadonly<MechanismFrame>;
const add = (left: Vec3, right: Vec3): Vec3 => left.map((value, index) => value + right[index]!) as unknown as Vec3;
const subtract = (left: Vec3, right: Vec3): Vec3 => left.map((value, index) => value - right[index]!) as unknown as Vec3;
const scale = (value: Vec3, factor: number): Vec3 => value.map((entry) => entry * factor) as unknown as Vec3;
const dot = (left: Vec3, right: Vec3) => left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
const cross = (left: Vec3, right: Vec3): Vec3 => [
  left[1] * right[2] - left[2] * right[1], left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0],
];
const canonicalVector = (value: Vec3) => value.map(canonicalScalar) as unknown as [number, number, number];

function mechanics(input: MechanismInput, frame: ReplayFrame) {
  let linear: Vec3 = [0, 0, 0], angular: Vec3 = [0, 0, 0], kinetic = 0;
  const centers = new Map<string, Vec3>();
  for (const body of input.bodies) {
    if (body.kind !== "dynamic") continue;
    const state = frame.bodies.find(({ bodyId }) => bodyId === body.id)!;
    const orientation = state.orientation as Quat;
    const center = add(state.positionM, rotateVector(orientation, body.centerOfMassM));
    const momentum = scale(state.linearVelocityMps, body.massKg);
    const principalToWorld = multiplyQuaternion(orientation, body.principalInertiaFrameToBody);
    const inverse = [-principalToWorld[0], -principalToWorld[1], -principalToWorld[2], principalToWorld[3]] as Quat;
    const omegaPrincipal = rotateVector(inverse, state.angularVelocityRadS);
    const angularCom = rotateVector(principalToWorld, [
      body.principalInertiaKgM2[0] * omegaPrincipal[0], body.principalInertiaKgM2[1] * omegaPrincipal[1],
      body.principalInertiaKgM2[2] * omegaPrincipal[2],
    ]);
    linear = add(linear, momentum);
    angular = add(angular, add(angularCom, cross(center, momentum)));
    kinetic += 0.5 * body.massKg * dot(state.linearVelocityMps, state.linearVelocityMps)
      + 0.5 * dot(omegaPrincipal, [
        body.principalInertiaKgM2[0] * omegaPrincipal[0], body.principalInertiaKgM2[1] * omegaPrincipal[1],
        body.principalInertiaKgM2[2] * omegaPrincipal[2],
      ]);
    centers.set(body.id, center);
  }
  return { linear, angular, kinetic, centers };
}

export function mechanismVerification(
  input: MechanismInput, frames: readonly ReplayFrame[],
): Verification {
  const initial = mechanics(input, frames[0]!), final = mechanics(input, frames.at(-1)!);
  let gravityWorkJ = 0;
  for (const body of input.bodies) if (body.kind === "dynamic") {
    gravityWorkJ += body.massKg * dot(input.gravityWorldMps2,
      subtract(final.centers.get(body.id)!, initial.centers.get(body.id)!));
  }
  let pointForceWorkJ = 0;
  const initialBodies = new Map(frames[0]!.bodies.map((body) => [body.bodyId, body]));
  const finalBodies = new Map(frames.at(-1)!.bodies.map((body) => [body.bodyId, body]));
  for (const force of input.pointForces) {
    const first = initialBodies.get(force.bodyId)!, last = finalBodies.get(force.bodyId)!;
    const body = input.bodies.find(({ id }) => id === force.bodyId)!;
    const localCenterOfMass = body.kind === "dynamic" ? body.centerOfMassM : [0, 0, 0] as const;
    const materialPoint = (frame: typeof first) => pointKinematics({ translation: frame.positionM,
      rotation: frame.orientation as Quat, linearVelocity: frame.linearVelocityMps,
      angularVelocity: frame.angularVelocityRadS, localPoint: force.pointLocalM, localCenterOfMass }).point;
    const firstWorld = materialPoint(first), lastWorld = materialPoint(last);
    const firstPoint: Vec3 = [firstWorld.x, firstWorld.y, firstWorld.z];
    const lastPoint: Vec3 = [lastWorld.x, lastWorld.y, lastWorld.z];
    pointForceWorkJ += dot(force.forceWorldN, subtract(lastPoint, firstPoint));
  }
  const energyChangeJ = final.kinetic - initial.kinetic;
  let maximumJointErrorM = 0;
  for (const frame of frames) for (const joint of input.joints) {
    const first = frame.bodies.find(({ bodyId }) => bodyId === joint.firstBodyId)!;
    const second = frame.bodies.find(({ bodyId }) => bodyId === joint.secondBodyId)!;
    const firstPoint = add(first.positionM, rotateVector(first.orientation as Quat, joint.firstAnchorLocalM));
    const secondPoint = add(second.positionM, rotateVector(second.orientation as Quat, joint.secondAnchorLocalM));
    const delta = subtract(secondPoint, firstPoint);
    const error = joint.kind === "prismatic"
      ? Math.hypot(...subtract(delta, scale(rotateVector(first.orientation as Quat, joint.firstAxisLocal),
        dot(delta, rotateVector(first.orientation as Quat, joint.firstAxisLocal)))))
      : Math.hypot(...delta);
    maximumJointErrorM = Math.max(maximumJointErrorM, error);
  }
  return { initialLinearMomentumKgMps: canonicalVector(initial.linear), finalLinearMomentumKgMps: canonicalVector(final.linear),
    initialAngularMomentumKgM2ps: canonicalVector(initial.angular), finalAngularMomentumKgM2ps: canonicalVector(final.angular),
    energyChangeJ: canonicalScalar(energyChangeJ), gravityWorkJ: canonicalScalar(gravityWorkJ),
    pointForceWorkJ: canonicalScalar(pointForceWorkJ),
    energyAccountingErrorJ: canonicalScalar(energyChangeJ - gravityWorkJ - pointForceWorkJ),
    maximumJointErrorM: canonicalScalar(maximumJointErrorM) };
}
