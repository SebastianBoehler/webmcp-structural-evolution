import { defineComponent, type ComponentDefinition } from "../domain/component-model";
import {
  BATTERY_GRAPH,
  BODY_INTERFACE_GRAPH,
  CAMERA_GRAPH,
  FASTENER_GRAPH,
  MOTOR_GRAPH,
  PROPELLER_GRAPH,
  STACK_GRAPH,
  WIRING_GRAPH,
} from "./reference-drone-graphs";

const m = (value: number) => ({ value, unit: "m" as const });
const kg = (value: number) => ({ value, unit: "kg" as const });
const point = (x: number, y: number, z: number) => ({ x: m(x), y: m(y), z: m(z) });
const zeroOrientation = {
  roll: { value: 0, unit: "rad" as const },
  pitch: { value: 0, unit: "rad" as const },
  yaw: { value: 0, unit: "rad" as const },
};
const box = (id: string, center: readonly [number, number, number], size: readonly [number, number, number]) => ({
  kind: "box" as const, id, center: point(...center), size: point(...size), orientation: zeroOrientation,
});
const cylinder = (id: string, center: readonly [number, number, number], radius: number, height: number) => ({
  kind: "cylinder" as const, id, center: point(...center), radius: m(radius), height: m(height), orientation: zeroOrientation,
});
const mount = (id: string, position: readonly [number, number, number], diameter: number, fastenerType = "M3") => ({
  id, position: point(...position), orientation: zeroOrientation, diameter: m(diameter), fastenerType,
});
const semantic = (kind: "mount" | "mate" | "cable", id: string, position: readonly [number, number, number], detail: Record<string, unknown>) => ({
  kind, id, coordinates: "component-local" as const, position: point(...position), orientation: zeroOrientation, ...detail,
});
const anchor = (id: string) => ({ id, coordinates: "component-local" as const, position: point(0, 0, 0) });

const source = (
  id: string,
  classification: "manufacturer-datasheet" | "manufacturer-product-page" | "supplier-specification" | "derived-constraint-input" | "engineering-drawing",
  title: string,
  reference: string,
  sourceTimestamp: `${number}-${number}-${number}` | "undated" = "undated",
) => ({ id, classification, title, reference, sourceTimestamp, accessedOn: "2026-08-26" as const, redistribution: "facts-only" as const });
const sources = {
  hobbywing: source("hobbywing-datasheet", "manufacturer-datasheet", "Hobbywing XRotor 2207.5SL 1780KV specification", "https://www.hobbywing.com/en/uploads/file/20251117/feb50ba5342e53ce2431c20799f047d8.pdf", "2025-11-17"),
  hobbywingProduct: source("hobbywing-product", "manufacturer-product-page", "Hobbywing XRotor 2207.5 product page", "https://www.hobbywing.com/en/products/xrotor-22075"),
  speedybee: source("speedybee-product", "manufacturer-product-page", "SpeedyBee F405 V4 BLS 55A 30x30 stack", "https://www.speedybee.com/speedybee-f405-v4-bls-55a-30x30-fc-esc-stack/"),
  tattu: source("tattu-product", "manufacturer-product-page", "Tattu R-Line V5 1550mAh 6S 150C", "https://www.genstattu.com/tattu-r-line-version-5-0-1550mah-6s-150c-22-2v-lipo-battery-pack-with-xt60-plug/"),
  accu: source("accu-spec", "supplier-specification", "Accu SSCF-M3-8-12.9-Z", "https://www.accu.co.uk/metric-cap-head-screws/386767-SSCF-M3-8-12-9-Z"),
  hqprop: source("hqprop-product", "manufacturer-product-page", "HQProp HQ5X4.3X3V2S-PC", "https://www.hqprop.com/hq-freestyle-prop-5x43x3v2s-2cw2ccw-poly-carbonate-p0233.html"),
  body: source("frame-interface-drawing", "engineering-drawing", "Foundation interface drawing rev 1", "sunderlabs:foundation-interface:rev-1", "2026-08-26"),
  runcam: source("runcam-phoenix-2-manual", "manufacturer-datasheet", "RunCam Phoenix 2 manual", "https://www.runcam.com/download/Phoenix2/Phoenix_2_Manual.pdf"),
} as const;
type SourceKey = keyof typeof sources;
const provenance = (
  sourceKeys: readonly SourceKey[],
  observations: readonly (readonly [string, number | string, string, SourceKey])[],
  uncertainty: string,
) => ({
  mode: "modeled-from-specification" as const,
  licence: { status: "facts-only" as const },
  uncertainty: [{ property: "physical representation", statement: uncertainty }],
  sources: sourceKeys.map((key) => sources[key]),
  sourceObservations: observations.map(([property, value, unit, sourceId]) => ({
    property, value, unit, sourceId: sources[sourceId].id,
  })),
});
const common = {
  geometryCoordinates: "component-local" as const,
  allowedOrientations: [zeroOrientation],
  loadContributions: [],
};

