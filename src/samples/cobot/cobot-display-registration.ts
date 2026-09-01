import { multiplyQuaternion, rotateVector, type Quat, type Vec3 } from "../../simulation/mechanism-rapier-math";

export interface MechanismStageBody {
  readonly bodyId: string;
  readonly positionM: readonly [number, number, number];
  readonly orientation: readonly [number, number, number, number];
}

export interface MechanismDisplayJointAnchor {
  readonly jointId: string;
  readonly firstBodyId: string;
  readonly secondBodyId: string;
  readonly exactAnchorM: readonly [number, number, number];
  readonly displayAnchorMm: readonly [number, number, number];
}

/**
 * A rigid, unit-converting registration from exact CAD stage coordinates to
 * the persisted 52-part millimetre display assembly.  Every anchor must share
 * the same translation: otherwise the two assemblies are not rigidly congruent.
 */
export interface MechanismDisplayRegistration {
  /** Exact-world to display-world rigid rotation. Defaults to identity. */
  readonly orientation?: readonly [number, number, number, number];
  readonly jointAnchors: readonly MechanismDisplayJointAnchor[];
}

declare const coordinateSpace: unique symbol;
export type ReferenceExactStagePoint = readonly [number, number, number]
  & { readonly [coordinateSpace]: "reference-exact-stage" };
export type CurrentExactWorldPoint = readonly [number, number, number]
  & { readonly [coordinateSpace]: "current-exact-world" };
export type DisplayPoint = readonly [number, number, number]
  & { readonly [coordinateSpace]: "display-mm" };

export interface RegisteredJointInterface {
  readonly jointId: string;
  readonly firstMm: readonly [number, number, number];
  readonly secondMm: readonly [number, number, number];
}

const clean = (value: number) => Math.abs(value) < 1e-10 || Object.is(value, -0) ? 0 : value;
const mm = (value: readonly number[]) => value.map(clean) as [number, number, number];
const subtract = (left: readonly number[], right: readonly number[]) =>
  left.map((value, index) => value - right[index]!) as unknown as Vec3;
const inverse = (quaternion: Quat): Quat => [-quaternion[0], -quaternion[1], -quaternion[2], quaternion[3]];
const identity: Quat = [0, 0, 0, 1];
export const referenceExactStagePoint = (value: readonly [number, number, number]) => value as ReferenceExactStagePoint;
export const currentExactWorldPoint = (value: readonly [number, number, number]) => value as CurrentExactWorldPoint;
export const displayPoint = (value: readonly [number, number, number]) => value as DisplayPoint;

function orientationFor(registration: MechanismDisplayRegistration): Quat {
  return (registration.orientation ?? identity) as Quat;
}

/** Fails closed when the requested mapping cannot be one rigid transform. */
export function validateMechanismDisplayRegistration(registration: MechanismDisplayRegistration): void {
  if (registration.jointAnchors.length === 0) throw new Error("Mechanism display registration has no joint anchors");
  const orientation = orientationFor(registration);
  if (orientation.length !== 4 || !orientation.every(Number.isFinite) || Math.abs(Math.hypot(...orientation) - 1) > 1e-9) {
    throw new Error("Mechanism display registration orientation is invalid");
  }
  const translation = (anchor: MechanismDisplayJointAnchor): Vec3 => anchor.displayAnchorMm.map((value, axis) =>
    value - rotateVector(orientation, anchor.exactAnchorM)[axis]! * 1_000) as unknown as Vec3;
  const reference = translation(registration.jointAnchors[0]!);
  for (const anchor of registration.jointAnchors) {
    if (anchor.exactAnchorM.length !== 3 || anchor.displayAnchorMm.length !== 3
      || ![...anchor.exactAnchorM, ...anchor.displayAnchorMm].every(Number.isFinite)) {
      throw new Error(`Mechanism display registration is invalid at ${anchor.jointId}`);
    }
    if (Math.hypot(...subtract(translation(anchor), reference)) > 1e-6) {
      throw new Error(`Mechanism display registration is non-rigid at ${anchor.jointId}`);
    }
  }
}

