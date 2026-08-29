import { defineAssemblyDraft, defineInventory, type AssemblyDraft } from "../../domain/design";
import { SE6_CATALOG, se6Component } from "./cobot-catalog";
import { boxVolumeMm, cylinderVolumeMm, mm, mmPoint, orientationRad, transformMm } from "./cobot-values";

const requirement = (
  instanceId: string,
  componentId: string,
  position: readonly [number, number, number],
  rotation: readonly [number, number, number] = [0, 0, 0],
) => ({ instanceId, componentRevision: se6Component(componentId).revision, quantity: 1, transform: transformMm(...position, rotation) });
const axisY = [Math.PI / 2, 0, 0] as const;
const forearmPitch = -Math.atan2(180, 230);

export const SE6_INSTANCE_GROUPS = Object.freeze({
  base: ["base-plate", "base-fastener-nw", "base-fastener-ne", "base-fastener-sw", "base-fastener-se", "pedestal", "j1-turntable", "j1-bearing-ring", "j1-cover"],
  shoulder: ["shoulder-yoke-left", "shoulder-yoke-right", "j2-barrel", "j2-cap-left", "j2-cap-right", "j2-fastener-left", "j2-fastener-right", "shoulder-guard"],
  upperArm: ["shoulder-boss", "upper-arm-link", "elbow-boss", "upper-fastener-shoulder-left", "upper-fastener-shoulder-right", "upper-fastener-elbow-left", "upper-fastener-elbow-right"],
  forearm: ["j3-barrel", "j3-cap-left", "j3-cap-right", "elbow-guard", "forearm-shell", "forearm-cable-cover", "forearm-cover-fastener"],
  wrist: ["j4-roll-housing", "j4-cap", "j4-spacer", "j5-pitch-housing", "j5-cap-left", "j5-cap-right", "j5-spacer", "j6-tool-roll", "j6-cap"],
  tooling: ["tool-flange", "gripper-body", "gripper-jaw-left", "gripper-jaw-right", "finger-pad-left", "finger-pad-right", "calibration-payload"],
  services: ["cable-segment-shoulder", "cable-segment-upper", "cable-segment-elbow", "cable-segment-wrist", "wrist-strain-relief"],
} as const);

