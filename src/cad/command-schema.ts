import { z } from "zod";

import {
  ActorSchema,
  EntityIdSchema,
  FrameSchema,
  ParameterSchema,
  ParameterValueSchema,
  SemanticReferenceSchema,
} from "./document-schema";
import {
  AssemblyInstanceSchema,
  BodySchema,
  ComponentSchema,
  FeatureSchema,
  MateSchema,
  NamedSelectionSchema,
  SketchSchema,
} from "./model-schema";
import { MaterialDefinitionSchema, StudySchema } from "../engineering/study-schema";
import { RevisionSchema } from "../domain/snapshots";

const CommandIdSchema = EntityIdSchema;

export const RenameDocumentCommandSchema = z.object({
  id: CommandIdSchema,
  type: z.literal("rename-document"),
  label: z.string().min(1),
}).strict();
export const DefineParameterCommandSchema = z.object({
  id: CommandIdSchema,
  type: z.literal("define-parameter"),
  parameter: ParameterSchema,
}).strict();
export const SetParameterCommandSchema = z.object({
  id: CommandIdSchema,
  type: z.literal("set-parameter"),
  parameterId: EntityIdSchema,
  value: ParameterValueSchema,
}).strict();
export const RemoveParameterCommandSchema = z.object({
  id: CommandIdSchema,
  type: z.literal("remove-parameter"),
  parameterId: EntityIdSchema,
}).strict();
export const DefineFrameCommandSchema = z.object({
  id: CommandIdSchema,
  type: z.literal("define-frame"),
  frame: FrameSchema,
}).strict();
export const DefineSketchCommandSchema = z.object({
  id: CommandIdSchema,
  type: z.literal("define-sketch"),
  sketch: SketchSchema,
}).strict();
export const DefineFeatureCommandSchema = z.object({
  id: CommandIdSchema,
  type: z.literal("define-feature"),
  feature: FeatureSchema,
}).strict();
export const RemoveFeatureCommandSchema = z.object({
  id: CommandIdSchema,
  type: z.literal("remove-feature"),
  featureId: EntityIdSchema,
}).strict();
export const DefineBodyCommandSchema = z.object({
  id: CommandIdSchema,
  type: z.literal("define-body"),
  body: BodySchema,
}).strict();
export const DefineComponentCommandSchema = z.object({
  id: CommandIdSchema,
  type: z.literal("define-component"),
  component: ComponentSchema,
}).strict();
export const PlaceInstanceCommandSchema = z.object({
  id: CommandIdSchema,
  type: z.literal("place-instance"),
  instance: AssemblyInstanceSchema,
}).strict();
export const DefineMateCommandSchema = z.object({
  id: CommandIdSchema,
  type: z.literal("define-mate"),
  mate: MateSchema,
}).strict();
export const DefineNamedSelectionCommandSchema = z.object({
  id: CommandIdSchema,
  type: z.literal("define-named-selection"),
  namedSelection: NamedSelectionSchema,
}).strict();
export const DefineMaterialCommandSchema = z.object({
  id: CommandIdSchema,
  type: z.literal("define-material"),
  material: MaterialDefinitionSchema,
}).strict();
export const RemoveMaterialCommandSchema = z.object({
  id: CommandIdSchema,
  type: z.literal("remove-material"),
  materialId: EntityIdSchema,
}).strict();
export const DefineStudyCommandSchema = z.object({
  id: CommandIdSchema,
  type: z.literal("define-study"),
  study: StudySchema,
}).strict();
export const RemoveStudyCommandSchema = z.object({
  id: CommandIdSchema,
  type: z.literal("remove-study"),
  studyId: EntityIdSchema,
}).strict();

export const DesignCommandSchema = z.discriminatedUnion("type", [
  RenameDocumentCommandSchema,
  DefineParameterCommandSchema,
  SetParameterCommandSchema,
  RemoveParameterCommandSchema,
  DefineFrameCommandSchema,
  DefineSketchCommandSchema,
  DefineFeatureCommandSchema,
  RemoveFeatureCommandSchema,
  DefineBodyCommandSchema,
  DefineComponentCommandSchema,
  PlaceInstanceCommandSchema,
  DefineMateCommandSchema,
  DefineNamedSelectionCommandSchema,
  DefineMaterialCommandSchema,
  RemoveMaterialCommandSchema,
  DefineStudyCommandSchema,
  RemoveStudyCommandSchema,
]);

export const ParameterEqualsPreconditionSchema = z.object({
  type: z.literal("parameter-equals"),
  parameterId: EntityIdSchema,
  value: ParameterValueSchema,
}).strict();
export const ReferenceExistsPreconditionSchema = z.object({
  type: z.literal("reference-exists"),
  reference: SemanticReferenceSchema,
}).strict();
export const DesignPreconditionSchema = z.discriminatedUnion("type", [
  ParameterEqualsPreconditionSchema,
  ReferenceExistsPreconditionSchema,
]);

export const DesignTransactionSchema = z.object({
  id: EntityIdSchema,
  expectedRevision: RevisionSchema,
  actor: ActorSchema,
  preconditions: z.array(DesignPreconditionSchema),
  commands: z.array(DesignCommandSchema).max(64),
}).strict().superRefine((transaction, context) => {
  const commandIds = new Set<string>();
  for (const command of transaction.commands) {
    if (commandIds.has(command.id)) {
      context.addIssue({ code: "custom", message: `Duplicate command ID: ${command.id}` });
    }
    commandIds.add(command.id);
  }
});

export type DesignCommand = z.infer<typeof DesignCommandSchema>;
export type DesignPrecondition = z.infer<typeof DesignPreconditionSchema>;
export type DesignTransaction = z.infer<typeof DesignTransactionSchema>;
export type ChangedReference = z.infer<typeof SemanticReferenceSchema>;
