import type { OcctKernel, ShapeHandle, Vec3 } from "occt-wasm";

import type { DesignDocument } from "../document-schema";
import {
  applyDirection, applyPoint, resolveDocumentFrame, type Matrix3,
} from "../rigid-transform";

type DocumentSketch = DesignDocument["sketches"][number];

type ScalarExpression = number | { readonly parameterId: string };
export type ScalarResolver = (
  expression: ScalarExpression,
  kind: "length" | "angle",
  label: string,
) => number;

export interface SketchFrame {
  readonly origin: Vec3;
  readonly rotation: Matrix3;
}

export interface BuiltSketch {
  readonly faces: readonly ShapeHandle[];
  readonly frame: SketchFrame;
}

export const WIRE_CLOSURE_TOLERANCE_M = 1e-9;

function frameFor(document: DesignDocument, frameId: string, cache: Map<string, SketchFrame>): SketchFrame {
  const cached = cache.get(frameId);
  if (cached) return cached;
  const transform = resolveDocumentFrame(document, frameId);
  const resolved = {
    origin: { x: transform.positionM[0], y: transform.positionM[1], z: transform.positionM[2] },
    rotation: transform.rotation,
  };
  cache.set(frameId, resolved);
  return resolved;
}

export function pointOnSketch(frame: SketchFrame, x: number, y: number): Vec3 {
  const point = applyPoint({
    positionM: [frame.origin.x, frame.origin.y, frame.origin.z], rotation: frame.rotation,
  }, [x, y, 0]);
  return { x: point[0], y: point[1], z: point[2] };
}

export function directionOnSketch(frame: SketchFrame, x: number, y: number, z = 0): Vec3 {
  const direction = applyDirection({ rotation: frame.rotation }, [x, y, z]);
  return { x: direction[0], y: direction[1], z: direction[2] };
}

const normalFor = (frame: SketchFrame) => directionOnSketch(frame, 0, 0, 1);

export function preflightSketchExpressions(sketch: DocumentSketch, resolve: ScalarResolver): void {
  const length = (expression: ScalarExpression, label: string, positive = false) => {
    const value = resolve(expression, "length", label);
    if (positive && value <= 0) throw new Error(`Sketch length must be positive: ${label}`);
  };
  for (const entity of sketch.entities) {
    if (entity.kind === "line") {
      entity.startM.forEach((value, index) => length(value, `${entity.id}.startM[${index}]`));
      entity.endM.forEach((value, index) => length(value, `${entity.id}.endM[${index}]`));
    } else {
      entity.centerM.forEach((value, index) => length(value, `${entity.id}.centerM[${index}]`));
      if (entity.kind === "rectangle") {
        entity.sizeM.forEach((value, index) => length(value, `${entity.id}.sizeM[${index}]`, true));
      } else {
        length(entity.radiusM, `${entity.id}.radiusM`, true);
        if (entity.kind === "arc") {
          resolve(entity.startAngleRad, "angle", `${entity.id}.startAngleRad`);
          resolve(entity.endAngleRad, "angle", `${entity.id}.endAngleRad`);
        }
      }
    }
  }
  for (const constraint of sketch.constraints) {
    if (constraint.kind === "distance" || constraint.kind === "radius") {
      const value = resolve(
        constraint.valueM,
        "length",
        `${constraint.id}.valueM`,
      );
      if (value <= 0) throw new Error(`Constraint length must be positive: ${constraint.id}`);
    } else if (constraint.kind === "angle") {
      resolve(constraint.valueRad, "angle", `${constraint.id}.valueRad`);
    }
  }
}

