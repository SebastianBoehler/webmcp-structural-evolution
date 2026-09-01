import { describe, expect, it } from "vitest";

import type { AssemblyVisualPart } from "../../viewer/render-envelope";
import type { MechanismFrame } from "../../simulation/mechanism-contract";
import { rotateVector } from "../../simulation/mechanism-rapier-math";
import { SE6_DISPLAY_JOINT_ANCHORS_MM, SE6_JOINTS } from "./cobot-mechanism-geometry";
import {
  createMechanismVisualFrame,
  type MechanismVisualInput,
  type MechanismVisualReplay,
} from "./cobot-mechanism-visuals";

const identity = [0, 0, 0, 1] as const;
const body = (
  bodyId: string,
  positionM: readonly [number, number, number],
  orientation: readonly [number, number, number, number] = identity,
): MechanismFrame["bodies"][number] => ({
  bodyId, positionM: [...positionM], orientation: [...orientation],
  linearVelocityMps: [0, 0, 0], angularVelocityRadS: [0, 0, 0],
});
const frame = (stepIndex: number, bodies: MechanismFrame["bodies"]): MechanismFrame => ({
  sourceRevision: "a".repeat(64), studyId: "se6-motion",
  mechanismInputDigest: "b".repeat(64), stepIndex, bodies, joints: [],
});
const part = (id: string, center: readonly [number, number, number]): AssemblyVisualPart => ({
  id, selectionId: id, label: id, kind: "box", size: [20, 30, 40], center,
  rotation: [0, 0, Math.PI / 2], material: "structural", appearance: "component",
});

