import type { OcctKernel, ShapeHandle } from "occt-wasm";

import type { DesignDocument } from "../document-schema";
import type { CadOutput } from "../runtime-contracts";
import type {
  MassPropertiesPayload,
  OpaqueBytesPayload,
  SectionCurvesPayload,
  SemanticMeshPayload,
} from "../rebuild-payload";
import type { OcctBridge } from "./occt-bridge";
import {
  directionOnSketch,
  pointOnSketch,
  buildSketch,
  preflightSketchExpressions,
} from "./sketch-geometry";
import {
  tessellateSemanticBodies,
  type RebuiltBodyShape,
  type RebuiltFeatureShape,
} from "./semantic-tessellation";
import { exportStepBytes } from "./step-exchange";

type DocumentFeature = DesignDocument["features"][number];

export type CadRebuildFailureCode =
  | "feature-failed"
  | "invalid-solid"
  | "reference-requires-repair";

export class CadRebuildError extends Error {
  constructor(readonly code: CadRebuildFailureCode, message: string) {
    super(message);
    this.name = "CadRebuildError";
  }
}

export interface CadRebuildPayload {
  readonly featureIds: readonly string[];
  readonly bodyIds: readonly string[];
  readonly brep?: OpaqueBytesPayload;
  readonly semanticMesh?: SemanticMeshPayload;
  readonly massProperties?: MassPropertiesPayload;
  readonly sectionCurves?: SectionCurvesPayload;
  readonly step?: OpaqueBytesPayload;
}

type ScalarExpression = number | { readonly parameterId: string };

function resolveScalar(
  document: DesignDocument,
  expression: ScalarExpression,
  kind: "length" | "angle",
  label: string,
): number {
  if (typeof expression === "number") return expression;
  const parameter = document.parameters.find(({ id }) => id === expression.parameterId);
  if (!parameter) {
    throw new CadRebuildError("feature-failed", `${label} references missing parameter: ${expression.parameterId}`);
  }
  if (parameter.value.kind !== kind) {
    throw new CadRebuildError("feature-failed", `${label} requires a ${kind} parameter: ${expression.parameterId}`);
  }
  return parameter.value.value.value;
}

function ensureValidSolid(kernel: OcctKernel, shape: ShapeHandle, feature: DocumentFeature): void {
  const hasSolid = kernel.isSolid(shape) || kernel.subShapeCount(shape, "solid") > 0;
  if (!hasSolid || !kernel.isValid(shape)) {
    throw new CadRebuildError("invalid-solid", `Feature produced an invalid solid: ${feature.id}`);
  }
}

function combineSolids(kernel: OcctKernel, shapes: readonly ShapeHandle[], feature: DocumentFeature): ShapeHandle {
  if (shapes.length === 0) throw new CadRebuildError("invalid-solid", `Feature produced no solids: ${feature.id}`);
  const result = shapes.length === 1 ? shapes[0]! : kernel.fuseAll([...shapes]);
  ensureValidSolid(kernel, result, feature);
  return result;
}

function booleanShape(
  kernel: OcctKernel,
  feature: Extract<DocumentFeature, { kind: "union" | "cut" | "intersect" }>,
  left: ShapeHandle,
  right: ShapeHandle,
): ShapeHandle {
  const result = feature.kind === "union"
    ? kernel.fuse(left, right)
    : feature.kind === "cut"
      ? kernel.cut(left, right)
      : kernel.common(left, right);
  ensureValidSolid(kernel, result, feature);
  return result;
}

function featureLineage(document: DesignDocument, terminalFeatureId: string): string[] {
  const features = new Map(document.features.map((feature) => [feature.id, feature]));
  const lineage = new Set<string>();
  const visit = (featureId: string) => {
    if (lineage.has(featureId)) return;
    lineage.add(featureId);
    const feature = features.get(featureId);
    if (feature && feature.kind !== "extrude" && feature.kind !== "revolve") {
      visit(feature.leftFeatureId);
      visit(feature.rightFeatureId);
    }
  };
  visit(terminalFeatureId);
  return document.features.filter(({ id }) => lineage.has(id)).map(({ id }) => id);
}

function inertiaTuple(kernel: OcctKernel, shape: ShapeHandle): MassPropertiesPayload["inertiaKgM2"] {
  const inertia = kernel.getInertia(shape);
  if (inertia.length !== 9) throw new CadRebuildError("invalid-solid", "OCCT returned an invalid inertia tensor");
  return inertia as MassPropertiesPayload["inertiaKgM2"];
}

function massProperties(kernel: OcctKernel, shape: ShapeHandle): MassPropertiesPayload {
  const center = kernel.getCenterOfMass(shape);
  const volumeM3 = kernel.getVolume(shape);
  return {
    densityKgM3: 1,
    volumeM3,
    surfaceAreaM2: kernel.getSurfaceArea(shape),
    massKg: volumeM3,
    centerOfMassM: [center.x, center.y, center.z],
    inertiaKgM2: inertiaTuple(kernel, shape),
  };
}

function abortIfRequested(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Exact CAD rebuild was cancelled", "AbortError");
}

