import { defineDesignDocument } from "../../cad/document-schema";

export type Se6Point = readonly [number, number, number];
export const SE6_STAGE_IDS = ["base", "axis-1", "axis-2", "axis-3", "axis-4", "axis-5", "axis-6"] as const;
/** Exact CAD anchors are registered to these existing 52-part display interfaces. */
export const SE6_DISPLAY_JOINT_ANCHORS_MM = [
  [0, 0, 300], [0, 0, 340], [420, 0, 340], [650, 0, 520],
  [720, 0, 520], [790, 0, 520],
] as const;
const displayAnchorM = (index: number): Se6Point => SE6_DISPLAY_JOINT_ANCHORS_MM[index]!
  .map((value) => value / 1_000) as unknown as Se6Point;
export const SE6_JOINTS = [
  { id: "joint-1", first: "base", second: "axis-1", anchor: displayAnchorM(0), axis: [0, 0, 1], limits: [-Math.PI, Math.PI] },
  { id: "joint-2", first: "axis-1", second: "axis-2", anchor: displayAnchorM(1), axis: [0, 1, 0], limits: [-2.2, 2.2] },
  { id: "joint-3", first: "axis-2", second: "axis-3", anchor: displayAnchorM(2), axis: [0, 1, 0], limits: [-2.4, 2.4] },
  { id: "joint-4", first: "axis-3", second: "axis-4", anchor: displayAnchorM(3), axis: [1, 0, 0], limits: [-Math.PI, Math.PI] },
  { id: "joint-5", first: "axis-4", second: "axis-5", anchor: displayAnchorM(4), axis: [0, 1, 0], limits: [-2, 2] },
  { id: "joint-6", first: "axis-5", second: "axis-6", anchor: displayAnchorM(5), axis: [1, 0, 0], limits: [-Math.PI, Math.PI] },
] as const;

const zeroTransform = {
  position: { x: { value: 0, unit: "m" as const }, y: { value: 0, unit: "m" as const }, z: { value: 0, unit: "m" as const } },
  orientation: { roll: { value: 0, unit: "rad" as const }, pitch: { value: 0, unit: "rad" as const }, yaw: { value: 0, unit: "rad" as const } },
};
const transform = (position: Se6Point, rotation: Se6Point) => ({
  position: { x: { value: position[0], unit: "m" as const }, y: { value: position[1], unit: "m" as const }, z: { value: position[2], unit: "m" as const } },
  orientation: { roll: { value: rotation[0], unit: "rad" as const }, pitch: { value: rotation[1], unit: "rad" as const }, yaw: { value: rotation[2], unit: "rad" as const } },
});
const add = (left: Se6Point, right: Se6Point): Se6Point => left.map((value, axis) => value + right[axis]!) as unknown as Se6Point;
const scale = (value: Se6Point, factor: number): Se6Point => value.map((entry) => entry * factor) as unknown as Se6Point;
const subtract = (left: Se6Point, right: Se6Point): Se6Point => left.map((value, axis) => value - right[axis]!) as unknown as Se6Point;
const unit = (value: Se6Point): Se6Point => scale(value, 1 / Math.hypot(...value));
const rotationForAxis = ([x, y, z]: Se6Point): Se6Point => {
  if (Math.abs(y) < 1e-12) return [0, Math.atan2(x, z), 0];
  if (Math.abs(x) < 1e-12 && Math.abs(z) < 1e-12) return [-Math.sign(y) * Math.PI / 2, 0, 0];
  throw new Error("SE-6 primitive axis is outside the supported construction planes");
};