function closedCompositeEdges(
  kernel: OcctKernel,
  sketch: DocumentSketch,
  frame: SketchFrame,
  resolve: ScalarResolver,
): ShapeHandle[] {
  const edges: ShapeHandle[] = [];
  const endpointCounts = new Map<string, number>();
  const track = (value: Vec3) => {
    const key = [value.x, value.y, value.z]
      .map((coordinate) => Math.round(coordinate / WIRE_CLOSURE_TOLERANCE_M)).join(",");
    endpointCounts.set(key, (endpointCounts.get(key) ?? 0) + 1);
  };
  for (const entity of sketch.entities) {
    if (entity.kind !== "line" && entity.kind !== "arc") continue;
    let start: Vec3;
    let end: Vec3;
    if (entity.kind === "line") {
      start = pointOnSketch(frame,
        resolve(entity.startM[0], "length", `${entity.id}.startM[0]`),
        resolve(entity.startM[1], "length", `${entity.id}.startM[1]`));
      end = pointOnSketch(frame,
        resolve(entity.endM[0], "length", `${entity.id}.endM[0]`),
        resolve(entity.endM[1], "length", `${entity.id}.endM[1]`));
      edges.push(kernel.makeLineEdge(start, end));
    } else {
      const cx = resolve(entity.centerM[0], "length", `${entity.id}.centerM[0]`);
      const cy = resolve(entity.centerM[1], "length", `${entity.id}.centerM[1]`);
      const radius = resolve(entity.radiusM, "length", `${entity.id}.radiusM`);
      if (radius <= 0) throw new Error(`Arc radius must be positive: ${entity.id}`);
      const startAngle = resolve(entity.startAngleRad, "angle", `${entity.id}.startAngleRad`);
      const endAngle = resolve(entity.endAngleRad, "angle", `${entity.id}.endAngleRad`);
      const at = (angle: number) => pointOnSketch(
        frame, cx + radius * Math.cos(angle), cy + radius * Math.sin(angle),
      );
      start = at(startAngle);
      end = at(endAngle);
      edges.push(kernel.makeArcEdge(start, at((startAngle + endAngle) / 2), end));
    }
    track(start);
    track(end);
  }
  if (edges.length > 0 && [...endpointCounts.values()].some((count) => count !== 2)) {
    throw new Error(`Sketch profile is open after parameter resolution: ${sketch.id}`);
  }
  return edges;
}

export function buildSketch(
  kernel: OcctKernel,
  document: DesignDocument,
  sketch: DocumentSketch,
  resolve: ScalarResolver,
): BuiltSketch {
  preflightSketchExpressions(sketch, resolve);
  const frame = frameFor(document, sketch.plane.slice("frame:".length), new Map());
  const normal = normalFor(frame);
  const faces: ShapeHandle[] = [];
  const compositeEdges = closedCompositeEdges(kernel, sketch, frame, resolve);
  if (compositeEdges.length > 0) faces.push(kernel.makeFace(kernel.makeWire(compositeEdges)));
  for (const entity of sketch.entities) {
    if (entity.kind === "rectangle") {
      const cx = resolve(entity.centerM[0], "length", `${entity.id}.centerM[0]`);
      const cy = resolve(entity.centerM[1], "length", `${entity.id}.centerM[1]`);
      const width = resolve(entity.sizeM[0], "length", `${entity.id}.sizeM[0]`);
      const height = resolve(entity.sizeM[1], "length", `${entity.id}.sizeM[1]`);
      if (width <= 0 || height <= 0) throw new Error(`Rectangle dimensions must be positive: ${entity.id}`);
      const corners = [
        pointOnSketch(frame, cx - width / 2, cy - height / 2),
        pointOnSketch(frame, cx + width / 2, cy - height / 2),
        pointOnSketch(frame, cx + width / 2, cy + height / 2),
        pointOnSketch(frame, cx - width / 2, cy + height / 2),
      ];
      const edges = corners.map((start, index) =>
        kernel.makeLineEdge(start, corners[(index + 1) % corners.length]!));
      faces.push(kernel.makeFace(kernel.makeWire(edges)));
    } else if (entity.kind === "circle") {
      const center = pointOnSketch(
        frame,
        resolve(entity.centerM[0], "length", `${entity.id}.centerM[0]`),
        resolve(entity.centerM[1], "length", `${entity.id}.centerM[1]`),
      );
      const radius = resolve(entity.radiusM, "length", `${entity.id}.radiusM`);
      if (radius <= 0) throw new Error(`Circle radius must be positive: ${entity.id}`);
      faces.push(kernel.makeFace(kernel.makeWire([kernel.makeCircleEdge(center, normal, radius)])));
    }
  }
  if (faces.length === 0) throw new Error(`Sketch contains no closed profile: ${sketch.id}`);
  return { faces, frame };
}