const yieldForCancellation = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function rebuildDocument(
  bridge: OcctBridge,
  document: DesignDocument,
  outputs: readonly CadOutput[],
  signal: AbortSignal,
): Promise<CadRebuildPayload> {
  return bridge.withKernel(async (kernel) => {
    const mark = kernel.checkpoint();
    try {
      abortIfRequested(signal);
      for (const output of outputs) {
        if (output === "section-curves") {
          throw new CadRebuildError("feature-failed", `CAD output is not implemented: ${output}`);
        }
      }
      const sketches = new Map(document.sketches.map((sketch) => [sketch.id, sketch]));
      const featureShapes = new Map<string, ShapeHandle>();
      const rebuiltFeatures: RebuiltFeatureShape[] = [];
      const resolve = (expression: ScalarExpression, kind: "length" | "angle", label: string) =>
        resolveScalar(document, expression, kind, label);
      for (const sketch of document.sketches) preflightSketchExpressions(sketch, resolve);
      for (const feature of document.features) {
        if (feature.kind === "extrude") {
          if (resolve(feature.distanceM, "length", `${feature.id}.distanceM`) <= 0) {
            throw new CadRebuildError("feature-failed", `Extrude distance must be positive: ${feature.id}`);
          }
        } else if (feature.kind === "revolve") {
          const angle = resolve(feature.angleRad, "angle", `${feature.id}.angleRad`);
          if (angle <= 0 || angle > Math.PI * 2) {
            throw new CadRebuildError("feature-failed", `Revolve angle is outside (0, 2π]: ${feature.id}`);
          }
          resolve(feature.axis.originM[0], "length", `${feature.id}.axis.originM[0]`);
          resolve(feature.axis.originM[1], "length", `${feature.id}.axis.originM[1]`);
        }
      }
      for (const feature of document.features) {
        await yieldForCancellation();
        abortIfRequested(signal);
        let shape: ShapeHandle;
        if (feature.kind === "extrude" || feature.kind === "revolve") {
          const sketch = sketches.get(feature.sketchId);
          if (!sketch) throw new CadRebuildError("feature-failed", `Feature sketch is missing: ${feature.sketchId}`);
          const built = buildSketch(kernel, document, sketch, resolve);
          if (feature.kind === "extrude") {
            const distance = resolve(feature.distanceM, "length", `${feature.id}.distanceM`);
            if (distance <= 0) throw new CadRebuildError("feature-failed", `Extrude distance must be positive: ${feature.id}`);
            const vector = directionOnSketch(built.frame, 0, 0, distance);
            const solids = built.faces.map((face) => {
              const solid = kernel.extrude(face, vector.x, vector.y, vector.z);
              ensureValidSolid(kernel, solid, feature);
              return solid;
            });
            shape = combineSolids(kernel, solids, feature);
          } else {
            const angle = resolve(feature.angleRad, "angle", `${feature.id}.angleRad`);
            if (angle <= 0 || angle > Math.PI * 2) {
              throw new CadRebuildError("feature-failed", `Revolve angle is outside (0, 2π]: ${feature.id}`);
            }
            const dx = feature.axis.direction[0];
            const dy = feature.axis.direction[1];
            const length = Math.hypot(dx, dy);
            const direction = directionOnSketch(built.frame, dx / length, dy / length);
            const axisPoint = pointOnSketch(
              built.frame,
              resolve(feature.axis.originM[0], "length", `${feature.id}.axis.originM[0]`),
              resolve(feature.axis.originM[1], "length", `${feature.id}.axis.originM[1]`),
            );
            const solids = built.faces.map((face) => {
              const solid = kernel.revolve(face, { point: axisPoint, direction }, angle);
              ensureValidSolid(kernel, solid, feature);
              return solid;
            });
            shape = combineSolids(kernel, solids, feature);
          }
        } else {
          const left = featureShapes.get(feature.leftFeatureId);
          const right = featureShapes.get(feature.rightFeatureId);
          if (!left || !right) throw new CadRebuildError("feature-failed", `Boolean inputs are unavailable: ${feature.id}`);
          shape = booleanShape(kernel, feature, left, right);
        }
        featureShapes.set(feature.id, shape);
        rebuiltFeatures.push({ id: feature.id, shape });
      }
      const rebuiltBodies: RebuiltBodyShape[] = document.bodies.map((body) => {
        const shape = featureShapes.get(body.featureId);
        if (!shape) throw new CadRebuildError("feature-failed", `Body feature did not rebuild: ${body.featureId}`);
        return {
          id: body.id,
          terminalFeatureId: body.featureId,
          lineageFeatureIds: featureLineage(document, body.featureId),
          shape,
        };
      });
      if (rebuiltBodies.length === 0) throw new CadRebuildError("invalid-solid", "Document contains no exact bodies");
      const resultShape = rebuiltBodies.length === 1
        ? rebuiltBodies[0]!.shape
        : kernel.makeCompound(rebuiltBodies.map(({ shape }) => shape));
      return {
        featureIds: document.features.map(({ id }) => id),
        bodyIds: document.bodies.map(({ id }) => id),
        ...(outputs.includes("brep") ? { brep: { bytes: kernel.toBREPBinary(resultShape) } } : {}),
        ...(outputs.includes("semantic-mesh")
          ? { semanticMesh: tessellateSemanticBodies(kernel, rebuiltFeatures, rebuiltBodies) }
          : {}),
        ...(outputs.includes("mass-properties") ? { massProperties: massProperties(kernel, resultShape) } : {}),
        ...(outputs.includes("step") ? { step: { bytes: exportStepBytes(kernel, resultShape) } } : {}),
      };
    } catch (error) {
      if (error instanceof CadRebuildError
        || (error instanceof DOMException && error.name === "AbortError")) throw error;
      const message = error instanceof Error && error.message.length > 0
        ? error.message
        : "Unknown exact feature failure";
      throw new CadRebuildError("feature-failed", message);
    } finally {
      kernel.releaseSince(mark);
    }
  });
}
