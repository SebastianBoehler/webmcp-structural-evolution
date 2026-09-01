import {
  MECHANISM_MAX_CLEARANCE_SAMPLES, MECHANISM_MAX_CONTACT_EVENTS,
  type ClearanceSample, type ContactEvent, type MechanismInput,
} from "./mechanism-contract";
import { MAX_INITIAL_CONTACT_COLLIDER_PAIRS } from "./mechanism-limits";
import { canonicalPair, codeUnitCompare } from "./mechanism-math";
import { canonicalScalar } from "./mechanism-rapier-math";
import type { RapierState } from "./mechanism-rapier-world";

type ContactDetail = Omit<ContactEvent, "stepIndex" | "phase" | "firstColliderId" | "secondColliderId">;
export type ContactTracker = Map<string, ContactDetail>;
const key = (first: string, second: string) => `${first}/${second}`;

function normalized(value: { readonly x: number; readonly y: number; readonly z: number }) {
  const magnitude = Math.hypot(value.x, value.y, value.z);
  if (!(magnitude > 0) || !Number.isFinite(magnitude)) throw new Error("Rapier returned an invalid contact normal");
  return [canonicalScalar(value.x / magnitude), canonicalScalar(value.y / magnitude),
    canonicalScalar(value.z / magnitude)] as [number, number, number];
}

function activeContacts(state: RapierState): Map<string, ContactDetail> {
  const contacts = new Map<string, ContactDetail>();
  for (const [id, collider] of state.colliders) {
    state.world.contactPairsWith(collider, (other) => {
      const otherId = state.colliderIdsByHandle.get(other.handle);
      if (!otherId) throw new Error("Rapier contact traversal returned an unknown collider handle");
      if (codeUnitCompare(id, otherId) >= 0) return;
      if (!collisionEnabled(state, collider.handle, other.handle)) return;
      const shapeContact = collider.contactCollider(other, 0);
      if (!shapeContact || shapeContact.distance > 0) return;
      let impulse = 0;
      state.world.contactPair(collider, other, (manifold) => {
        for (let index = 0; index < manifold.numContacts(); index += 1) impulse += Math.abs(manifold.contactImpulse(index));
      });
      contacts.set(key(id, otherId), {
        pointM: [canonicalScalar(shapeContact.point1.x), canonicalScalar(shapeContact.point1.y),
          canonicalScalar(shapeContact.point1.z)],
        normalWorld: normalized(shapeContact.normal1),
        penetrationM: canonicalScalar(Math.max(0, -shapeContact.distance)),
        normalForceN: canonicalScalar(impulse / state.world.timestep),
      });
    });
  }
  return contacts;
}

function collisionEnabled(state: RapierState, firstHandle: number, secondHandle: number) {
  const first = state.collisionMasks.get(firstHandle), second = state.collisionMasks.get(secondHandle);
  if (!first || !second) throw new Error("Rapier step-zero query received an unknown collider mask");
  return (first.membership & second.filter) !== 0 && (second.membership & first.filter) !== 0;
}

export function captureInitialContactEvents(state: RapierState, output: ContactEvent[]): ContactTracker {
  const active: ContactTracker = new Map();
  const colliders = [...state.colliders.entries()].sort(([first], [second]) => codeUnitCompare(first, second));
  let pairCount = 0;
  for (let firstIndex = 0; firstIndex < colliders.length; firstIndex += 1) {
    const [firstId, first] = colliders[firstIndex]!;
    const firstBodyId = state.colliderBodyIds.get(firstId);
    if (!firstBodyId) throw new Error("Rapier step-zero query has an unknown collider body");
    for (let secondIndex = firstIndex + 1; secondIndex < colliders.length; secondIndex += 1) {
      const [secondId, second] = colliders[secondIndex]!;
      const secondBodyId = state.colliderBodyIds.get(secondId);
      if (!secondBodyId) throw new Error("Rapier step-zero query has an unknown collider body");
      if (firstBodyId === secondBodyId || !collisionEnabled(state, first.handle, second.handle)) continue;
      pairCount += 1;
      if (pairCount > MAX_INITIAL_CONTACT_COLLIDER_PAIRS) {
        throw new Error("Mechanism step-zero contact-pair budget exceeded");
      }
      const contact = first.contactCollider(second, 0);
      if (!contact || contact.distance > 0) continue;
      const detail = { pointM: [canonicalScalar(contact.point1.x), canonicalScalar(contact.point1.y),
        canonicalScalar(contact.point1.z)] as [number, number, number], normalWorld: normalized(contact.normal1),
        penetrationM: canonicalScalar(Math.max(0, -contact.distance)), normalForceN: 0 };
      active.set(key(firstId, secondId), detail);
      output.push({ stepIndex: 0, phase: "begin", firstColliderId: firstId, secondColliderId: secondId, ...detail });
      if (output.length > MECHANISM_MAX_CONTACT_EVENTS) throw new Error("Mechanism contact-event budget exceeded");
    }
  }
  return active;
}

export function captureContactEvents(
  state: RapierState, stepIndex: number, previous: ContactTracker, output: ContactEvent[],
): ContactTracker {
  const current = activeContacts(state);
  const pairs = [...new Set([...previous.keys(), ...current.keys()])].sort(codeUnitCompare);
  for (const pair of pairs) {
    const [firstColliderId, secondColliderId] = pair.split("/") as [string, string];
    const detail = current.get(pair);
    if (detail) output.push({ stepIndex, phase: previous.has(pair) ? "persist" : "begin",
      firstColliderId, secondColliderId, ...detail });
    else {
      const ended = previous.get(pair)!;
      output.push({ stepIndex, phase: "end", firstColliderId, secondColliderId,
        ...ended, penetrationM: 0, normalForceN: 0 });
    }
    if (output.length > MECHANISM_MAX_CONTACT_EVENTS) throw new Error("Mechanism contact-event budget exceeded");
  }
  return current;
}

export function captureClearanceSamples(
  input: MechanismInput, state: RapierState, stepIndex: number, output: ClearanceSample[],
): void {
  for (const pair of input.clearancePairs) {
    const [firstId, secondId] = canonicalPair(pair.firstColliderId, pair.secondColliderId);
    const first = state.colliders.get(firstId)!, second = state.colliders.get(secondId)!;
    const firstPosition = first.translation(), secondPosition = second.translation();
    const originDistance = Math.hypot(firstPosition.x - secondPosition.x,
      firstPosition.y - secondPosition.y, firstPosition.z - secondPosition.z);
    const extent = originDistance + state.colliderBoundingRadii.get(firstId)! + state.colliderBoundingRadii.get(secondId)!;
    const prediction = Math.fround(extent + Math.max(1e-6, extent * 1e-6));
    if (!Number.isFinite(prediction)) throw new Error(`Rapier clearance query range overflowed: ${pair.id}`);
    const contact = first.contactCollider(second, prediction);
    if (!contact || !Number.isFinite(contact.distance)) throw new Error(`Rapier could not resolve clearance: ${pair.id}`);
    output.push({ stepIndex, pairId: pair.id, firstColliderId: firstId, secondColliderId: secondId,
      distanceM: canonicalScalar(contact.distance) });
    if (output.length > MECHANISM_MAX_CLEARANCE_SAMPLES) throw new Error("Mechanism clearance-sample budget exceeded");
  }
}
