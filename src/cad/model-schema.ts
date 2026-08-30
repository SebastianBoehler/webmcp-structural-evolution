import { z } from "zod";

const finite = z.number().finite();
const positive = finite.positive();
const entityIdPattern = /^[a-z][a-z0-9-]{0,79}$/;

export const EntityIdSchema = z.string().regex(entityIdPattern, "Entity ID must be lowercase kebab-case");

export const ParameterExpressionSchema = z.object({ parameterId: EntityIdSchema }).strict();
export const LengthExpressionSchema = z.union([finite, ParameterExpressionSchema]);
export const PositiveLengthExpressionSchema = z.union([positive, ParameterExpressionSchema]);
export const AngleExpressionSchema = z.union([finite, ParameterExpressionSchema]);
export const PositiveAngleExpressionSchema = z.union([positive, ParameterExpressionSchema]);
const Point2Schema = z.tuple([LengthExpressionSchema, LengthExpressionSchema]);
const Direction2Schema = z.tuple([finite, finite]).refine(
  ([x, y]) => Math.hypot(x, y) > 0,
  "Axis direction must be nonzero",
);
const PointNameSchema = z.enum(["start", "end", "center", "left", "right", "bottom", "top"]);
const PointReferenceSchema = z.object({ entityId: EntityIdSchema, point: PointNameSchema }).strict();

export const SketchEntitySchema = z.discriminatedUnion("kind", [
  z.object({ id: EntityIdSchema, kind: z.literal("line"), startM: Point2Schema, endM: Point2Schema }).strict(),
  z.object({ id: EntityIdSchema, kind: z.literal("arc"), centerM: Point2Schema, radiusM: PositiveLengthExpressionSchema, startAngleRad: AngleExpressionSchema, endAngleRad: AngleExpressionSchema }).strict(),
  z.object({ id: EntityIdSchema, kind: z.literal("circle"), centerM: Point2Schema, radiusM: PositiveLengthExpressionSchema }).strict(),
  z.object({ id: EntityIdSchema, kind: z.literal("rectangle"), centerM: Point2Schema, sizeM: z.tuple([PositiveLengthExpressionSchema, PositiveLengthExpressionSchema]) }).strict(),
]);

export const SketchConstraintSchema = z.discriminatedUnion("kind", [
  z.object({ id: EntityIdSchema, kind: z.literal("coincident"), first: PointReferenceSchema, second: PointReferenceSchema }).strict(),
  z.object({ id: EntityIdSchema, kind: z.enum(["horizontal", "vertical"]), entityId: EntityIdSchema }).strict(),
  z.object({ id: EntityIdSchema, kind: z.literal("distance"), first: PointReferenceSchema, second: PointReferenceSchema, axis: z.enum(["x", "y"]).optional(), valueM: PositiveLengthExpressionSchema }).strict(),
  z.object({ id: EntityIdSchema, kind: z.literal("radius"), entityId: EntityIdSchema, valueM: PositiveLengthExpressionSchema }).strict(),
  z.object({ id: EntityIdSchema, kind: z.literal("angle"), vertex: PointReferenceSchema, firstDirection: PointReferenceSchema, secondDirection: PointReferenceSchema, valueRad: AngleExpressionSchema }).strict(),
]);

export const SketchSchema = z.object({
  id: EntityIdSchema,
  plane: z.string().regex(/^frame:[a-z][a-z0-9-]{0,79}$/, "Sketch plane must reference a frame"),
  entities: z.array(SketchEntitySchema),
  constraints: z.array(SketchConstraintSchema),
}).strict();

