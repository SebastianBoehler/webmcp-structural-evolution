import type { OcctKernel, ShapeHandle, Vec3 } from "occt-wasm";

import type { DesignDocument } from "../document-schema";

type DocumentSketch = DesignDocument["sketches"][number];

type ScalarExpression = number | { readonly parameterId: string };
export type ScalarResolver = (
  expression: ScalarExpression,
  kind: "length" | "angle",
  label: string,
) => number;

type Matrix3 = readonly [number, number, number, number, number, number, number, number, number];

export interface SketchFrame {
  readonly origin: Vec3;
  readonly rotation: Matrix3;
}

export interface BuiltSketch {
  readonly faces: readonly ShapeHandle[];
  readonly frame: SketchFrame;
}

export const WIRE_CLOSURE_TOLERANCE_M = 1e-9;

const multiplyVector = (matrix: Matrix3, vector: Vec3): Vec3 => ({
  x: matrix[0] * vector.x + matrix[1] * vector.y + matrix[2] * vector.z,
  y: matrix[3] * vector.x + matrix[4] * vector.y + matrix[5] * vector.z,
  z: matrix[6] * vector.x + matrix[7] * vector.y + matrix[8] * vector.z,
});

const multiplyMatrix = (left: Matrix3, right: Matrix3): Matrix3 => {
  const result = new Array<number>(9);
  for (let row = 0; row < 3; row += 1) for (let column = 0; column < 3; column += 1) {
    result[row * 3 + column] = [0, 1, 2].reduce(
      (sum, index) => sum + left[row * 3 + index]! * right[index * 3 + column]!,
      0,
    );
  }
  return result as unknown as Matrix3;
};

function rotationMatrix(roll: number, pitch: number, yaw: number): Matrix3 {
  const [cr, sr, cp, sp, cy, sy] = [
    Math.cos(roll), Math.sin(roll), Math.cos(pitch), Math.sin(pitch), Math.cos(yaw), Math.sin(yaw),
  ];
  return [
    cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr,
    sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr,
    -sp, cp * sr, cp * cr,
  ];
}

function add(left: Vec3, right: Vec3): Vec3 {
  return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}

function frameFor(document: DesignDocument, frameId: string, cache: Map<string, SketchFrame>): SketchFrame {
  const cached = cache.get(frameId);
  if (cached) return cached;
  const frame = document.frames.find(({ id }) => id === frameId);
  if (!frame) throw new Error(`Sketch frame is missing: ${frameId}`);
  const localRotation = rotationMatrix(
    frame.transform.orientation.roll.value,
    frame.transform.orientation.pitch.value,
    frame.transform.orientation.yaw.value,
  );
  const localOrigin = {
    x: frame.transform.position.x.value,
    y: frame.transform.position.y.value,
    z: frame.transform.position.z.value,
  };
  const resolved = frame.parentId === undefined
    ? { origin: localOrigin, rotation: localRotation }
    : (() => {
      const parent = frameFor(document, frame.parentId!, cache);
      return {
        origin: add(parent.origin, multiplyVector(parent.rotation, localOrigin)),
        rotation: multiplyMatrix(parent.rotation, localRotation),
      };
    })();
  cache.set(frameId, resolved);
  return resolved;
}

export function pointOnSketch(frame: SketchFrame, x: number, y: number): Vec3 {
  return add(frame.origin, multiplyVector(frame.rotation, { x, y, z: 0 }));
}

export function directionOnSketch(frame: SketchFrame, x: number, y: number, z = 0): Vec3 {
  return multiplyVector(frame.rotation, { x, y, z });
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
