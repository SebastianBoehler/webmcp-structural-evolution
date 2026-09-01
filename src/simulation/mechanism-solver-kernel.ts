import * as RAPIER from "@dimforge/rapier3d-deterministic-compat";

import {
  defineMechanismInput, type ClearanceSample, type ContactEvent, type MechanismFrame, type MechanismInput,
} from "./mechanism-contract";
import {
  canonicalQuaternion, canonicalScalar, canonicalVector, multiplyQuaternion, rotateVector, type Quat,
} from "./mechanism-rapier-math";
import { applyPointForces, bindPointForces, rapierPointKinematics } from "./mechanism-rapier-points";
import { createRapierState } from "./mechanism-rapier-world";
import {
  captureClearanceSamples, captureContactEvents, captureInitialContactEvents, type ContactTracker,
} from "./mechanism-rapier-contacts";
import { mechanismVerification } from "./mechanism-verification";

const cancelled = () => new DOMException("Mechanism solve was cancelled", "AbortError");
const abort = (signal: AbortSignal) => { if (signal.aborted) throw cancelled(); };

export type MechanismWorkerSolve = Readonly<{
  engineVersion: string;
  replay: Readonly<{
    sourceRevision: string; studyId: string; mechanismInputDigest: string;
    bodyIds: readonly string[]; jointIds: readonly string[]; colliderIds: readonly string[];
    clearancePairIds: readonly string[]; frames: readonly MechanismFrame[];
    contacts: readonly ContactEvent[]; clearanceSamples: readonly ClearanceSample[];
  }>;
  verification: ReturnType<typeof mechanismVerification>;
}>;

function captureFrame(
  input: MechanismInput,
  state: ReturnType<typeof createRapierState>,
  stepIndex: number,
): MechanismFrame {
  return {
    sourceRevision: input.sourceRevision, studyId: input.studyId,
    mechanismInputDigest: input.mechanismInputDigest, stepIndex,
    bodies: input.bodies.map(({ id }) => {
      const body = state.bodies.get(id)!;
      const rotation = body.rotation();
      const initial = state.initialOrientations.get(id)!;
      const output = multiplyQuaternion([rotation.x, rotation.y, rotation.z, rotation.w], initial);
      return { bodyId: id, positionM: canonicalVector(body.translation()),
        orientation: canonicalQuaternion({ x: output[0], y: output[1], z: output[2], w: output[3] }),
        linearVelocityMps: canonicalVector(body.linvel()), angularVelocityRadS: canonicalVector(body.angvel()) };
    }),
    joints: input.joints.map((joint) => captureJoint(input, state, joint)),
  };
}