export const FeatureSchema = z.discriminatedUnion("kind", [
  z.object({ id: EntityIdSchema, kind: z.literal("extrude"), sketchId: EntityIdSchema, distanceM: PositiveLengthExpressionSchema }).strict(),
  z.object({
    id: EntityIdSchema, kind: z.literal("revolve"), sketchId: EntityIdSchema,
    angleRad: z.union([positive.max(Math.PI * 2), ParameterExpressionSchema]),
    axis: z.object({ originM: Point2Schema, direction: Direction2Schema }).strict(),
  }).strict(),
  z.object({ id: EntityIdSchema, kind: z.enum(["union", "cut", "intersect"]), leftFeatureId: EntityIdSchema, rightFeatureId: EntityIdSchema }).strict(),
]);

export const BodySchema = z.object({ id: EntityIdSchema, featureId: EntityIdSchema }).strict();
export const ComponentSchema = z.object({ id: EntityIdSchema, bodyIds: z.array(EntityIdSchema).min(1) }).strict();
export const AssemblyInstanceSchema = z.object({ id: EntityIdSchema, componentId: EntityIdSchema, frameId: EntityIdSchema }).strict();
export const NamedSelectionSchema = z.object({
  id: EntityIdSchema,
  bodyId: EntityIdSchema,
  featureId: EntityIdSchema,
  query: z.object({ kind: z.enum(["face", "edge"]), selector: z.string().min(1) }).strict(),
}).strict();
export const MateSchema = z.object({
  id: EntityIdSchema,
  kind: z.literal("rigid"),
  firstInstanceId: EntityIdSchema,
  secondInstanceId: EntityIdSchema,
  firstSelectionId: EntityIdSchema,
  secondSelectionId: EntityIdSchema,
}).strict();

type ParsedSketch = z.infer<typeof SketchSchema>;

function addUniqueIssues(values: readonly { id: string }[], label: string, context: z.RefinementCtx): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) context.addIssue({ code: "custom", message: `Duplicate ${label} ID: ${value.id}` });
    ids.add(value.id);
  }
}

function pointsFor(entity: z.infer<typeof SketchEntitySchema>): readonly z.infer<typeof PointNameSchema>[] {
  switch (entity.kind) {
    case "line": return ["start", "end"];
    case "arc": return ["start", "end", "center"];
    case "circle": return ["center"];
    case "rectangle": return ["center", "left", "right", "bottom", "top"];
  }
}

function checkPointReference(reference: z.infer<typeof PointReferenceSchema>, entities: Map<string, z.infer<typeof SketchEntitySchema>>, context: z.RefinementCtx): void {
  const entity = entities.get(reference.entityId);
  if (!entity) {
    context.addIssue({ code: "custom", message: `Sketch entity is unresolved: ${reference.entityId}` });
  } else if (!pointsFor(entity).includes(reference.point)) {
    context.addIssue({ code: "custom", message: `Point is unresolved: ${reference.entityId}.${reference.point}` });
  }
}

function checkSketch(sketch: ParsedSketch, context: z.RefinementCtx): void {
  addUniqueIssues(sketch.entities, "sketch entity", context);
  addUniqueIssues(sketch.constraints, "sketch constraint", context);
  const entities = new Map(sketch.entities.map((entity) => [entity.id, entity]));
  for (const constraint of sketch.constraints) {
    if (constraint.kind === "coincident" || constraint.kind === "distance") {
      checkPointReference(constraint.first, entities, context);
      checkPointReference(constraint.second, entities, context);
    } else if (constraint.kind === "angle") {
      checkPointReference(constraint.vertex, entities, context);
      checkPointReference(constraint.firstDirection, entities, context);
      checkPointReference(constraint.secondDirection, entities, context);
    } else {
      const entity = entities.get(constraint.entityId);
      if (!entity) {
        context.addIssue({ code: "custom", message: `Sketch entity is unresolved: ${constraint.entityId}` });
      } else if ((constraint.kind === "horizontal" || constraint.kind === "vertical") && entity.kind !== "line") {
        context.addIssue({ code: "custom", message: `${constraint.kind} constraint requires a line: ${constraint.entityId}` });
      } else if (constraint.kind === "radius" && entity.kind !== "arc" && entity.kind !== "circle") {
        context.addIssue({ code: "custom", message: `Radius constraint requires an arc or circle: ${constraint.entityId}` });
      }
    }
  }
}

