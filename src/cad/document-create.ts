import { z } from "zod";

import { ActorSchema, DisplayUnitsSchema } from "./document-base";
import { EntityIdSchema } from "./model-schema";

export const CreateDesignDocumentInputSchema = z.object({
  id: EntityIdSchema,
  label: z.string().min(1),
  units: DisplayUnitsSchema,
  createdBy: ActorSchema,
}).strict();

export function initialDocumentContent(input: z.infer<typeof CreateDesignDocumentInputSchema>) {
  return {
    ...input,
    schemaVersion: 5 as const,
    frames: [{
      id: "world", label: "World",
      transform: {
        position: {
          x: { value: 0, unit: "m" as const },
          y: { value: 0, unit: "m" as const },
          z: { value: 0, unit: "m" as const },
        },
        orientation: {
          roll: { value: 0, unit: "rad" as const },
          pitch: { value: 0, unit: "rad" as const },
          yaw: { value: 0, unit: "rad" as const },
        },
      },
    }],
    parameters: [], sketches: [], features: [], bodies: [], components: [],
    instances: [], mates: [], namedSelections: [], materials: [], studies: [],
  };
}