const mountPoints = [[0.005657, 0.005657, 0], [-0.005657, 0.005657, 0], [-0.005657, -0.005657, 0], [0.005657, -0.005657, 0]] as const;
const stackMounts = [[0.01525, 0.01525, 0], [-0.01525, 0.01525, 0], [-0.01525, -0.01525, 0], [0.01525, -0.01525, 0]] as const;

const definitions = [
  { ...common, id: "motor-2207", category: "motor", manufacturer: "Hobbywing", partNumber: "XRotor-2207.5SL-1780KV", provenance: provenance(["hobbywing", "hobbywingProduct"], [["motor diameter", 28, "mm", "hobbywing"], ["body height", 19.9, "mm", "hobbywing"], ["stator", "22.5 x 7.6", "mm", "hobbywing"], ["shaft", "5 x 12", "mm", "hobbywing"]], "Published dimensions; the display pigtail is trimmed to the declared assembly cable endpoint."), mass: kg(0.038), massAccounting: "standalone", optimizationRole: "fixed-component", centerOfMass: point(0, 0, 0.00995), anchor: anchor("mount-plane"), envelope: cylinder("motor-envelope", [0, 0, 0.01595], 0.014, 0.0319), collisionVolumes: [cylinder("motor-body-collision", [0, 0, 0.00995], 0.014, 0.0199), cylinder("motor-shaft-collision", [0, 0, 0.02585], 0.0025, 0.0121)], protectedVolumes: [], mountInterfaces: mountPoints.map((position, index) => mount(`motor-mount-${index + 1}`, position, 0.003)), geometry: { kind: "parametric", graph: MOTOR_GRAPH }, interfaces: [...mountPoints.map((position, index) => semantic("mount", `motor-mount-${index + 1}`, position, { diameter: m(0.003), fastenerType: "M3" })), semantic("mate", "propeller-shaft-seat", [0, 0, 0.02315], { mating: "concentric", diameter: m(0.005) }), semantic("cable", "motor-phase-leads", [-0.012, 0, 0.001], { connector: "3x 20AWG soldered phase joint" })], loadContributions: [{ id: "motor-thrust-load", force: { x: { value: 0, unit: "N" }, y: { value: 0, unit: "N" }, z: { value: -18, unit: "N" } } }] },
  { ...common, id: "fc-esc-stack-30x30", category: "avionics", manufacturer: "SpeedyBee", partNumber: "F405 V4 + BLS 55A Stack, SB-F4V4-55-STACK", provenance: provenance(["speedybee"], [["FC board", "41.6 x 39.4 x 7.8", "mm", "speedybee"], ["ESC board", "45.6 x 44 x 8", "mm", "speedybee"], ["mount pitch", 30.5, "mm", "speedybee"]], "Board dimensions and masses are published; installed board gap is a conservative 4 +/-2 mm assumption."), mass: kg(0.034), massAccounting: "standalone", optimizationRole: "fixed-component", centerOfMass: point(0, 0, 0), anchor: anchor("stack-envelope-center"), envelope: box("stack-envelope", [0, 0, 0], [0.0456, 0.044, 0.0198]), collisionVolumes: [box("stack-collision", [0, 0, 0], [0.0456, 0.044, 0.0198])], protectedVolumes: [box("keepout", [0, 0, 0], [0.0516, 0.05, 0.0258])], mountInterfaces: stackMounts.map((position, index) => mount(`stack-mount-${index + 1}`, position, 0.004)), geometry: { kind: "parametric", graph: STACK_GRAPH }, interfaces: [...stackMounts.map((position, index) => semantic("mount", `stack-mount-${index + 1}`, position, { diameter: m(0.004), fastenerType: "M3" })), semantic("cable", "stack-power", [0.0228, 0, 0], { connector: "3-6S LiPo pads" })] },
  { ...common, id: "battery-6s-1550", category: "battery", manufacturer: "Tattu", partNumber: "TA-RL5-150C-1550-6S1P", provenance: provenance(["tattu"], [["package dimensions", "78 x 37 x 52", "mm", "tattu"], ["mass", 254, "g", "tattu"]], "Manufacturer tolerances are length +/-5 mm, width/height +/-2 mm, and mass +/-20 g."), mass: kg(0.254), massAccounting: "standalone", optimizationRole: "fixed-component", centerOfMass: point(0, 0, 0), anchor: anchor("package-center"), envelope: box("battery-envelope", [0, 0, 0], [0.078, 0.037, 0.052]), collisionVolumes: [box("battery-collision", [0, 0, 0], [0.078, 0.037, 0.052])], protectedVolumes: [box("keepout", [0, 0, 0], [0.084, 0.043, 0.058])], mountInterfaces: [], geometry: { kind: "parametric", graph: BATTERY_GRAPH }, interfaces: [semantic("cable", "battery-power", [0.039, 0, 0], { connector: "XT60" })] },
  { ...common, id: "fpv-camera", category: "avionics", manufacturer: "RunCam", partNumber: "Phoenix 2", provenance: provenance(["runcam"], [["housing dimensions", "19 x 19 x 20", "mm", "runcam"], ["mass", 9, "g", "runcam"], ["side fasteners", "M2", "thread", "runcam"]], "Housing and installation interfaces follow the manufacturer drawing; the display lens barrel is a bounded specification model."), mass: kg(0.009), massAccounting: "standalone", optimizationRole: "fixed-component", centerOfMass: point(0, 0, 0), anchor: anchor("housing-center"), envelope: box("camera-envelope", [0.006, 0, 0], [0.031, 0.020, 0.019]), collisionVolumes: [box("camera-collision", [0.006, 0, 0], [0.031, 0.020, 0.019])], protectedVolumes: [box("camera-keepout", [0.009, 0, 0], [0.040, 0.024, 0.023])], mountInterfaces: [mount("camera-mount-left", [0, -0.010, 0], 0.002, "M2"), mount("camera-mount-right", [0, 0.010, 0], 0.002, "M2")], geometry: { kind: "parametric", graph: CAMERA_GRAPH }, interfaces: [semantic("mount", "camera-mount-left", [0, -0.010, 0], { diameter: m(0.002), fastenerType: "M2" }), semantic("mount", "camera-mount-right", [0, 0.010, 0], { diameter: m(0.002), fastenerType: "M2" }), semantic("cable", "camera-power-video", [-0.010, 0, 0], { connector: "6-pin silicone cable" })] },
  { ...common, id: "fastener-m3x8", category: "fastener", manufacturer: "Accu", partNumber: "SSCF-M3-8-12.9-Z", provenance: provenance(["accu"], [["shank", "M3 x 8", "mm", "accu"], ["head", "5.68 x 3", "mm", "accu"], ["socket", "2.5 x 1.3", "mm", "accu"]], "Head diameter is +0/-0.36 mm and head height +0/-0.14 mm; thread uses its nominal envelope."), mass: kg(0.0008), massAccounting: "standalone", optimizationRole: "fixed-component", centerOfMass: point(0, 0, 0.0025), anchor: anchor("under-head-bearing-plane"), envelope: cylinder("fastener-envelope", [0, 0, 0.0025], 0.00284, 0.011), collisionVolumes: [cylinder("fastener-collision", [0, 0, 0.0025], 0.00284, 0.011)], protectedVolumes: [], mountInterfaces: [], geometry: { kind: "parametric", graph: FASTENER_GRAPH }, interfaces: [semantic("mate", "m3-thread", [0, 0, 0], { mating: "concentric", diameter: m(0.003) })] },
  { ...common, id: "motor-wiring-corridor", category: "wiring", manufacturer: "Sunderlabs", partNumber: "3x20AWG-MOTOR-ESC-HARNESS-REV3", provenance: provenance(["hobbywing", "speedybee"], [["motor leads", "3x 20AWG", "wire", "hobbywing"], ["published lead length", 150, "mm", "hobbywing"], ["assembly-qualified route", "72 x 6 x 4", "mm", "speedybee"]], "Repo-owned assembly derivative trims the published standalone lead to the installed route. Both endpoints are explicit and the original component provenance is retained."), mass: kg(0), massAccounting: "none", optimizationRole: "protected", centerOfMass: point(0, 0, 0), anchor: anchor("corridor-center"), envelope: box("wiring-envelope", [0, 0, 0], [0.072, 0.006, 0.004]), collisionVolumes: [box("wiring-collision", [0, 0, 0], [0.072, 0.006, 0.004])], protectedVolumes: [box("keepout", [0, 0, 0], [0.072, 0.006, 0.004])], mountInterfaces: [], geometry: { kind: "parametric", graph: WIRING_GRAPH }, interfaces: [semantic("cable", "motor-side", [0.036, 0, -0.004], { connector: "3x 20AWG soldered phase joint" }), semantic("cable", "esc-side", [-0.036, 0, 0], { connector: "3x ESC phase pads" })] },
  { ...common, id: "propeller-5x4.3x3", category: "propeller", manufacturer: "HQProp", partNumber: "HQ5X4.3X3V2S-PC", provenance: provenance(["hqprop"], [["diameter", 5, "in", "hqprop"], ["hub", "12.8 x 6.5", "mm", "hqprop"], ["shaft", 5, "mm", "hqprop"], ["blade count", 3, "count", "hqprop"]], "Published overall and hub dimensions; the display blade planform is bounded but illustrative."), mass: kg(0.0038), massAccounting: "standalone", optimizationRole: "protected", centerOfMass: point(0, 0, 0), anchor: anchor("hub-mid-plane"), envelope: cylinder("propeller-envelope", [0, 0, 0], 0.0635, 0.0065), collisionVolumes: [cylinder("propeller-collision", [0, 0, 0], 0.0635, 0.0065)], protectedVolumes: [cylinder("swept-volume", [0, 0, 0], 0.066, 0.0085)], mountInterfaces: [], geometry: { kind: "parametric", graph: PROPELLER_GRAPH }, interfaces: [semantic("mate", "propeller-shaft", [0, 0, 0], { mating: "concentric", diameter: m(0.005) })] },
  { ...common, id: "body-interface", category: "body-interface", manufacturer: "Sunderlabs", partNumber: "FRAME-INTERFACE-01", provenance: provenance(["body"], [["plate envelope", "28 x 38 x 6", "mm", "body"], ["mount spacing", 24, "mm", "body"]], "Reference drawing dimensions are exact for the foundation fixture."), mass: kg(0.018), massAccounting: "standalone", optimizationRole: "fixed-component", centerOfMass: point(0, 0, 0.003), anchor: anchor("body-origin"), envelope: box("body-interface-envelope", [0, 0, 0.003], [0.028, 0.038, 0.006]), collisionVolumes: [box("body-interface-collision", [0, 0, 0.003], [0.028, 0.038, 0.006])], protectedVolumes: [box("cable-keepout", [0.008, 0, 0.006], [0.014, 0.012, 0.012])], mountInterfaces: [mount("body-mount-north", [0, 0.012, 0.003], 0.0032), mount("body-mount-south", [0, -0.012, 0.003], 0.0032)], geometry: { kind: "parametric", graph: BODY_INTERFACE_GRAPH }, interfaces: [semantic("mount", "body-mount-north", [0, 0.012, 0.003], { diameter: m(0.0032), fastenerType: "M3" }), semantic("mount", "body-mount-south", [0, -0.012, 0.003], { diameter: m(0.0032), fastenerType: "M3" })] },
] as const;

export const REFERENCE_DRONE_CATALOG: readonly ComponentDefinition[] = Object.freeze(
  await Promise.all(definitions.map((definition) => defineComponent(definition))),
);

export function referenceComponent(id: string): ComponentDefinition {
  const component = REFERENCE_DRONE_CATALOG.find((candidate) => candidate.id === id);
  if (!component) throw new Error(`Reference drone component missing: ${id}`);
  return component;
}