function sketchHasClosedProfile(sketch: ParsedSketch): boolean {
  const endpoints = new Map<string, number>();
  const pointKey = (point: readonly number[]) => point.map((value) => Math.round(value * 1e12) / 1e12).join(",");
  const count = (point: readonly number[]) => {
    const key = pointKey(point);
    endpoints.set(key, (endpoints.get(key) ?? 0) + 1);
  };
  const literalPoint = (point: readonly z.infer<typeof LengthExpressionSchema>[]) =>
    point.every((value) => typeof value === "number") ? point as readonly number[] : undefined;
  for (const entity of sketch.entities) {
    if (entity.kind === "line") {
      const start = literalPoint(entity.startM);
      const end = literalPoint(entity.endM);
      if (!start || !end) return true;
      count(start);
      count(end);
    } else if (entity.kind === "arc") {
      const center = literalPoint(entity.centerM);
      if (!center || typeof entity.radiusM !== "number"
        || typeof entity.startAngleRad !== "number" || typeof entity.endAngleRad !== "number") return true;
      count([center[0]! + entity.radiusM * Math.cos(entity.startAngleRad), center[1]! + entity.radiusM * Math.sin(entity.startAngleRad)]);
      count([center[0]! + entity.radiusM * Math.cos(entity.endAngleRad), center[1]! + entity.radiusM * Math.sin(entity.endAngleRad)]);
    }
  }
  return [...endpoints.values()].every((value) => value === 2)
    && (endpoints.size > 0 || sketch.entities.some(({ kind }) => kind === "circle" || kind === "rectangle"));
}

