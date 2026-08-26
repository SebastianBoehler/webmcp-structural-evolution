import * as THREE from "three";

import { ParametricGraphSchema, type ParametricGraph } from "../domain/component-model";
import type { CadMesh } from "./step-import";

const MAX_OPERATIONS = 256;
const CYLINDER_SEGMENTS = 48;
type GraphNode = ParametricGraph["nodes"][number];
type CsgModule = typeof import("three-bvh-csg");
type CsgRuntime = Pick<CsgModule, "Evaluator" | "Brush" | "ADDITION" | "SUBTRACTION" | "INTERSECTION">;
type CsgBrush = InstanceType<CsgRuntime["Brush"]>;

type Length = Readonly<{ value: number; unit: "m" | "mm" }>;
type Vector = Readonly<{ x: Length; y: Length; z: Length }>;
type Angle = Readonly<{ value: number; unit: "deg" | "rad" }>;
type Orientation = Readonly<{ roll: Angle; pitch: Angle; yaw: Angle }>;

const metres = (length: Length) => length.unit === "mm" ? length.value / 1_000 : length.value;
const radians = (angle: Angle) => angle.unit === "deg" ? angle.value * Math.PI / 180 : angle.value;
const vector = (value: Vector) => new THREE.Vector3(metres(value.x), metres(value.y), metres(value.z));

function rotation(value: Orientation): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(radians(value.roll), radians(value.pitch), radians(value.yaw)));
}

function references(node: GraphNode): readonly string[] {
  switch (node.kind) {
    case "transform":
    case "extrude":
    case "revolve":
    case "fillet":
    case "named-interface": return [node.kind === "transform" || node.kind === "fillet" || node.kind === "named-interface" ? node.source : node.profile];
    case "union":
    case "intersection":
    case "subtraction": return [node.left, node.right];
    default: return [];
  }
}

