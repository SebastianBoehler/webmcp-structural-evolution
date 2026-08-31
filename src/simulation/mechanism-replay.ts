import {
  defineMechanismInput, MECHANISM_CONTACT_DEPTH_TOLERANCE_M,
  MECHANISM_REPLAY_ENCODING_VERSION, MECHANISM_STEP_HZ,
  MechanismReplayEvidenceSchema,
  type MechanismInput,
  type MechanismReplay,
} from "./mechanism-contract";
import { canonicalJson } from "../domain/canonical-json";
import { freezeSnapshot } from "../domain/snapshots";
import { codeUnitCompare } from "./mechanism-math";

function sorted(ids: readonly string[]): boolean {
  return ids.every((id, index) => index === 0 || codeUnitCompare(ids[index - 1]!, id) < 0);
}

function sameIds(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((id, index) => id === expected[index]);
}

function pairKey(first: string, second: string): string {
  return `${first}/${second}`;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function createMechanismReplay(
  mechanismInput: MechanismInput,
  value: unknown,
): Promise<MechanismReplay> {
  const input = await defineMechanismInput(mechanismInput);
  const replay = MechanismReplayEvidenceSchema.parse(value);
  if (replay.sourceRevision !== input.sourceRevision || replay.studyId !== input.studyId
    || replay.mechanismInputDigest !== input.mechanismInputDigest) {
    throw new Error("Mechanism replay binding does not match its canonical input");
  }
  const expectedTables = {
    bodyIds: input.bodies.map(({ id }) => id),
    jointIds: input.joints.map(({ id }) => id),
    colliderIds: input.colliders.map(({ id }) => id),
    clearancePairIds: input.clearancePairs.map(({ id }) => id),
  };
  for (const [name, expected] of Object.entries(expectedTables)) {
    const actual = replay[name as keyof typeof expectedTables];
    if (!sorted(actual) || !sameIds(actual, expected)) {
      throw new Error(`Mechanism replay ${name} must be the complete sorted input ID table`);
    }
  }

  let previousStep = -1;
  for (const [index, frame] of replay.frames.entries()) {
    if (frame.sourceRevision !== replay.sourceRevision) {
      throw new Error("Mechanism frame revision does not match replay revision");
    }
    if (frame.studyId !== replay.studyId || frame.mechanismInputDigest !== replay.mechanismInputDigest) {
      throw new Error("Mechanism frame binding does not match replay binding");
    }
    if (frame.stepIndex <= previousStep) throw new Error("Mechanism frame steps must be strictly increasing");
    if (frame.stepIndex !== index * input.outputStrideSteps) {
      throw new Error("Mechanism frame steps do not match the configured output cadence");
    }
    if (!sameIds(frame.bodies.map(({ bodyId }) => bodyId), replay.bodyIds)) {
      throw new Error("Mechanism frame body IDs do not match replay bodies");
    }
    if (!sameIds(frame.joints.map(({ jointId }) => jointId), replay.jointIds)) {
      throw new Error("Mechanism frame joint IDs do not match replay joints");
    }
    for (const state of frame.joints) {
      if (input.joints.find(({ id }) => id === state.jointId)?.kind !== state.kind) {
        throw new Error(`Mechanism frame joint kind does not match input joint: ${state.jointId}`);
      }
    }
    previousStep = frame.stepIndex;
  }
  if (previousStep !== input.durationSteps) {
    throw new Error("Mechanism replay does not contain the complete configured duration");
  }

  const colliders = new Set(replay.colliderIds);
  const colliderById = new Map(input.colliders.map((collider) => [collider.id, collider]));
  const activeContacts = new Set<string>();
  const activeStarts = new Map<string, number>();
  const contactIntervals = new Map<string, [number, number][]>();
  const sameStepPenetration = new Map<string, number>();
  let maximumPenetrationM = 0;
  let previousContactKey = "";
  for (const contact of replay.contacts) {
    if (contact.stepIndex > input.durationSteps) {
      throw new Error("Mechanism contact is after the configured duration");
    }
    if (!colliders.has(contact.firstColliderId) || !colliders.has(contact.secondColliderId)) {
      throw new Error("Mechanism contact references an unknown collider");
    }
    const firstCollider = colliderById.get(contact.firstColliderId)!;
    const secondCollider = colliderById.get(contact.secondColliderId)!;
    if ((firstCollider.membershipMask & secondCollider.filterMask) === 0
      || (secondCollider.membershipMask & firstCollider.filterMask) === 0) {
      throw new Error("Mechanism contact is disabled by collider collision masks");
    }
    if (codeUnitCompare(contact.firstColliderId, contact.secondColliderId) >= 0) {
      throw new Error("Mechanism contact collider pair must be canonical");
    }
    const pair = pairKey(contact.firstColliderId, contact.secondColliderId);
    const eventKey = `${String(contact.stepIndex).padStart(9, "0")}/${pair}/${contact.phase}`;
    if (codeUnitCompare(eventKey, previousContactKey) <= 0) {
      throw new Error("Mechanism contact events must be canonically sorted");
    }
    previousContactKey = eventKey;
    if (contact.phase === "begin") {
      if (activeContacts.has(pair)) throw new Error("Mechanism contact begins while already active");
      activeContacts.add(pair);
      activeStarts.set(pair, contact.stepIndex);
    } else if (!activeContacts.has(pair)) {
      throw new Error(contact.phase === "persist"
        ? "Mechanism contact persists before it begins"
        : "Mechanism contact ends before it begins");
    }
    if (contact.phase === "end") {
      if (contact.penetrationM !== 0 || contact.normalForceN !== 0) {
        throw new Error("Mechanism contact end must have zero penetration and force");
      }
      const intervals = contactIntervals.get(pair) ?? [];
      intervals.push([activeStarts.get(pair)!, contact.stepIndex]);
      contactIntervals.set(pair, intervals);
      activeContacts.delete(pair);
      activeStarts.delete(pair);
    }
    maximumPenetrationM = Math.max(maximumPenetrationM, contact.penetrationM);
    sameStepPenetration.set(`${contact.stepIndex}/${pair}`, contact.penetrationM);
  }
  for (const [pair, start] of activeStarts) {
    const intervals = contactIntervals.get(pair) ?? [];
    intervals.push([start, input.durationSteps]);
    contactIntervals.set(pair, intervals);
  }

  const clearancePairs = new Map(input.clearancePairs.map((pair) => [pair.id, pair]));
  const sampled = new Set<string>();
  let minimumRequestedClearanceM = Number.POSITIVE_INFINITY;
  let previousSampleKey = "";
  for (const sample of replay.clearanceSamples) {
    const pair = clearancePairs.get(sample.pairId);
    if (!pair || pair.firstColliderId !== sample.firstColliderId || pair.secondColliderId !== sample.secondColliderId) {
      throw new Error("Mechanism clearance sample does not match its canonical query pair");
    }
    if (sample.stepIndex % input.outputStrideSteps !== 0 || sample.stepIndex > input.durationSteps) {
      throw new Error("Mechanism clearance sample is outside the configured output cadence");
    }
    const sampleKey = `${String(sample.stepIndex).padStart(9, "0")}/${sample.pairId}`;
    if (codeUnitCompare(sampleKey, previousSampleKey) <= 0) {
      throw new Error("Mechanism clearance samples must be canonically sorted");
    }
    previousSampleKey = sampleKey;
    sampled.add(sampleKey);
    minimumRequestedClearanceM = Math.min(minimumRequestedClearanceM, sample.distanceM);
    const contactActive = (contactIntervals.get(pairKey(sample.firstColliderId, sample.secondColliderId)) ?? [])
      .some(([start, end]) => sample.stepIndex >= start && sample.stepIndex <= end);
    if (sample.distanceM < 0 && !contactActive) {
      throw new Error("Mechanism penetration has no active matching contact");
    }
    if (sample.distanceM < 0) {
      const contactDepth = sameStepPenetration.get(
        `${sample.stepIndex}/${pairKey(sample.firstColliderId, sample.secondColliderId)}`,
      );
      if (contactDepth === undefined
        || Math.abs(contactDepth + sample.distanceM) > MECHANISM_CONTACT_DEPTH_TOLERANCE_M) {
        throw new Error("Mechanism clearance penetration does not match same-step contact depth");
      }
    }
    if (sample.distanceM > 0 && contactActive) {
      throw new Error("Mechanism active contact cannot have positive clearance");
    }
  }
  for (const frame of replay.frames) for (const pairId of replay.clearancePairIds) {
    if (!sampled.has(`${String(frame.stepIndex).padStart(9, "0")}/${pairId}`)) {
      throw new Error("Mechanism replay is missing a requested clearance sample");
    }
  }
  const derivedMinimum = replay.clearancePairIds.length === 0 ? null : minimumRequestedClearanceM;
  const canonical = {
    ...replay, truthLevel: "unverified-replay" as const,
    encodingVersion: MECHANISM_REPLAY_ENCODING_VERSION, fixedStepHz: MECHANISM_STEP_HZ,
    maximumPenetrationM, minimumRequestedClearanceM: derivedMinimum,
  };
  const canonicalBytes = new TextEncoder().encode(canonicalJson(canonical));
  const frozen = freezeSnapshot({ ...canonical, replayDigest: await sha256(canonicalBytes) });
  const issued = Object.defineProperty({ ...frozen }, "canonicalBytes", {
    enumerable: true,
    get: () => canonicalBytes.slice(),
  });
  return Object.freeze(issued) as MechanismReplay;
}
