import { referenceComponent } from "../samples/reference-drone-catalog";
import type { ComponentRenderResource } from "./assembly-workspace-model";

const resource = (
  componentId: string,
  filename: string,
  sizeMm: [number, number, number],
  assetUnits: ComponentRenderResource["assetUnits"] = "m",
): readonly [string, ComponentRenderResource] => {
  const definition = referenceComponent(componentId);
  return [definition.revision, {
    name: definition.partNumber,
    category: definition.category === "motor" || definition.category === "propeller" ? definition.category : "other",
    assetUrl: `/reference-cad/${filename}`,
    assetUnits,
    sourceUrl: definition.provenance.sources[0]!.reference,
    sizeMm,
    validation: "manufacturer-dimensions",
    stagedBy: "human",
  }];
};

export const REFERENCE_DISPLAY_RESOURCES: Readonly<Record<string, ComponentRenderResource>> = Object.freeze(Object.fromEntries([
  resource("motor-2207", "hobbywing-xrotor-2207.glb", [28, 28, 31.9]),
  resource("propeller-5x4.3x3", "hqprop-5x4.3x3.glb", [127, 127, 6.5]),
  resource("fastener-m3x8", "accu-m3x8-din912.glb", [5.68, 5.68, 11]),
  resource("camera-fastener-m2x4", "accu-m2x4-a4-black.glb", [3.8, 6, 3.8]),
  resource("stack-bolt-m3x25", "accu-m3x25-din912.glb", [5.68, 5.68, 28]),
  resource("stack-spacer-m3x6", "harwin-r30-6700694.glb", [5, 5, 6]),
  resource("stack-spacer-m3x5", "harwin-r30-6700594.glb", [5, 5, 5]),
  resource("stack-locknut-m3", "nbk-swut-m3.glb", [6.4, 6.4, 4]),
  resource("flight-controller-30x30", "opendrone-openfc-lite-rev3.3.glb", [37.942302, 37.942302, 5.38], "mm"),
  resource("esc-30x30", "opendrone-openesc-30x30-rev3.3.glb", [41.62706, 42.504999, 6.33], "mm"),
  resource("battery-6s-1550", "tattu-rline-v5-1550-6s.glb", [78, 37, 52]),
  resource("battery-retention-strap", "sunderlabs-battery-strap-20mm.glb", [22, 43, 60.95]),
  resource("battery-power-harness", "xt60-openesc-battery-harness.glb", [60, 20, 36]),
  resource("fpv-camera", "runcam-phoenix-2.glb", [31, 20, 19]),
  resource("video-transmitter", "speedybee-tx800.glb", [28, 28, 6]),
  resource("video-antenna", "foxeer-lollipop-4-plus.glb", [60, 11, 11]),
  resource("radio-receiver", "radiomaster-rp1-v2.glb", [78, 30, 3]),
  resource("motor-wiring-corridor", "motor-to-esc-3x20awg.glb", [72, 6, 4]),
]));