function validateGraph(graph: ParametricGraph): string {
  const nodes = new Map<string, GraphNode>();
  for (const node of graph.nodes) {
    if (nodes.has(node.id)) throw new RangeError(`Parametric graph has duplicate node ID: ${node.id}`);
    nodes.set(node.id, node);
  }
  for (const node of graph.nodes) {
    for (const reference of references(node)) {
      if (!nodes.has(reference)) throw new RangeError(`Parametric graph node ${node.id} references missing node ${reference}`);
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new RangeError(`Parametric graph contains a cycle at node ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    references(nodes.get(id)!).forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  nodes.forEach((_, id) => visit(id));

  const geometryConsumers = new Set<string>();
  for (const node of graph.nodes) {
    references(node).forEach((id) => geometryConsumers.add(id));
  }
  const roots = graph.nodes.filter((node) => node.kind !== "named-interface" && !geometryConsumers.has(node.id));
  if (roots.length !== 1) throw new RangeError("Parametric graph must have exactly one solid root");
  return roots[0]!.id;
}

function unsupportedNode(node: GraphNode): void {
  if (node.kind === "extrude" || node.kind === "revolve") {
    throw new Error(`Parametric ${node.kind} node ${node.id} requires a planar profile, which this graph schema cannot express`);
  }
  if (node.kind === "fillet") {
    throw new Error(`Parametric fillet node ${node.id} is not supported by the bounded browser CSG evaluator`);
  }
}

function brushFromGeometry(Brush: CsgRuntime["Brush"], geometry: THREE.BufferGeometry): CsgBrush {
  geometry.computeVertexNormals();
  return new Brush(geometry);
}

function cloneBrush(Brush: CsgRuntime["Brush"], source: CsgBrush): CsgBrush {
  return brushFromGeometry(Brush, source.geometry.clone());
}

function primitive(node: Extract<GraphNode, { kind: "box" | "cylinder" }>, Brush: CsgRuntime["Brush"]): CsgBrush {
  if (node.kind === "box") {
    const size = vector(node.size);
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    geometry.translate(...vector(node.center).toArray());
    return brushFromGeometry(Brush, geometry);
  }
  const geometry = new THREE.CylinderGeometry(metres(node.radius), metres(node.radius), metres(node.height), CYLINDER_SEGMENTS);
  geometry.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  geometry.applyMatrix4(rotation(node.orientation));
  geometry.translate(...vector(node.center).toArray());
  return brushFromGeometry(Brush, geometry);
}

function transform(source: CsgBrush, value: Extract<GraphNode, { kind: "transform" }>["transform"], Brush: CsgRuntime["Brush"]): CsgBrush {
  const matrix = rotation(value.orientation);
  matrix.setPosition(vector(value.position));
  const geometry = source.geometry.clone();
  geometry.applyMatrix4(matrix);
  return brushFromGeometry(Brush, geometry);
}

function evaluateGraph(graph: ParametricGraph, root: string, runtime: CsgRuntime): CsgBrush {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const results = new Map<string, CsgBrush>();
  const evaluator = new runtime.Evaluator();
  evaluator.useGroups = false;
  const evaluate = (id: string): CsgBrush => {
    const cached = results.get(id);
    if (cached) return cached;
    const node = nodes.get(id)!;
    unsupportedNode(node);
    let result: CsgBrush;
    if (node.kind === "box" || node.kind === "cylinder") result = primitive(node, runtime.Brush);
    else if (node.kind === "transform") result = transform(evaluate(node.source), node.transform, runtime.Brush);
    else if (node.kind === "named-interface") result = cloneBrush(runtime.Brush, evaluate(node.source));
    else if (node.kind === "union" || node.kind === "intersection" || node.kind === "subtraction") {
      const operation = node.kind === "union" ? runtime.ADDITION
        : node.kind === "intersection" ? runtime.INTERSECTION : runtime.SUBTRACTION;
      result = evaluator.evaluate(evaluate(node.left), evaluate(node.right), operation);
    } else {
      throw new Error(`Parametric node ${node.id} cannot produce a solid`);
    }
    results.set(id, result);
    return result;
  };
  return evaluate(root);
}

function roundedMillimetres(value: number): number {
  // Three stores positions as f32; round only the derived envelope to remove
  // sub-micron representation noise from otherwise exact declared dimensions.
  return Math.round(value * 100_000) / 100_000;
}

function cadMeshFromBufferGeometry(geometry: THREE.BufferGeometry): CadMesh {
  const position = geometry.getAttribute("position");
  if (!position || position.itemSize !== 3 || position.count === 0) throw new Error("Parametric graph produced no geometry");
  const normal = geometry.getAttribute("normal");
  const positions = new Float32Array(position.count * 3);
  const normals = new Float32Array(position.count * 3);
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < position.count; index += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = position.getComponent(index, axis) * 1_000;
      positions[index * 3 + axis] = value;
      minimum[axis] = Math.min(minimum[axis]!, value);
      maximum[axis] = Math.max(maximum[axis]!, value);
      normals[index * 3 + axis] = normal?.getComponent(index, axis) ?? 0;
    }
  }
  const sourceIndex = geometry.getIndex();
  const indices = new Uint32Array(sourceIndex?.count ?? position.count);
  for (let index = 0; index < indices.length; index += 1) indices[index] = sourceIndex?.getX(index) ?? index;
  if (indices.length === 0 || indices.length % 3 !== 0) throw new Error("Parametric graph produced invalid triangle topology");
  return {
    surfaces: [{ name: "Parametric geometry", positions, normals, indices }],
    sizeMm: maximum.map((value, axis) => roundedMillimetres(value - minimum[axis]!)) as [number, number, number],
    triangleCount: indices.length / 3,
  };
}

export async function compileParametricGeometry(graph: ParametricGraph): Promise<CadMesh> {
  const parsed = ParametricGraphSchema.parse(graph) as ParametricGraph;
  if (parsed.nodes.length > MAX_OPERATIONS) throw new RangeError(`Parametric graph exceeds ${MAX_OPERATIONS} operations`);
  const root = validateGraph(parsed);
  parsed.nodes.forEach(unsupportedNode);
  const runtime = await import("three-bvh-csg") as CsgRuntime;
  return cadMeshFromBufferGeometry(evaluateGraph(parsed, root, runtime).geometry);
}