function captureJoint(
  input: MechanismInput,
  state: ReturnType<typeof createRapierState>,
  joint: MechanismInput["joints"][number],
): MechanismFrame["joints"][number] {
  if (joint.kind === "rigid") return { jointId: joint.id, kind: "rigid" };
  const firstBody = state.bodies.get(joint.firstBodyId)!, secondBody = state.bodies.get(joint.secondBodyId)!;
  const firstInitial = state.initialOrientations.get(joint.firstBodyId)!;
  const secondInitial = state.initialOrientations.get(joint.secondBodyId)!;
  const bodyCenter = (bodyId: string, initial: Quat) => {
    const body = input.bodies.find(({ id }) => id === bodyId)!;
    return body.kind === "dynamic" ? rotateVector(initial, body.centerOfMassM) : [0, 0, 0] as const;
  };
  const firstAnchor = rapierPointKinematics({ body: firstBody,
    localPoint: rotateVector(firstInitial, joint.firstAnchorLocalM),
    localCenterOfMass: bodyCenter(joint.firstBodyId, firstInitial) });
  const secondAnchor = rapierPointKinematics({ body: secondBody,
    localPoint: rotateVector(secondInitial, joint.secondAnchorLocalM),
    localCenterOfMass: bodyCenter(joint.secondBodyId, secondInitial) });
  const rotation = firstBody.rotation();
  const axisLocal = rotateVector(firstInitial, joint.firstAxisLocal);
  const axis = rotateVector([rotation.x, rotation.y, rotation.z, rotation.w], axisLocal);
  const dot = (left: readonly number[], right: readonly number[]) =>
    left[0]! * right[0]! + left[1]! * right[1]! + left[2]! * right[2]!;
  if (joint.kind === "prismatic") {
    const firstPoint = [firstAnchor.point.x, firstAnchor.point.y, firstAnchor.point.z];
    const secondPoint = [secondAnchor.point.x, secondAnchor.point.y, secondAnchor.point.z];
    const delta = secondPoint.map((value, index) => value - firstPoint[index]!) as [number, number, number];
    const relativeVelocity = secondAnchor.velocity.map((value, index) =>
      value - firstAnchor.velocity[index]!) as [number, number, number];
    return { jointId: joint.id, kind: joint.kind,
      positionM: canonicalScalar(dot(delta, axis)), velocityMps: canonicalScalar(dot(relativeVelocity, axis)) };
  }
  const referenceLocal = perpendicular(axisLocal);
  const firstRotation = firstBody.rotation(), secondRotation = secondBody.rotation();
  const firstReference = rotateVector([firstRotation.x, firstRotation.y, firstRotation.z, firstRotation.w], referenceLocal);
  const secondReferenceLocal = rotateVector(secondInitial, joint.secondAxisLocal);
  const secondReference = rotateVector([secondRotation.x, secondRotation.y, secondRotation.z, secondRotation.w],
    perpendicular(secondReferenceLocal));
  const cross = [firstReference[1] * secondReference[2] - firstReference[2] * secondReference[1],
    firstReference[2] * secondReference[0] - firstReference[0] * secondReference[2],
    firstReference[0] * secondReference[1] - firstReference[1] * secondReference[0]];
  const firstAngular = firstBody.angvel(), secondAngular = secondBody.angvel();
  return { jointId: joint.id, kind: joint.kind,
    positionRad: canonicalScalar(Math.atan2(dot(axis, cross), dot(firstReference, secondReference))),
    velocityRadS: canonicalScalar((secondAngular.x - firstAngular.x) * axis[0]
      + (secondAngular.y - firstAngular.y) * axis[1] + (secondAngular.z - firstAngular.z) * axis[2]) };
}

function perpendicular(axis: readonly [number, number, number]): [number, number, number] {
  const basis = Math.abs(axis[0]) <= Math.abs(axis[1]) && Math.abs(axis[0]) <= Math.abs(axis[2])
    ? [1, 0, 0] : Math.abs(axis[1]) <= Math.abs(axis[2]) ? [0, 1, 0] : [0, 0, 1];
  const cross = [axis[1] * basis[2]! - axis[2] * basis[1]!, axis[2] * basis[0]! - axis[0] * basis[2]!,
    axis[0] * basis[1]! - axis[1] * basis[0]!] as [number, number, number];
  const magnitude = Math.hypot(...cross);
  return cross.map((value) => value / magnitude) as [number, number, number];
}

export async function runRapierMechanism(value: unknown, signal: AbortSignal): Promise<MechanismWorkerSolve> {
  abort(signal);
  const input = await defineMechanismInput(value);
  abort(signal);
  await RAPIER.init();
  abort(signal);
  const engineVersion = RAPIER.version();
  const state = createRapierState(RAPIER, input);
  const pointForces = bindPointForces(input, state);
  const frames = [captureFrame(input, state, 0)];
  const contacts: ContactEvent[] = [], clearanceSamples: ClearanceSample[] = [];
  let activeContacts: ContactTracker = captureInitialContactEvents(state, contacts);
  captureClearanceSamples(input, state, 0, clearanceSamples);
  try {
    for (let step = 1; step <= input.durationSteps; step += 1) {
      abort(signal);
      applyPointForces(pointForces);
      state.world.step(undefined, state.physicsHooks);
      activeContacts = captureContactEvents(state, step, activeContacts, contacts);
      if (step % input.outputStrideSteps === 0) frames.push(captureFrame(input, state, step));
      if (step % input.outputStrideSteps === 0) captureClearanceSamples(input, state, step, clearanceSamples);
      if (step % 256 === 0) { await new Promise<void>((resolve) => setTimeout(resolve, 0)); abort(signal); }
    }
  } finally { state.world.free(); }
  return { engineVersion, replay: { sourceRevision: input.sourceRevision, studyId: input.studyId,
    mechanismInputDigest: input.mechanismInputDigest, bodyIds: input.bodies.map(({ id }) => id),
    jointIds: input.joints.map(({ id }) => id), colliderIds: input.colliders.map(({ id }) => id),
    clearancePairIds: input.clearancePairs.map(({ id }) => id), frames, contacts, clearanceSamples },
  verification: mechanismVerification(input, frames) };
}
