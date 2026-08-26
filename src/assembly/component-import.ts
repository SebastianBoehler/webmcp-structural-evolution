import { z } from "zod";
import type { CadMesh } from "./step-import";

const httpsUrl = z.string().url().refine((value) => new URL(value).protocol === "https:", "Use an HTTPS URL");

export const ComponentImportSchema = z.object({
  name: z.string().trim().min(1).max(80),
  category: z.enum(["motor", "propeller", "electronics", "sensor", "hardware", "other"]),
  manufacturer: z.string().trim().min(1).max(80),
  partNumber: z.string().trim().min(1).max(80),
  assetUrl: httpsUrl,
  assetUnits: z.enum(["mm", "m"]),
  sourceUrl: httpsUrl,
  massG: z.number().positive().max(100_000),
  sizeMm: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
}).strict();

export type ComponentImport = Readonly<z.infer<typeof ComponentImportSchema>>;

export interface PendingComponentImport extends ComponentImport {
  readonly id: string;
  readonly stagedBy: "agent";
}

export interface ImportedComponent extends ComponentImport {
  readonly id: string;
  readonly assetUrl: string;
  readonly stagedBy: "agent" | "human";
  readonly validation: "unverified-visual" | "manufacturer-dimensions" | "package-digest-verified";
  readonly mesh?: CadMesh;
}

export const componentImportJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 80 },
    category: { type: "string", enum: ["motor", "propeller", "electronics", "sensor", "hardware", "other"] },
    manufacturer: { type: "string", minLength: 1, maxLength: 80 },
    partNumber: { type: "string", minLength: 1, maxLength: 80 },
    assetUrl: { type: "string", format: "uri", pattern: "^https://" },
    assetUnits: { type: "string", enum: ["mm", "m"] },
    sourceUrl: { type: "string", format: "uri", pattern: "^https://" },
    massG: { type: "number", exclusiveMinimum: 0, maximum: 100000 },
    sizeMm: {
      type: "array",
      items: { type: "number", exclusiveMinimum: 0 },
      minItems: 3,
      maxItems: 3,
    },
  },
  required: ["name", "category", "manufacturer", "partNumber", "assetUrl", "assetUnits", "sourceUrl", "massG", "sizeMm"],
  additionalProperties: false,
} as const;
