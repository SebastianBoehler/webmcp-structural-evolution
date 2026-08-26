import { referenceComponent } from "../samples/reference-drone-catalog";
import type { ComponentRenderResource } from "./assembly-workspace-model";

const resource = (
  componentId: string,
  filename: string,
  sizeMm: [number, number, number],
): readonly [string, ComponentRenderResource] => {
  const definition = referenceComponent(componentId);
  return [definition.revision, {
    name: definition.partNumber,
    category: definition.category === "motor" || definition.category === "propeller" ? definition.category : "other",
    assetUrl: `/reference-cad/${filename}`,
    assetUnits: "m",
    sourceUrl: definition.provenance.sources[0]!.reference,
    sizeMm,
    validation: "manufacturer-dimensions",
    stagedBy: "human",
  }];
};

export const REFERENCE_DISPLAY_RESOURCES: Readonly<Record<string, ComponentRenderResource>> = Object.freeze(Object.fromEntries([
  resource("motor-2207", "hobbywing-xrotor-2207.glb", [28, 28, 31.9]),
  resource("propeller-5x4.3x3", "hqprop-5x4.3x3.glb", [127, 127, 6.5]),
  resource("fc-esc-stack-30x30", "speedybee-f405-v4-stack.glb", [45.6, 44, 19.8]),
  resource("battery-6s-1550", "tattu-rline-v5-1550-6s.glb", [78, 37, 52]),
  resource("fpv-camera", "runcam-phoenix-2.glb", [31, 20, 19]),
  resource("motor-wiring-corridor", "motor-to-esc-3x20awg.glb", [72, 6, 4]),
]));
