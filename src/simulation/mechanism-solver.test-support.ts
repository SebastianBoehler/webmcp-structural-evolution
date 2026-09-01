import { defineMechanismInput, type MechanismInput } from "./mechanism-contract";

const digest = (value: string) => value.repeat(64);

export async function mechanismSolverInput(overrides: Record<string, unknown> = {}): Promise<MechanismInput> {
  return defineMechanismInput({
    sourceRevision: digest("a"), studyId: "falling-body",
    bodies: [
      { id: "ground", kind: "fixed", sourceBodyIds: ["ground-source"],
        transform: { positionM: [0, -2, 0], orientation: [0, 0, 0, 1] } },
      { id: "link", kind: "dynamic", sourceBodyIds: ["link-source"],
        transform: { positionM: [0, 1, 0], orientation: [0, 0, 0, 1] },
        massKg: 2, centerOfMassM: [0.25, 0, 0], principalInertiaKgM2: [1, 1.5, 2],
        principalInertiaFrameToBody: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
        initialLinearVelocityMps: [0, 0, 0], initialAngularVelocityRadS: [0, 0, 0] },
    ],
    colliders: [
      { id: "ground-collider", bodyId: "ground", sourceBodyId: "ground-source",
        sourceArtifactIds: [digest("b")], bodyLocalTransform: { positionM: [0, 0, 0], orientation: [0, 0, 0, 1] },
        approximation: { kind: "exact-primitive", maximumSurfaceDeviationM: 0 },
        shape: { kind: "box", halfExtentsM: [2, 0.5, 2] }, membershipMask: 1, filterMask: 1 },
      { id: "link-collider", bodyId: "link", sourceBodyId: "link-source",
        sourceArtifactIds: [digest("b")], bodyLocalTransform: { positionM: [0, 0, 0], orientation: [0, 0, 0, 1] },
        approximation: { kind: "exact-primitive", maximumSurfaceDeviationM: 0 },
        shape: { kind: "box", halfExtentsM: [0.25, 0.25, 0.25] }, membershipMask: 1, filterMask: 1 },
    ],
    joints: [], gravityWorldMps2: [0, -9.81, 0], pointForces: [],
    durationSteps: 4, outputStrideSteps: 2, clearancePairs: [], ...overrides,
  });
}
