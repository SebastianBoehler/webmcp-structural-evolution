import type { ParametricGraph } from "../domain/component-model";

const m = (value: number) => ({ value, unit: "m" as const });
const point = (x: number, y: number, z: number) => ({ x: m(x), y: m(y), z: m(z) });
const orientation = (yaw = 0) => ({
  roll: { value: 0, unit: "rad" as const },
  pitch: { value: 0, unit: "rad" as const },
  yaw: { value: yaw, unit: "rad" as const },
});
const cylinder = (id: string, center: readonly [number, number, number], radius: number, height: number) => ({
  kind: "cylinder" as const,
  id,
  center: point(...center),
  radius: m(radius),
  height: m(height),
  orientation: orientation(),
});
const box = (id: string, center: readonly [number, number, number], size: readonly [number, number, number]) => ({
  kind: "box" as const, id, center: point(...center), size: point(...size),
});

export const MOTOR_GRAPH: ParametricGraph = { nodes: [
  cylinder("motor-base", [0, 0, 0.0015], 0.012, 0.003),
  { kind: "named-interface", id: "motor-mount-interface", source: "motor-base" },
  cylinder("motor-stator", [0, 0, 0.0067], 0.01125, 0.0076),
  { kind: "union", id: "base-and-stator", left: "motor-mount-interface", right: "motor-stator" },
  cylinder("motor-bell", [0, 0, 0.0114], 0.014, 0.017),
  { kind: "union", id: "motor-body", left: "base-and-stator", right: "motor-bell" },
  cylinder("motor-shaft", [0, 0, 0.02585], 0.0025, 0.0121),
  { kind: "union", id: "motor-body-and-shaft", left: "motor-body", right: "motor-shaft" },
  cylinder("mount-hole-ne", [0.005657, 0.005657, 0.0015], 0.0015, 0.004),
  cylinder("mount-hole-nw", [-0.005657, 0.005657, 0.0015], 0.0015, 0.004),
  cylinder("mount-hole-sw", [-0.005657, -0.005657, 0.0015], 0.0015, 0.004),
  cylinder("mount-hole-se", [0.005657, -0.005657, 0.0015], 0.0015, 0.004),
  { kind: "subtraction", id: "motor-minus-mount-ne", left: "motor-body-and-shaft", right: "mount-hole-ne" },
  { kind: "subtraction", id: "motor-minus-mount-nw", left: "motor-minus-mount-ne", right: "mount-hole-nw" },
  { kind: "subtraction", id: "motor-minus-mount-sw", left: "motor-minus-mount-nw", right: "mount-hole-sw" },
  { kind: "subtraction", id: "motor-with-four-mount-holes", left: "motor-minus-mount-sw", right: "mount-hole-se" },
] };

export const FASTENER_GRAPH: ParametricGraph = { nodes: [
  cylinder("m3-thread-envelope", [0, 0, 0.004], 0.0015, 0.008),
  cylinder("socket-head", [0, 0, -0.0015], 0.00284, 0.003),
  { kind: "union", id: "m3x8-solid", left: "m3-thread-envelope", right: "socket-head" },
  box("socket-recess", [0, 0, -0.00235], [0.0025, 0.0025, 0.0013]),
  { kind: "subtraction", id: "m3x8-with-drive", left: "m3x8-solid", right: "socket-recess" },
] };

export const OPEN_FC_GRAPH: ParametricGraph = { nodes: [
  box("openfc-lite-rev3.3-envelope", [0, 0, 0], [0.037942302, 0.037942302, 0.00538]),
] };

export const OPEN_ESC_GRAPH: ParametricGraph = { nodes: [
  box("openesc-30x30-rev3.3-envelope", [0, 0, 0], [0.04162706, 0.042504999, 0.00633]),
] };

export const BATTERY_GRAPH: ParametricGraph = { nodes: [
  box("battery-package", [0, 0, 0], [0.078, 0.037, 0.052]),
] };

export const BATTERY_STRAP_GRAPH: ParametricGraph = { nodes: [
  box("strap-top", [0, 0, 0.0305], [0.020, 0.043, 0.0015]),
  box("strap-bottom", [0, 0, -0.02675], [0.020, 0.043, 0.0015]),
  box("strap-left", [0, -0.0215, 0.001875], [0.020, 0.0015, 0.05725]),
  box("strap-right", [0, 0.0215, 0.001875], [0.020, 0.0015, 0.05725]),
  { kind: "union", id: "strap-halves", left: "strap-top", right: "strap-bottom" },
  { kind: "union", id: "strap-three-sides", left: "strap-halves", right: "strap-left" },
  { kind: "union", id: "battery-strap-loop", left: "strap-three-sides", right: "strap-right" },
] };

export const BATTERY_HARNESS_GRAPH: ParametricGraph = { nodes: [
  box("battery-harness-horizontal", [0.0079, -0.005, -0.014], [0.040, 0.009, 0.007]),
  box("battery-harness-riser", [-0.012, -0.005, -0.0036], [0.008, 0.009, 0.0208]),
  box("battery-harness-esc-tail", [-0.020, -0.005, 0.0088], [0.018, 0.009, 0.004]),
  { kind: "union", id: "battery-harness-lower-route", left: "battery-harness-horizontal", right: "battery-harness-riser" },
  { kind: "union", id: "battery-harness-route", left: "battery-harness-lower-route", right: "battery-harness-esc-tail" },
] };

export const CAMERA_GRAPH: ParametricGraph = { nodes: [
  box("camera-housing", [0, 0, 0], [0.019, 0.020, 0.019]),
  cylinder("m12-lens-envelope", [0.015, 0, 0], 0.006, 0.012),
  { kind: "union", id: "camera-and-lens", left: "camera-housing", right: "m12-lens-envelope" },
] };

export const WIRING_GRAPH: ParametricGraph = { nodes: [
  box("wiring-corridor", [0, 0, -0.00258], [0.072, 0.006, 0.0028]),
] };

export const PROPELLER_GRAPH: ParametricGraph = { nodes: [
  cylinder("propeller-hub", [0, 0, 0], 0.0064, 0.0065),
  box("propeller-blade-1", [0.03495, 0, 0], [0.0571, 0.012, 0.0015]),
  { kind: "transform", id: "propeller-blade-2", source: "propeller-blade-1", transform: { position: point(0, 0, 0), orientation: orientation(2 * Math.PI / 3) } },
  { kind: "transform", id: "propeller-blade-3", source: "propeller-blade-1", transform: { position: point(0, 0, 0), orientation: orientation(4 * Math.PI / 3) } },
  { kind: "union", id: "hub-and-blade-1", left: "propeller-hub", right: "propeller-blade-1" },
  { kind: "union", id: "hub-and-two-blades", left: "hub-and-blade-1", right: "propeller-blade-2" },
  { kind: "union", id: "propeller-display", left: "hub-and-two-blades", right: "propeller-blade-3" },
] };

export const BODY_INTERFACE_GRAPH: ParametricGraph = { nodes: [
  box("body-interface-plate", [0, 0, 0.003], [0.028, 0.038, 0.006]),
] };