function exactDelta(initial: MechanismStageBody, current: MechanismStageBody) {
  const initialOrientation = initial.orientation as Quat, currentOrientation = current.orientation as Quat;
  const orientation = multiplyQuaternion(currentOrientation, inverse(initialOrientation));
  const positionM = subtract(current.positionM, rotateVector(orientation, initial.positionM));
  return { orientation, positionM };
}

function registrationTranslationMm(registration: MechanismDisplayRegistration): Vec3 {
  const anchor = registration.jointAnchors[0];
  if (!anchor) throw new Error("Mechanism display registration has no joint anchors");
  const orientation = orientationFor(registration);
  return anchor.displayAnchorMm.map((value, axis) =>
    value - rotateVector(orientation, anchor.exactAnchorM)[axis]! * 1_000) as unknown as Vec3;
}

/** Maps a point already emitted by the solver in current exact world coordinates. */
export function registerCurrentExactWorldPoint(
  pointM: CurrentExactWorldPoint,
  registration: MechanismDisplayRegistration,
): DisplayPoint {
  validateMechanismDisplayRegistration(registration);
  const rotated = rotateVector(orientationFor(registration), pointM);
  const translation = registrationTranslationMm(registration);
  return displayPoint(mm(rotated.map((value, axis) => value * 1_000 + translation[axis]!)));
}

/** Advances a reference exact-stage point by its body frame into current exact world coordinates. */
export function advanceReferenceExactStagePoint(
  pointM: ReferenceExactStagePoint,
  initial: MechanismStageBody,
  current: MechanismStageBody,
): CurrentExactWorldPoint {
  const delta = exactDelta(initial, current);
  const moved = rotateVector(delta.orientation, pointM).map((value, axis) => value + delta.positionM[axis]!);
  return currentExactWorldPoint(mm(moved));
}

/** Maps a rest-stage point by body motion, then by the same global registration as overlays. */
export function registerReferenceExactStagePoint(
  pointM: ReferenceExactStagePoint,
  initial: MechanismStageBody,
  current: MechanismStageBody,
  registration: MechanismDisplayRegistration,
): DisplayPoint {
  return registerCurrentExactWorldPoint(advanceReferenceExactStagePoint(pointM, initial, current), registration);
}

/** Converts a persisted display rest point into the exact reference-stage point it represents. */
export function referenceExactStagePointForDisplay(
  pointMm: DisplayPoint,
  registration: MechanismDisplayRegistration,
): ReferenceExactStagePoint {
  validateMechanismDisplayRegistration(registration);
  const translation = registrationTranslationMm(registration);
  const translated = pointMm.map((value, axis) => (value - translation[axis]!) / 1_000) as unknown as Vec3;
  return referenceExactStagePoint(rotateVector(inverse(orientationFor(registration)), translated));
}

/** Converts body-frame rotation into the registered display frame. */
export function registeredStageDeltaOrientation(
  initial: MechanismStageBody, current: MechanismStageBody, registration: MechanismDisplayRegistration,
): Quat {
  const orientation = orientationFor(registration), delta = exactDelta(initial, current).orientation;
  return multiplyQuaternion(multiplyQuaternion(orientation, delta), inverse(orientation));
}

export function registeredJointInterfaces(
  initial: ReadonlyMap<string, MechanismStageBody>,
  current: ReadonlyMap<string, MechanismStageBody>,
  registration: MechanismDisplayRegistration,
): readonly RegisteredJointInterface[] {
  validateMechanismDisplayRegistration(registration);
  return Object.freeze(registration.jointAnchors.map((anchor) => {
    const firstInitial = initial.get(anchor.firstBodyId), firstCurrent = current.get(anchor.firstBodyId);
    const secondInitial = initial.get(anchor.secondBodyId), secondCurrent = current.get(anchor.secondBodyId);
    if (!firstInitial || !firstCurrent || !secondInitial || !secondCurrent) {
      throw new Error(`Mechanism display registration stage is unresolved: ${anchor.jointId}`);
    }
    return Object.freeze({ jointId: anchor.jointId,
      firstMm: registerReferenceExactStagePoint(referenceExactStagePoint(anchor.exactAnchorM), firstInitial, firstCurrent, registration),
      secondMm: registerReferenceExactStagePoint(referenceExactStagePoint(anchor.exactAnchorM), secondInitial, secondCurrent, registration) });
  }));
}
