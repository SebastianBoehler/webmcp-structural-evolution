import type {
  ClearanceSample, ContactEvent, MechanismFrame,
} from "../../simulation/mechanism-contract";
import type { DeepReadonly } from "../../domain/snapshots";
import { multiplyQuaternion, rotateVector, type Quat, type Vec3 } from "../../simulation/mechanism-rapier-math";
import type { AssemblyVisualPart } from "../../viewer/render-envelope";
import * as THREE from "three";
import {
  currentExactWorldPoint,
  displayPoint,
  referenceExactStagePointForDisplay,
  registerCurrentExactWorldPoint,
  registerReferenceExactStagePoint,
  registeredStageDeltaOrientation,
  registeredJointInterfaces,
  type MechanismDisplayRegistration,
} from "./cobot-display-registration";

export interface MechanismVisualInput {
  readonly colliders: readonly Readonly<{
    id: string;
    bodyId: string;
    bodyLocalTransform: Readonly<{
      positionM: readonly [number, number, number];
      orientation: readonly [number, number, number, number];
    }>;
  }>[];
  readonly displayRegistration?: MechanismDisplayRegistration;
}

export interface MechanismVisualReplay {
  readonly frames: readonly DeepReadonly<MechanismFrame>[];
  readonly clearanceSamples: readonly DeepReadonly<ClearanceSample>[];
  readonly contacts: readonly DeepReadonly<ContactEvent>[];
}

export interface MechanismVisualOverlay {
  readonly clearances: readonly DeepReadonly<ClearanceSample>[];
  readonly contacts: readonly DeepReadonly<ContactEvent>[];
  readonly parts: readonly AssemblyVisualPart[];
}

export interface MechanismVisualFrame {
  readonly frameIndex: number;
  readonly stepIndex: number;
  readonly parts: readonly AssemblyVisualPart[];
  readonly jointInterfaces: readonly { readonly jointId: string;
    readonly firstMm: readonly [number, number, number]; readonly secondMm: readonly [number, number, number] }[];
  readonly overlay: MechanismVisualOverlay;
}

type BodyState = DeepReadonly<MechanismFrame>["bodies"][number];
type VisualContact = DeepReadonly<ContactEvent>;
type VisualClearance = DeepReadonly<ClearanceSample>;
const clean = (value: number) => Math.abs(value) < 1e-10 || Object.is(value, -0) ? 0 : value;
const vector = (value: readonly number[]) => value.map(clean) as [number, number, number];
const contactKey = ({ firstColliderId, secondColliderId }: {
  readonly firstColliderId: string; readonly secondColliderId: string;
}) => `${firstColliderId}\u0000${secondColliderId}`;

function inverse(quaternion: Quat): Quat {
  return [-quaternion[0], -quaternion[1], -quaternion[2], quaternion[3]];
}

function eulerQuaternion(rotation: readonly [number, number, number]): Quat {
  const result = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation, "XYZ"));
  return [result.x, result.y, result.z, result.w];
}

function quaternionEuler(quaternion: Quat): [number, number, number] {
  const result = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...quaternion), "XYZ");
  return vector([result.x, result.y, result.z]);
}

function transformPart(
  part: AssemblyVisualPart, bodyId: string, initial: BodyState, current: BodyState,
  registration: MechanismDisplayRegistration | undefined,
): AssemblyVisualPart {
  const delta = multiplyQuaternion(current.orientation, inverse(initial.orientation));
  const relativeM: Vec3 = [part.center[0] / 1_000 - initial.positionM[0],
    part.center[1] / 1_000 - initial.positionM[1], part.center[2] / 1_000 - initial.positionM[2]];
  const moved = rotateVector(delta, relativeM);
  return Object.freeze({
    ...part,
    center: registration
      ? registerReferenceExactStagePoint(referenceExactStagePointForDisplay(
        displayPoint(part.center), registration), initial, current, registration)
      : vector(current.positionM.map((value, axis) => (value + moved[axis]!) * 1_000)),
    rotation: quaternionEuler(multiplyQuaternion(registration
      ? registeredStageDeltaOrientation(initial, current, registration) : delta,
    eulerQuaternion(part.rotation ?? [0, 0, 0]))),
  });
}

function activeContacts(events: readonly VisualContact[], stepIndex: number): readonly VisualContact[] {
  const active = new Map<string, VisualContact>();
  for (const event of events) {
    if (event.stepIndex > stepIndex) continue;
    const key = contactKey(event);
    if (event.phase === "end") active.delete(key);
    else active.set(key, event);
  }
  return Object.freeze([...active.values()].sort((left, right) => contactKey(left).localeCompare(contactKey(right))));
}