const components: AssemblyDraft["components"] = [
  requirement("base-plate", "base-plate", [0, 0, 9]),
  ...[["nw", -105, 105], ["ne", 105, 105], ["sw", -105, -105], ["se", 105, -105]].map(([id, x, y]) => requirement(`base-fastener-${id}`, "base-fastener", [x as number, y as number, 26])),
  requirement("pedestal", "pedestal", [0, 0, 143]),
  requirement("j1-turntable", "turntable", [0, 0, 268]),
  requirement("j1-bearing-ring", "bearing-ring", [0, 0, 300]),
  requirement("j1-cover", "base-cover", [0, 0, 322]),
  requirement("shoulder-yoke-left", "shoulder-yoke", [0, -104, 340]),
  requirement("shoulder-yoke-right", "shoulder-yoke", [0, 104, 340]),
  requirement("j2-barrel", "shoulder-joint", [0, 0, 340], axisY),
  requirement("j2-cap-left", "shoulder-cap", [0, -69, 340], axisY),
  requirement("j2-cap-right", "shoulder-cap", [0, 69, 340], axisY),
  requirement("j2-fastener-left", "shoulder-fastener", [0, -82, 340], axisY),
  requirement("j2-fastener-right", "shoulder-fastener", [0, 82, 340], axisY),
  requirement("shoulder-guard", "shoulder-guard", [-24, 0, 340]),
  requirement("shoulder-boss", "upper-boss", [30, 0, 340], axisY),
  requirement("upper-arm-link", "upper-link", [210, 0, 340]),
  requirement("elbow-boss", "upper-boss", [390, 0, 340], axisY),
  requirement("upper-fastener-shoulder-left", "upper-fastener", [30, -18, 340], axisY),
  requirement("upper-fastener-shoulder-right", "upper-fastener", [30, 18, 340], axisY),
  requirement("upper-fastener-elbow-left", "upper-fastener", [390, -18, 340], axisY),
  requirement("upper-fastener-elbow-right", "upper-fastener", [390, 18, 340], axisY),
  requirement("j3-barrel", "elbow-joint", [420, 0, 340], axisY),
  requirement("j3-cap-left", "elbow-cap", [420, -56, 340], axisY),
  requirement("j3-cap-right", "elbow-cap", [420, 56, 340], axisY),
  requirement("elbow-guard", "elbow-guard", [420, 0, 420]),
  requirement("forearm-shell", "forearm-shell", [535, 0, 430], [0, forearmPitch, 0]),
  requirement("forearm-cable-cover", "forearm-cover", [535, -45, 430], [0, forearmPitch, 0]),
  requirement("forearm-cover-fastener", "cover-fastener", [535, -54, 430], axisY),
  requirement("j4-roll-housing", "wrist-joint", [650, 0, 520], [0, Math.PI / 2, 0]),
  requirement("j4-cap", "wrist-cap", [685, 0, 520], [0, Math.PI / 2, 0]),
  requirement("j4-spacer", "wrist-spacer", [696, 0, 520], [0, Math.PI / 2, 0]),
  requirement("j5-pitch-housing", "wrist-joint", [720, 0, 520], axisY),
  requirement("j5-cap-left", "wrist-cap", [720, -38, 520], axisY),
  requirement("j5-cap-right", "wrist-cap", [720, 38, 520], axisY),
  requirement("j5-spacer", "wrist-spacer", [750, 0, 520], [0, Math.PI / 2, 0]),
  requirement("j6-tool-roll", "wrist-joint", [790, 0, 520], [0, Math.PI / 2, 0]),
  requirement("j6-cap", "wrist-cap", [825, 0, 520], [0, Math.PI / 2, 0]),
  requirement("tool-flange", "tool-flange", [842, 0, 520], [0, Math.PI / 2, 0]),
  requirement("gripper-body", "gripper-body", [900, 0, 520]),
  requirement("gripper-jaw-left", "gripper-jaw", [978, -34, 520]),
  requirement("gripper-jaw-right", "gripper-jaw", [978, 34, 520]),
  requirement("finger-pad-left", "finger-pad", [1024, -34, 520]),
  requirement("finger-pad-right", "finger-pad", [1024, 34, 520]),
  requirement("calibration-payload", "calibration-payload", [1090, 0, 520]),
  requirement("cable-segment-shoulder", "cable-segment", [75, -54, 390], [0, 0, 0]),
  requirement("cable-segment-upper", "cable-segment", [210, -54, 390], [0, 0, 0]),
  requirement("cable-segment-elbow", "cable-segment", [430, -54, 385], [0, forearmPitch, 0]),
  requirement("cable-segment-wrist", "cable-segment", [665, -42, 530], [0, 0, 0]),
  requirement("wrist-strain-relief", "strain-relief", [835, -35, 520], axisY),
];

export const se6Assembly = await defineAssemblyDraft({
  id: "se6-six-axis-cobot", geometryCoordinates: "assembly", components,
  targetEnvelope: boxVolumeMm("se6-upper-arm-design-domain", [360, 130, 110], [210, 0, 340]),
  preservedMounts: [
    { id: "j2-bearing-interface", position: mmPoint(30, 0, 340), orientation: orientationRad(...axisY), diameter: mm(84), fastenerType: "SE-6 qualified bearing interface" },
    { id: "j3-bearing-interface", position: mmPoint(390, 0, 340), orientation: orientationRad(...axisY), diameter: mm(84), fastenerType: "SE-6 qualified bearing interface" },
  ],
  obstacleVolumes: [cylinderVolumeMm("upper-arm-cable-corridor", 14, 360, [210, 0, 340], [0, Math.PI / 2, 0])],
  accessVolumes: [[30, 295], [30, 385], [390, 295], [390, 385]].map(([x, z], index) =>
    cylinderVolumeMm(`upper-arm-fastener-access-${index + 1}`, 5, 110, [x!, 0, z!], axisY)),
  missingComponents: [], incompatibleComponents: [], ambiguousComponents: [],
});

const required = new Map<string, number>();
components.forEach(({ componentRevision, quantity }) => required.set(componentRevision, (required.get(componentRevision) ?? 0) + quantity));
export const SE6_INVENTORY = defineInventory([...required].map(([componentRevision, ownedQuantity]) => ({ componentRevision, ownedQuantity, availability: "available" })));
export { SE6_CATALOG };
