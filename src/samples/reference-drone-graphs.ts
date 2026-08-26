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

export const STACK_GRAPH: ParametricGraph = { nodes: [
  box("flight-controller-board", [0, 0, 0.006], [0.0416, 0.0394, 0.0078]),
  box("esc-board", [0, 0, -0.0059], [0.0456, 0.044, 0.008]),
  { kind: "union", id: "fc-esc-stack-display", left: "flight-controller-board", right: "esc-board" },
] };

export const BATTERY_GRAPH: ParametricGraph = { nodes: [
  box("battery-package", [0, 0, 0], [0.078, 0.037, 0.052]),
] };

export const WIRING_GRAPH: ParametricGraph = { nodes: [
  box("wiring-corridor", [0, 0, 0], [0.184, 0.006, 0.006]),
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