function colliderCenter(
  colliderId: string,
  colliders: ReadonlyMap<string, MechanismVisualInput["colliders"][number]>,
  bodies: ReadonlyMap<string, BodyState>,
): Vec3 {
  const collider = colliders.get(colliderId);
  if (!collider) throw new Error(`Mechanism visual collider is unresolved: ${colliderId}`);
  const body = bodies.get(collider.bodyId);
  if (!body) throw new Error(`Mechanism visual body is unresolved: ${collider.bodyId}`);
  const local = rotateVector(body.orientation, collider.bodyLocalTransform.positionM);
  return body.positionM.map((value, axis) => value + local[axis]!) as [number, number, number];
}

function clearancePart(
  sample: VisualClearance,
  colliders: ReadonlyMap<string, MechanismVisualInput["colliders"][number]>,
  bodies: ReadonlyMap<string, BodyState>,
  registration: MechanismDisplayRegistration | undefined,
): AssemblyVisualPart {
  const display = (colliderId: string) => {
    const collider = colliders.get(colliderId), body = collider && bodies.get(collider.bodyId);
    if (!collider || !body) throw new Error(`Mechanism visual collider is unresolved: ${colliderId}`);
    const center = colliderCenter(colliderId, colliders, bodies);
    return registration
      ? registerCurrentExactWorldPoint(currentExactWorldPoint(center), registration)
      : vector(center.map((value) => value * 1_000));
  };
  const first = display(sample.firstColliderId), second = display(sample.secondColliderId);
  const selectionId = `mechanism-clearance:${sample.pairId}`;
  return Object.freeze({ id: selectionId, selectionId,
    label: `Clearance ${sample.pairId}: ${(sample.distanceM * 1_000).toFixed(3)} mm`,
    kind: "protected-disc", radius: 4, height: 2,
    center: vector(first.map((value, axis) => (value + second[axis]!) / 2)),
    appearance: "constraint" });
}

function contactPart(
  contact: VisualContact, colliders: ReadonlyMap<string, MechanismVisualInput["colliders"][number]>,
  bodies: ReadonlyMap<string, BodyState>,
  registration: MechanismDisplayRegistration | undefined,
): AssemblyVisualPart {
  const collider = colliders.get(contact.firstColliderId);
  const current = collider && bodies.get(collider.bodyId);
  if (!collider || !current) throw new Error(`Mechanism visual contact collider is unresolved: ${contact.firstColliderId}`);
  const selectionId = `mechanism-contact:${contact.firstColliderId}:${contact.secondColliderId}`;
  return Object.freeze({ id: selectionId, selectionId,
    label: `Contact: ${(contact.penetrationM * 1_000).toFixed(3)} mm penetration`,
    kind: "protected-disc", radius: 6, height: 3,
    center: registration
      ? registerCurrentExactWorldPoint(currentExactWorldPoint(contact.pointM), registration)
      : vector(contact.pointM.map((value) => value * 1_000)),
    appearance: "constraint" });
}

export function createMechanismVisualFrame(
  parts: readonly AssemblyVisualPart[],
  partBodyIds: Readonly<Record<string, string>>,
  input: MechanismVisualInput,
  replay: MechanismVisualReplay,
  frameIndex: number,
): MechanismVisualFrame {
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= replay.frames.length) {
    throw new RangeError(`Mechanism visual frame index is out of range: ${frameIndex}`);
  }
  const initial = new Map(replay.frames[0]!.bodies.map((body) => [body.bodyId, body]));
  const frame = replay.frames[frameIndex]!;
  const current = new Map(frame.bodies.map((body) => [body.bodyId, body]));
  const transformed = parts.map((part) => {
    const bodyId = partBodyIds[part.selectionId];
    if (!bodyId) throw new Error(`Mechanism visual part has no body owner: ${part.selectionId}`);
    const first = initial.get(bodyId), next = current.get(bodyId);
    if (!first || !next) throw new Error(`Mechanism visual body is unresolved: ${bodyId}`);
    return transformPart(part, bodyId, first, next, input.displayRegistration);
  });
  const clearances = replay.clearanceSamples.filter(({ stepIndex }) => stepIndex === frame.stepIndex)
    .sort((left, right) => left.pairId.localeCompare(right.pairId));
  const contacts = activeContacts(replay.contacts, frame.stepIndex);
  const colliders = new Map(input.colliders.map((collider) => [collider.id, collider]));
  const overlayParts = [...clearances.map((sample) => clearancePart(
    sample, colliders, current, input.displayRegistration,
  )), ...contacts.map((contact) => contactPart(
    contact, colliders, current, input.displayRegistration,
  ))];
  return Object.freeze({ frameIndex, stepIndex: frame.stepIndex,
    parts: Object.freeze(transformed), jointInterfaces: input.displayRegistration
      ? registeredJointInterfaces(initial, current, input.displayRegistration) : Object.freeze([]), overlay: Object.freeze({
      clearances: Object.freeze(clearances), contacts, parts: Object.freeze(overlayParts),
    }) });
}
