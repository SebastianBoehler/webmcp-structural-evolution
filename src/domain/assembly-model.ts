import { z } from "zod";

import {
  MountInterfaceSchema,
  normalizeMountInterface,
  normalizeTransform,
  normalizeVolume,
  TransformSchema,
  VolumeSchema,
} from "./engineering-units";
import { defineRevisionedSnapshot, RevisionSchema, type DeepReadonly } from "./snapshots";

const ComponentRequirementSchema = z.object({
  instanceId: z.string().min(1),
  componentRevision: RevisionSchema,
  quantity: z.number().int().positive(),
  transform: TransformSchema,
}).strict();
const AssemblyDraftContentSchema = z.object({
  id: z.string().min(1),
  geometryCoordinates: z.literal("assembly"),
  components: z.array(ComponentRequirementSchema).min(1),
  targetEnvelope: VolumeSchema,
  preservedMounts: z.array(MountInterfaceSchema),
  obstacleVolumes: z.array(VolumeSchema),
  accessVolumes: z.array(VolumeSchema),
  missingComponents: z.array(z.string().min(1)),
  incompatibleComponents: z.array(z.string().min(1)),
  ambiguousComponents: z.array(z.string().min(1)),
}).strict();

export const AssemblyDraftSchema = AssemblyDraftContentSchema.extend({ revision: RevisionSchema }).strict();
export const AssemblySpecSchema = AssemblyDraftSchema;
export type AssemblyDraft = DeepReadonly<z.infer<typeof AssemblyDraftSchema>>;
export type AssemblySpec = AssemblyDraft;
export const defineAssemblyDraft = async (value: unknown): Promise<AssemblyDraft> =>
  defineRevisionedSnapshot(AssemblyDraftContentSchema, value, (draft) => ({
    ...draft,
    components: draft.components.map((component) => ({
      ...component,
      transform: normalizeTransform(component.transform),
    })),
    targetEnvelope: normalizeVolume(draft.targetEnvelope),
    preservedMounts: draft.preservedMounts.map(normalizeMountInterface),
    obstacleVolumes: draft.obstacleVolumes.map(normalizeVolume),
    accessVolumes: draft.accessVolumes.map(normalizeVolume),
  }));
export const defineAssembly = defineAssemblyDraft;