describe("SE-6 mechanism replay visuals", () => {
  it("uses exact anchors whose every stage distance matches the persisted display assembly", () => {
    expect(SE6_JOINTS.map(({ anchor }) => anchor.map((value) => value * 1_000))).toEqual(SE6_DISPLAY_JOINT_ANCHORS_MM);
    for (let index = 1; index < SE6_JOINTS.length; index += 1) {
      const exact = Math.hypot(...SE6_JOINTS[index]!.anchor.map((value, axis) =>
        value - SE6_JOINTS[index - 1]!.anchor[axis]!));
      const visible = Math.hypot(...SE6_DISPLAY_JOINT_ANCHORS_MM[index]!.map((value, axis) =>
        value - SE6_DISPLAY_JOINT_ANCHORS_MM[index - 1]![axis]!)) / 1_000;
      expect(exact).toBeCloseTo(visible, 12);
    }
  });

  it("applies the full body-frame delta to every owned part pose", () => {
    const quarterTurn = [0, 0, Math.SQRT1_2, Math.SQRT1_2] as const;
    const halfTurn = [0, 0, 1, 0] as const;
    const replay: MechanismVisualReplay = {
      frames: [
        frame(0, [body("axis-2", [1, 0, 0], quarterTurn)]),
        frame(4, [body("axis-2", [2, 0, 0], halfTurn)]),
      ], contacts: [], clearanceSamples: [],
    };
    const originals = [part("arm-shell", [1_000, 1_000, 0]), part("arm-cover", [1_100, 1_000, 0])];

    const visual = createMechanismVisualFrame(
      originals, { "arm-shell": "axis-2", "arm-cover": "axis-2" }, { colliders: [] }, replay, 1,
    );

    expect(visual.parts.map(({ selectionId }) => selectionId)).toEqual(["arm-shell", "arm-cover"]);
    expect(visual.parts[0]).toMatchObject({
      kind: "box", size: [20, 30, 40], material: "structural",
    });
    expect(visual.parts[0]!.center[0]).toBeCloseTo(1_000, 9);
    expect(visual.parts[0]!.center.slice(1)).toEqual([0, 0]);
    expect(visual.parts[1]!.center[0]).toBeCloseTo(1_000, 9);
    expect(visual.parts[1]!.center[1]).toBeCloseTo(100, 9);
    expect(visual.parts[1]!.center[2]).toBe(0);
    expect(visual.parts[0]!.rotation![0]).toBeCloseTo(0, 12);
    expect(visual.parts[0]!.rotation![1]).toBeCloseTo(0, 12);
    expect(Math.abs(visual.parts[0]!.rotation![2])).toBeCloseTo(Math.PI, 12);
  });

  it("derives clearance and active-contact overlays from the selected frame step", () => {
    const replay: MechanismVisualReplay = {
      frames: [
        frame(0, [body("base", [0, 0, 0]), body("link", [1, 0, 0])]),
        frame(4, [body("base", [0, 0, 0]), body("link", [2, 0, 0])]),
      ],
      clearanceSamples: [
        { stepIndex: 0, pairId: "clearance", firstColliderId: "base-collider",
          secondColliderId: "link-collider", distanceM: 0.8 },
        { stepIndex: 4, pairId: "clearance", firstColliderId: "base-collider",
          secondColliderId: "link-collider", distanceM: 1.8 },
      ],
      contacts: [
        { stepIndex: 0, phase: "begin", firstColliderId: "old-first", secondColliderId: "old-second",
          pointM: [0.2, 0, 0], normalWorld: [1, 0, 0], penetrationM: 0.001, normalForceN: 4 },
        { stepIndex: 4, phase: "end", firstColliderId: "old-first", secondColliderId: "old-second",
          pointM: [0.2, 0, 0], normalWorld: [1, 0, 0], penetrationM: 0, normalForceN: 0 },
        { stepIndex: 4, phase: "begin", firstColliderId: "base-collider", secondColliderId: "link-collider",
          pointM: [0.4, 0, 0], normalWorld: [1, 0, 0], penetrationM: 0.002, normalForceN: 9 },
      ],
    };
    const input: MechanismVisualInput = { colliders: [
      { id: "base-collider", bodyId: "base",
        bodyLocalTransform: { positionM: [0, 0, 0], orientation: identity } },
      { id: "link-collider", bodyId: "link",
        bodyLocalTransform: { positionM: [1, 0, 0], orientation: identity } },
    ] };

    const visual = createMechanismVisualFrame([], {}, input, replay, 1);

    expect(visual.stepIndex).toBe(4);
    expect(visual.overlay.clearances).toEqual([
      expect.objectContaining({ pairId: "clearance", distanceM: 1.8 }),
    ]);
    expect(visual.overlay.contacts).toEqual([
      expect.objectContaining({ firstColliderId: "base-collider", penetrationM: 0.002 }),
    ]);
    expect(visual.overlay.parts.map(({ selectionId, center }) => ({ selectionId, center }))).toEqual([
      { selectionId: "mechanism-clearance:clearance", center: [1_500, 0, 0] },
      { selectionId: "mechanism-contact:base-collider:link-collider", center: [400, 0, 0] },
    ]);
  });

  it("maps current exact-world clearance and contact points once through a translated, rotated registration", () => {
    const quarterTurn = [0, 0, Math.SQRT1_2, Math.SQRT1_2] as const;
    const halfTurn = [0, 0, 1, 0] as const;
    const replay: MechanismVisualReplay = {
      frames: [
        frame(0, [body("base", [1, 1, 0]), body("tool", [0, 0, 0])]),
        frame(4, [body("base", [2, 3, 0], halfTurn), body("tool", [0, 0, 0])]),
      ],
      clearanceSamples: [{ stepIndex: 4, pairId: "moving", firstColliderId: "first", secondColliderId: "second", distanceM: .01 }],
      contacts: [{ stepIndex: 4, phase: "begin", firstColliderId: "first", secondColliderId: "second",
        pointM: [4, 5, 0], normalWorld: [0, 1, 0], penetrationM: .001, normalForceN: 1 }],
    };
    const input = {
      colliders: [
        { id: "first", bodyId: "base", bodyLocalTransform: { positionM: [.2, .1, 0], orientation: identity } },
        { id: "second", bodyId: "base", bodyLocalTransform: { positionM: [-.2, .3, 0], orientation: identity } },
      ],
      displayRegistration: { orientation: quarterTurn, jointAnchors: [{ jointId: "tool-interface",
        firstBodyId: "base", secondBodyId: "tool", exactAnchorM: [0, 0, 0], displayAnchorMm: [1_000, 2_000, 0] }] },
    } as MechanismVisualInput;

    const visual = createMechanismVisualFrame([], {}, input, replay, 1);

    const expected = [[-1_800, 4_000, 0], [-4_000, 6_000, 0]] as const;
    visual.overlay.parts.forEach(({ center }, index) => center.forEach((value, axis) => {
      expect(value).toBeCloseTo(expected[index]![axis]!, 9);
    }));
  });

  it("rejects incomplete visual ownership instead of leaving static parts behind", () => {
    const replay: MechanismVisualReplay = {
      frames: [frame(0, [body("base", [0, 0, 0])])], contacts: [], clearanceSamples: [],
    };
    expect(() => createMechanismVisualFrame(
      [part("unowned", [0, 0, 0])], {}, { colliders: [] }, replay, 0,
    )).toThrow("Mechanism visual part has no body owner: unowned");
  });

  it("registers exact stage anchors to the legacy display joints through every replay pose", () => {
    const exactAnchor = [.42, 0, .34] as const;
    const displayAnchor = [420, 0, 340] as const;
    const quarterTurn = [0, Math.SQRT1_2, 0, Math.SQRT1_2] as const;
    const halfTurn = [0, 1, 0, 0] as const;
    const around = (orientation: typeof quarterTurn) => exactAnchor.map((value, axis) =>
      value - rotateVector(orientation, exactAnchor)[axis]!) as [number, number, number];
    const replay: MechanismVisualReplay = {
      frames: [
        frame(0, [body("axis-2", [0, 0, 0]), body("axis-3", [0, 0, 0])]),
        frame(4, [body("axis-2", around(quarterTurn), quarterTurn), body("axis-3", around(halfTurn), halfTurn)]),
      ],
      clearanceSamples: [{ stepIndex: 4, pairId: "registered", firstColliderId: "first", secondColliderId: "second", distanceM: .01 }],
      contacts: [{ stepIndex: 4, phase: "begin", firstColliderId: "first", secondColliderId: "second",
        pointM: exactAnchor, normalWorld: [0, 1, 0], penetrationM: .001, normalForceN: 1 }],
    };
    const input = {
      colliders: [
        { id: "first", bodyId: "axis-2", bodyLocalTransform: { positionM: exactAnchor, orientation: identity } },
        { id: "second", bodyId: "axis-3", bodyLocalTransform: { positionM: exactAnchor, orientation: identity } },
      ],
      displayRegistration: { jointAnchors: [{ jointId: "joint-3", firstBodyId: "axis-2", secondBodyId: "axis-3",
        exactAnchorM: exactAnchor, displayAnchorMm: displayAnchor }] },
    } as MechanismVisualInput;

    for (const frameIndex of [0, 1]) {
      const visual = createMechanismVisualFrame([part("upper", [420, 0, 340]), part("forearm", [420, 0, 340])],
        { upper: "axis-2", forearm: "axis-3" }, input, replay, frameIndex);
      const interfacePose = (visual as { jointInterfaces?: readonly { firstMm: readonly number[]; secondMm: readonly number[] }[] }).jointInterfaces?.[0];

      expect(interfacePose?.firstMm).toEqual(interfacePose?.secondMm);
      expect(interfacePose?.firstMm).toEqual(displayAnchor);
      if (frameIndex === 1) {
        expect(visual.overlay.parts.map(({ center }) => center)).toEqual([displayAnchor, displayAnchor]);
      }
    }
  });
});