export function addModelIntegrityIssues(
  value: {
    frames: readonly { id: string }[]; sketches: readonly ParsedSketch[]; features: readonly z.infer<typeof FeatureSchema>[];
    bodies: readonly z.infer<typeof BodySchema>[]; components: readonly z.infer<typeof ComponentSchema>[];
    instances: readonly z.infer<typeof AssemblyInstanceSchema>[]; mates: readonly z.infer<typeof MateSchema>[];
    namedSelections: readonly z.infer<typeof NamedSelectionSchema>[];
  },
  context: z.RefinementCtx,
): void {
  addUniqueIssues(value.sketches, "sketch", context);
  addUniqueIssues(value.features, "feature", context);
  addUniqueIssues(value.bodies, "body", context);
  addUniqueIssues(value.components, "component", context);
  addUniqueIssues(value.instances, "instance", context);
  addUniqueIssues(value.mates, "mate", context);
  addUniqueIssues(value.namedSelections, "named selection", context);
  for (const sketch of value.sketches) checkSketch(sketch, context);

  const frames = new Set(value.frames.map(({ id }) => id));
  const sketches = new Map(value.sketches.map((sketch) => [sketch.id, sketch]));
  for (const sketch of value.sketches) {
    if (!frames.has(sketch.plane.slice("frame:".length))) context.addIssue({ code: "custom", message: `Sketch plane is unresolved: ${sketch.plane}` });
  }
  const previousFeatures = new Set<string>();
  for (const feature of value.features) {
    if (feature.kind === "extrude" || feature.kind === "revolve") {
      const sketch = sketches.get(feature.sketchId);
      if (!sketch) context.addIssue({ code: "custom", message: `Feature sketch is unresolved: ${feature.sketchId}` });
      else if (!sketchHasClosedProfile(sketch)) context.addIssue({ code: "custom", message: `Solid feature uses an open profile: ${feature.sketchId}` });
    } else if (!previousFeatures.has(feature.leftFeatureId) || !previousFeatures.has(feature.rightFeatureId)) {
      context.addIssue({ code: "custom", message: `Feature has a forward or unresolved dependency: ${feature.id}` });
    }
    previousFeatures.add(feature.id);
  }
  const featureIds = new Set(value.features.map(({ id }) => id));
  const consumedFeatures = new Set(value.features.flatMap((feature) => feature.kind === "extrude" || feature.kind === "revolve" ? [] : [feature.leftFeatureId, feature.rightFeatureId]));
  const bodies = new Map(value.bodies.map((body) => [body.id, body]));
  const terminalFeatureOwners = new Set<string>();
  for (const body of value.bodies) {
    if (!featureIds.has(body.featureId)) context.addIssue({ code: "custom", message: `Body feature is unresolved: ${body.featureId}` });
    else if (consumedFeatures.has(body.featureId)) context.addIssue({ code: "custom", message: `Body feature must be terminal: ${body.featureId}` });
    if (terminalFeatureOwners.has(body.featureId)) {
      context.addIssue({ code: "custom", message: `Terminal feature has multiple body owners: ${body.featureId}` });
    }
    terminalFeatureOwners.add(body.featureId);
  }
  const ownedBodies = new Set<string>();
  for (const component of value.components) for (const bodyId of component.bodyIds) {
    if (!bodies.has(bodyId)) context.addIssue({ code: "custom", message: `Component body is unresolved: ${bodyId}` });
    if (ownedBodies.has(bodyId)) context.addIssue({ code: "custom", message: `Body has multiple component owners: ${bodyId}` });
    ownedBodies.add(bodyId);
  }
  const components = new Map(value.components.map((component) => [component.id, new Set(component.bodyIds)]));
  const instances = new Map(value.instances.map((instance) => [instance.id, instance]));
  for (const instance of value.instances) {
    if (!components.has(instance.componentId)) context.addIssue({ code: "custom", message: `Instance component is unresolved: ${instance.componentId}` });
    if (!frames.has(instance.frameId)) context.addIssue({ code: "custom", message: `Instance frame is unresolved: ${instance.frameId}` });
  }
  const selections = new Map(value.namedSelections.map((selection) => [selection.id, selection]));
  for (const selection of value.namedSelections) {
    const body = bodies.get(selection.bodyId);
    if (!body) context.addIssue({ code: "custom", message: `Named selection body is unresolved: ${selection.bodyId}` });
    else if (body.featureId !== selection.featureId) context.addIssue({ code: "custom", message: `Named selection feature is not owned by body: ${selection.featureId}` });
  }
  for (const mate of value.mates) {
    const firstInstance = instances.get(mate.firstInstanceId);
    const secondInstance = instances.get(mate.secondInstanceId);
    const firstSelection = selections.get(mate.firstSelectionId);
    const secondSelection = selections.get(mate.secondSelectionId);
    if (!firstInstance || !secondInstance) context.addIssue({ code: "custom", message: `Mate instance is unresolved: ${mate.id}` });
    if (!selections.has(mate.firstSelectionId) || !selections.has(mate.secondSelectionId)) context.addIssue({ code: "custom", message: `Mate named selection is unresolved: ${mate.id}` });
    if (firstInstance && firstSelection && !components.get(firstInstance.componentId)?.has(firstSelection.bodyId)) {
      context.addIssue({ code: "custom", message: `Mate selection is outside first instance component: ${mate.id}` });
    }
    if (secondInstance && secondSelection && !components.get(secondInstance.componentId)?.has(secondSelection.bodyId)) {
      context.addIssue({ code: "custom", message: `Mate selection is outside second instance component: ${mate.id}` });
    }
  }
}

export type Sketch = z.infer<typeof SketchSchema>;
export type Feature = z.infer<typeof FeatureSchema>;
export type Body = z.infer<typeof BodySchema>;
export type Component = z.infer<typeof ComponentSchema>;
export type AssemblyInstance = z.infer<typeof AssemblyInstanceSchema>;
export type Mate = z.infer<typeof MateSchema>;
export type NamedSelection = z.infer<typeof NamedSelectionSchema>;
