import type { ComponentDefinition, ParametricGraph } from "../domain/component-model";
import * as THREE from "three";

export type SiVector = readonly [number, number, number];
type GraphNode = ParametricGraph["nodes"][number];
type CylinderNode = Extract<GraphNode, { kind: "cylinder" }>;
type BoxNode = Extract<GraphNode, { kind: "box" }>;

export interface AxialFeature { readonly radius: number; readonly height: number; readonly centerZ: number }
export interface BoxFeature { readonly center: SiVector; readonly size: SiVector }
export interface RenderBounds { readonly minimum: SiVector; readonly maximum: SiVector }
export interface MotorRenderContract {
  readonly base: AxialFeature;
  readonly stator: AxialFeature;
  readonly bell: AxialFeature;
  readonly shaft: AxialFeature;
  readonly mountHoles: readonly Readonly<AxialFeature & { centerX: number; centerY: number }>[];
  readonly localBounds: RenderBounds;
}
export interface FastenerRenderContract {
  readonly shank: AxialFeature;
  readonly head: AxialFeature;
  readonly socketWidth: number;
  readonly socketDepth: number;
  readonly socketCenterZ: number;
  readonly localBounds: RenderBounds;
}
export interface PropellerRenderContract {
  readonly radius: number;
  readonly hubRadius: number;
  readonly hubHeight: number;
  readonly bladeCount: number;
}

const metres = (length: { readonly value: number; readonly unit: "m" | "mm" }) =>
  length.unit === "m" ? length.value : length.value / 1_000;
const vector = (value: { readonly x: { readonly value: number; readonly unit: "m" | "mm" }; readonly y: { readonly value: number; readonly unit: "m" | "mm" }; readonly z: { readonly value: number; readonly unit: "m" | "mm" } }): SiVector => [
  metres(value.x), metres(value.y), metres(value.z),
];

function graphFor(component: ComponentDefinition): ParametricGraph {
  if (component.geometry.kind !== "parametric") {
    throw new Error(`Reference ${component.id} does not provide parametric display geometry`);
  }
  return component.geometry.graph;
}

function cylinderById(component: ComponentDefinition, id: string): CylinderNode {
  const node = graphFor(component).nodes.find((candidate) => candidate.id === id);
  if (node?.kind !== "cylinder") throw new Error(`Parametric cylinder missing: ${id}`);
  return node;
}

function boxById(component: ComponentDefinition, id: string): BoxNode {
  const node = graphFor(component).nodes.find((candidate) => candidate.id === id);
  if (node?.kind !== "box") throw new Error(`Parametric box missing: ${id}`);
  return node;
}

function axial(node: CylinderNode): AxialFeature {
  return { radius: metres(node.radius), height: metres(node.height), centerZ: metres(node.center.z) };
}

export function boxRenderContract(component: ComponentDefinition, id: string): BoxFeature {
  const node = boxById(component, id);
  return { center: vector(node.center), size: vector(node.size) };
}

export function motorRenderContract(component: ComponentDefinition): MotorRenderContract {
  const base = axial(cylinderById(component, "motor-base"));
  const stator = axial(cylinderById(component, "motor-stator"));
  const bell = axial(cylinderById(component, "motor-bell"));
  const shaft = axial(cylinderById(component, "motor-shaft"));
  const mountHoles = ["mount-hole-ne", "mount-hole-nw", "mount-hole-sw", "mount-hole-se"].map((id) => {
    const node = cylinderById(component, id);
    return { ...axial(node), centerX: metres(node.center.x), centerY: metres(node.center.y) };
  });
  return { base, stator, bell, shaft, mountHoles, localBounds: componentGeometryEnvelope(component) };
}

export function fastenerRenderContract(component: ComponentDefinition): FastenerRenderContract {
  const shank = axial(cylinderById(component, "m3-thread-envelope"));
  const head = axial(cylinderById(component, "socket-head"));
  const socket = boxById(component, "socket-recess");
  return {
    shank,
    head,
    socketWidth: metres(socket.size.x),
    socketDepth: metres(socket.size.z),
    socketCenterZ: metres(socket.center.z),
    localBounds: componentGeometryEnvelope(component),
  };
}

export function propellerRenderContract(component: ComponentDefinition): PropellerRenderContract {
  const hub = axial(cylinderById(component, "propeller-hub"));
  const collision = component.collisionVolumes[0];
  if (collision?.kind !== "cylinder") throw new Error("Reference propeller requires cylindrical collision geometry");
  const bladeCount = graphFor(component).nodes.filter(({ id }) => id.startsWith("propeller-blade-")).length;
  return { radius: collision.radius.value, hubRadius: hub.radius, hubHeight: hub.height, bladeCount };
}

export function componentGeometryEnvelope(component: ComponentDefinition): RenderBounds {
  const envelope = component.envelope;
  const center = vector(envelope.center);
  const radians = (angle: { readonly value: number; readonly unit: "rad" | "deg" }) =>
    angle.unit === "rad" ? angle.value : angle.value * Math.PI / 180;
  const rotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
    radians(envelope.orientation.roll), radians(envelope.orientation.pitch), radians(envelope.orientation.yaw),
  ));
  const elements = rotation.elements;
  const half = envelope.kind === "box" ? (() => {
    const [x, y, z] = vector(envelope.size).map((size) => size / 2) as unknown as SiVector;
    return [
      Math.abs(elements[0]!) * x + Math.abs(elements[4]!) * y + Math.abs(elements[8]!) * z,
      Math.abs(elements[1]!) * x + Math.abs(elements[5]!) * y + Math.abs(elements[9]!) * z,
      Math.abs(elements[2]!) * x + Math.abs(elements[6]!) * y + Math.abs(elements[10]!) * z,
    ];
  })() : (() => {
    const radius = metres(envelope.radius);
    const halfHeight = metres(envelope.height) / 2;
    const axis = new THREE.Vector3(0, 0, 1).applyMatrix4(rotation);
    return [axis.x, axis.y, axis.z].map((component) =>
      radius * Math.sqrt(Math.max(0, 1 - component ** 2)) + halfHeight * Math.abs(component));
  })();
  const exact = (value: number) => Math.round(value * 1e12) / 1e12;
  return {
    minimum: center.map((coordinate, axis) => exact(coordinate - half[axis]!)) as unknown as SiVector,
    maximum: center.map((coordinate, axis) => exact(coordinate + half[axis]!)) as unknown as SiVector,
  };
}
