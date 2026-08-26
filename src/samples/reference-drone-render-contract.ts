import type { ParametricGraph } from "../domain/component-model";
import type { ReferenceDroneComponent, SiVector } from "./reference-drone-catalog";

type GraphNode = ParametricGraph["nodes"][number];
type CylinderNode = Extract<GraphNode, { kind: "cylinder" }>;
type BoxNode = Extract<GraphNode, { kind: "box" }>;

export interface AxialFeature {
  readonly radius: number;
  readonly height: number;
  readonly centerZ: number;
}

export interface RenderBounds {
  readonly minimum: SiVector;
  readonly maximum: SiVector;
}

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
  readonly localBounds: RenderBounds;
}

const metres = (length: { readonly value: number; readonly unit: "m" | "mm" }) =>
  length.unit === "m" ? length.value : length.value / 1_000;

function graphFor(component: ReferenceDroneComponent, display: "motor" | "fastener"): ParametricGraph {
  if (component.geometry.kind !== "parametric" || component.geometry.display.kind !== display) {
    throw new Error(`Reference ${component.id} does not provide ${display} parametric geometry`);
  }
  return component.geometry.graph;
}

function cylinderById(graph: ParametricGraph, id: string): CylinderNode {
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (node?.kind !== "cylinder") throw new Error(`Parametric cylinder missing: ${id}`);
  return node;
}

function boxById(graph: ParametricGraph, id: string): BoxNode {
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (node?.kind !== "box") throw new Error(`Parametric box missing: ${id}`);
  return node;
}

function axial(node: CylinderNode): AxialFeature {
  return { radius: metres(node.radius), height: metres(node.height), centerZ: metres(node.center.z) };
}

export function motorRenderContract(component: ReferenceDroneComponent): MotorRenderContract {
  const graph = graphFor(component, "motor");
  const base = axial(cylinderById(graph, "motor-base"));
  const stator = axial(cylinderById(graph, "motor-stator"));
  const bell = axial(cylinderById(graph, "motor-bell"));
  const shaft = axial(cylinderById(graph, "motor-shaft"));
  const mountHoles = ["mount-hole-ne", "mount-hole-nw", "mount-hole-sw", "mount-hole-se"].map((id) => {
    const node = cylinderById(graph, id);
    return { ...axial(node), centerX: metres(node.center.x), centerY: metres(node.center.y) };
  });
  const radius = bell.radius;
  const minimumZ = Math.min(base.centerZ - base.height / 2, bell.centerZ - bell.height / 2);
  const maximumZ = shaft.centerZ + shaft.height / 2;
  return { base, stator, bell, shaft, mountHoles, localBounds: { minimum: [-radius, -radius, minimumZ], maximum: [radius, radius, maximumZ] } };
}

export function fastenerRenderContract(component: ReferenceDroneComponent): FastenerRenderContract {
  const graph = graphFor(component, "fastener");
  const shank = axial(cylinderById(graph, "m3-thread-envelope"));
  const graphHead = axial(cylinderById(graph, "socket-head"));
  const minimumZ = graphHead.centerZ - graphHead.height / 2;
  const head = { ...graphHead, height: -minimumZ, centerZ: minimumZ / 2 };
  const socket = boxById(graph, "socket-recess");
  return {
    shank,
    head,
    socketWidth: metres(socket.size.x),
    socketDepth: metres(socket.size.z),
    localBounds: {
      minimum: [-head.radius, -head.radius, minimumZ],
      maximum: [head.radius, head.radius, shank.centerZ + shank.height / 2],
    },
  };
}

const centeredBounds = (size: SiVector): RenderBounds => ({
  minimum: size.map((value) => -value / 2) as unknown as SiVector,
  maximum: size.map((value) => value / 2) as unknown as SiVector,
});

export function componentGeometryEnvelope(component: ReferenceDroneComponent): RenderBounds {
  const { geometry } = component;
  if (geometry.kind === "parametric") {
    return geometry.display.kind === "motor"
      ? motorRenderContract(component).localBounds
      : fastenerRenderContract(component).localBounds;
  }
  if (geometry.kind === "stack") {
    const width = Math.max(...geometry.boards.map(({ size }) => size[0]));
    const depth = Math.max(...geometry.boards.map(({ size }) => size[1]));
    const height = geometry.boards.reduce((sum, board) => sum + board.size[2], geometry.boardGap);
    return centeredBounds([width, depth, height]);
  }
  if (geometry.kind === "swept-rotor") {
    return centeredBounds([geometry.radius * 2, geometry.radius * 2, geometry.hubHeight]);
  }
  return centeredBounds(geometry.size);
}