type MutableGeometry = {
  frames: unknown[]; sketches: unknown[]; features: unknown[]; bodies: { id: string; featureId: string }[];
  bodyIds: Map<string, string[]>;
};
const addBody = (state: MutableGeometry, componentId: string, id: string, frame: unknown, sketch: unknown) => {
  state.frames.push(frame); state.sketches.push(sketch);
  state.features.push({ id: `${id}-feature`, kind: "extrude", sketchId: `${id}-sketch`,
    distanceM: (sketch as { distanceM: number }).distanceM });
  state.bodies.push({ id: `${id}-body`, featureId: `${id}-feature` });
  state.bodyIds.get(componentId)!.push(`${id}-body`);
};
function addBox(state: MutableGeometry, componentId: string, id: string, start: Se6Point, end: Se6Point, width: number) {
  const delta = subtract(end, start), length = Math.hypot(...delta);
  const frameId = `${id}-frame`;
  addBody(state, componentId, id,
    { id: frameId, label: id, parentId: "world", transform: transform(start, rotationForAxis(unit(delta))) },
    { id: `${id}-sketch`, plane: `frame:${frameId}`, distanceM: length,
      constraints: [
        { id: `${id}-width`, kind: "distance", first: { entityId: `${id}-outline`, point: "left" },
          second: { entityId: `${id}-outline`, point: "right" }, axis: "x", valueM: width },
        { id: `${id}-height`, kind: "distance", first: { entityId: `${id}-outline`, point: "bottom" },
          second: { entityId: `${id}-outline`, point: "top" }, axis: "y", valueM: width },
      ],
      entities: [{ id: `${id}-outline`, kind: "rectangle", centerM: [0, 0], sizeM: [width, width] }] });
}
function addJointHalf(state: MutableGeometry, joint: typeof SE6_JOINTS[number], side: "first" | "second") {
  const componentId = joint[side], id = `${joint.id}-${side}-interface`, height = .024;
  const radius = joint.id === "joint-1" || joint.id === "joint-2" ? .014 : .032;
  const frameId = `${id}-frame`, start = add(joint.anchor, scale(joint.axis, -height / 2));
  const right = side === "second";
  const sweep = Math.PI * .9, middle = right ? 0 : Math.PI;
  const startAngleRad = middle - sweep / 2, endAngleRad = middle + sweep / 2;
  const at = (angle: number) => [radius * Math.cos(angle), radius * Math.sin(angle)];
  const chordStart = at(endAngleRad), chordEnd = at(startAngleRad);
  addBody(state, componentId, id,
    { id: frameId, label: id, parentId: "world", transform: transform(start, rotationForAxis(joint.axis)) },
    { id: `${id}-sketch`, plane: `frame:${frameId}`, distanceM: height,
      constraints: [
        { id: `${id}-radius`, kind: "radius", entityId: `${id}-arc`, valueM: radius },
        { id: `${id}-start`, kind: "coincident", first: { entityId: `${id}-arc`, point: "start" },
          second: { entityId: `${id}-chord`, point: "end" } },
        { id: `${id}-end`, kind: "coincident", first: { entityId: `${id}-arc`, point: "end" },
          second: { entityId: `${id}-chord`, point: "start" } },
        { id: `${id}-sweep`, kind: "angle", vertex: { entityId: `${id}-arc`, point: "center" },
          firstDirection: { entityId: `${id}-arc`, point: "start" },
          secondDirection: { entityId: `${id}-arc`, point: "end" }, valueRad: sweep },
      ],
      entities: [
        { id: `${id}-arc`, kind: "arc", centerM: [0, 0], radiusM: radius, startAngleRad, endAngleRad },
        { id: `${id}-chord`, kind: "line", startM: chordStart, endM: chordEnd },
      ] });
}

export async function createSe6MechanismGeometry() {
  const state: MutableGeometry = { frames: [{ id: "world", label: "World", transform: zeroTransform }],
    sketches: [], features: [], bodies: [], bodyIds: new Map(SE6_STAGE_IDS.map((id) => [id, []])) };
  addBox(state, "base", "base-pedestal", [0, 0, 0], [0, 0, .06], .18);
  const anchors = SE6_JOINTS.map(({ anchor }) => anchor);
  const links = [
    { id: "axis-1-link", body: "axis-1", start: anchors[0]!, end: anchors[1]!, width: .024 },
    { id: "axis-2-link", body: "axis-2", start: anchors[1]!, end: anchors[2]!, width: .08 },
    { id: "axis-3-link", body: "axis-3", start: anchors[2]!, end: anchors[3]!, width: .075 },
    { id: "axis-4-link", body: "axis-4", start: anchors[3]!, end: anchors[4]!, width: .06 },
    { id: "axis-5-link", body: "axis-5", start: anchors[4]!, end: anchors[5]!, width: .055 },
    { id: "axis-6-tool", body: "axis-6", start: anchors[5]!, end: [.94, 0, .45] as Se6Point, width: .065 },
  ];
  for (const link of links) {
    const direction = unit(subtract(link.end, link.start));
    const margin = Math.min(.04, Math.hypot(...subtract(link.end, link.start)) / 2 - .005);
    addBox(state, link.body, link.id, add(link.start, scale(direction, margin)),
      add(link.end, scale(direction, -margin)), link.width);
  }
  addBox(state, "axis-1", "axis-1-balance-positive", [0, .1, .22], [0, .1, .32], .08);
  addBox(state, "axis-1", "axis-1-balance-negative", [0, -.1, .22], [0, -.1, .32], .08);
  for (const joint of SE6_JOINTS) { addJointHalf(state, joint, "first"); addJointHalf(state, joint, "second"); }
  return defineDesignDocument({
    id: "se6-mechanism", label: "SE-6 six-axis exact mechanism", schemaVersion: 6,
    units: { length: "m", angle: "rad", mass: "kg" },
    createdBy: { kind: "agent", id: "mechanism-browser-gate" },
    frames: state.frames, parameters: [], sketches: state.sketches.map(({ distanceM: _distance, ...sketch }: any) => sketch),
    features: state.features, bodies: state.bodies,
    components: SE6_STAGE_IDS.map((id) => ({ id: `${id}-component`, bodyIds: state.bodyIds.get(id)! })),
    instances: SE6_STAGE_IDS.map((id) => ({ id, componentId: `${id}-component`, frameId: "world" })),
    mates: [], namedSelections: [], materials: [], studies: [],
  });
}
