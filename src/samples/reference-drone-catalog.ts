import { defineComponent, type ComponentDefinition } from "../domain/component-model";
import {
  BATTERY_GRAPH,
  BATTERY_HARNESS_GRAPH,
  BATTERY_STRAP_GRAPH,
  BODY_INTERFACE_GRAPH,
  CAMERA_GRAPH,
  FASTENER_GRAPH,
  MOTOR_GRAPH,
  OPEN_ESC_GRAPH,
  OPEN_FC_GRAPH,
  PROPELLER_GRAPH,
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
  redistribution: "redistributable" | "facts-only" = "facts-only",
) => ({ id, classification, title, reference, sourceTimestamp, accessedOn: "2026-08-26" as const, redistribution });
const sources = {
  hobbywing: source("hobbywing-datasheet", "manufacturer-datasheet", "Hobbywing XRotor 2207.5SL 1780KV specification", "https://www.hobbywing.com/en/uploads/file/20251117/feb50ba5342e53ce2431c20799f047d8.pdf", "2025-11-17"),
  hobbywingProduct: source("hobbywing-product", "manufacturer-product-page", "Hobbywing XRotor 2207.5 product page", "https://www.hobbywing.com/en/products/xrotor-22075"),
  hobbywingCad: source("hobbywing-cad", "engineering-drawing", "Hobbywing XRotor 2207.5SL 1780KV CAD dimension figure", "https://www.hobbywing.com/en/uploads/file/20250820/48818bb82bed0f0947b5c99cc34b1000.pdf", "2025-08-20"),
  openFcRelease: source("openfc-lite-rev3.3-step", "engineering-drawing", "OpenFC-Lite rev3.3 release STEP", "https://github.com/OpenDrone-hw/OpenFC-Lite/releases/tag/rev3.3", "2026-08-25", "redistributable"),
  openFcProduct: source("openfc-lite-product", "manufacturer-product-page", "OpenFC-Lite 30x30 open-hardware specification", "https://opendrone.be/products/openfc-lite", "2026-08-25", "redistributable"),
  openEscRelease: source("openesc-30x30-rev3.3-step", "engineering-drawing", "OpenESC-30x30 rev3.3 release STEP", "https://github.com/OpenDrone-hw/OpenESC-30x30/releases/tag/rev3.3", "2026-08-25", "redistributable"),
  openEscProduct: source("openesc-30x30-product", "manufacturer-product-page", "OpenESC-30x30 open-hardware specification", "https://github.com/OpenDrone-hw/OpenESC-30x30/tree/rev3.3", "2026-08-25", "redistributable"),
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
const openHardwareProvenance = (
  sourceKeys: readonly SourceKey[],
  observations: readonly (readonly [string, number | string, string, SourceKey])[],
  uncertainty: string,
) => ({
  mode: "sourced-asset" as const,
  licence: { status: "redistributable" as const, reference: "https://ohwr.org/cern_ohl_s_v2.txt" },
  uncertainty: [{ property: "mass", statement: uncertainty }],
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
  { ...common, id: "motor-2207", category: "motor", manufacturer: "Hobbywing", partNumber: "XRotor-2207.5SL-1780KV", provenance: provenance(["hobbywing", "hobbywingProduct", "hobbywingCad"], [["motor diameter", 28, "mm", "hobbywing"], ["body height", 19.9, "mm", "hobbywing"], ["stator", "22.5 x 7.6", "mm", "hobbywing"], ["shaft", "5 x 12", "mm", "hobbywing"], ["mount pattern", "4 x M3 at diameter 16", "mm", "hobbywingCad"]], "Published dimensions and official dimension figure; external winding, vent, and lead details are a bounded specification reconstruction rather than a manufacturer B-rep. The display pigtail is trimmed to the declared assembly cable endpoint."), mass: kg(0.038), massAccounting: "standalone", optimizationRole: "fixed-component", centerOfMass: point(0, 0, 0.00995), anchor: anchor("mount-plane"), envelope: cylinder("motor-envelope", [0, 0, 0.01595], 0.014, 0.0319), collisionVolumes: [cylinder("motor-body-collision", [0, 0, 0.00995], 0.014, 0.0199), cylinder("motor-shaft-collision", [0, 0, 0.02585], 0.0025, 0.0121)], protectedVolumes: [], mountInterfaces: mountPoints.map((position, index) => mount(`motor-mount-${index + 1}`, position, 0.003)), geometry: { kind: "parametric", graph: MOTOR_GRAPH }, interfaces: [...mountPoints.map((position, index) => semantic("mount", `motor-mount-${index + 1}`, position, { diameter: m(0.003), fastenerType: "M3" })), semantic("mate", "propeller-shaft-seat", [0, 0, 0.02315], { mating: "concentric", diameter: m(0.005) }), semantic("cable", "motor-phase-leads", [-0.012, 0, 0.001], { connector: "3x 20AWG soldered phase joint" })], loadContributions: [{ id: "motor-thrust-load", force: { x: { value: 0, unit: "N" }, y: { value: 0, unit: "N" }, z: { value: -18, unit: "N" } } }] },
  { ...common, id: "flight-controller-30x30", category: "avionics", manufacturer: "OpenDrone / Incutec", partNumber: "OpenFC-Lite-30x30-rev3.3", provenance: openHardwareProvenance(["openFcRelease", "openFcProduct"], [["STEP SHA-256", "ac8cb93a42d54cff67e15b6442b4eb74c003015a06e943cb0222cc981303669d", "digest", "openFcRelease"], ["board dimensions", "37.942302 x 37.942302 x 5.38", "mm", "openFcRelease"], ["mount pitch", 30.5, "mm", "openFcProduct"], ["mount holes", 4, "mm", "openFcProduct"], ["PCB", "6-layer x 1.6", "mm", "openFcProduct"]], "The manufacturer does not publish assembled mass; 17 g is a conservative assembly mass budget and must be replaced by a measured production-board value."), mass: kg(0.017), massAccounting: "standalone", optimizationRole: "fixed-component", centerOfMass: point(0, 0, 0), anchor: anchor("openfc-step-center"), envelope: box("openfc-envelope", [0, 0, 0], [0.037942302, 0.037942302, 0.00538]), collisionVolumes: [box("openfc-collision", [0, 0, 0], [0.037942302, 0.037942302, 0.00538])], protectedVolumes: [box("openfc-keepout", [0, 0, 0], [0.043942302, 0.043942302, 0.00938])], mountInterfaces: stackMounts.map((position, index) => mount(`openfc-mount-${index + 1}`, position, 0.004)), geometry: { kind: "parametric", graph: OPEN_FC_GRAPH }, interfaces: [...stackMounts.map((position, index) => semantic("mount", `openfc-mount-${index + 1}`, position, { diameter: m(0.004), fastenerType: "M3" })), semantic("cable", "openfc-to-esc", [0, 0, -0.00269], { connector: "JST-SH 8-pin" }), semantic("cable", "openfc-usb-c", [0.018971, 0, 0], { connector: "USB-C" })] },
  { ...common, id: "esc-30x30", category: "avionics", manufacturer: "OpenDrone / Incutec", partNumber: "OpenESC-30x30-rev3.3", provenance: openHardwareProvenance(["openEscRelease", "openEscProduct"], [["STEP SHA-256", "dadded39478f0c7525d3b89722fa7fa57fb794cea374832f197d407bee34e6e3", "digest", "openEscRelease"], ["board dimensions", "41.627060 x 42.504999 x 6.33", "mm", "openEscRelease"], ["mount pitch", 30.5, "mm", "openEscProduct"], ["mount holes", 4, "mm", "openEscProduct"], ["PCB", "6-layer x 1.6", "mm", "openEscProduct"]], "The manufacturer does not publish assembled mass; 17 g is a conservative assembly mass budget and must be replaced by a measured production-board value."), mass: kg(0.017), massAccounting: "standalone", optimizationRole: "fixed-component", centerOfMass: point(0, 0, 0), anchor: anchor("openesc-step-center"), envelope: box("openesc-envelope", [0, 0, 0], [0.04162706, 0.042504999, 0.00633]), collisionVolumes: [box("openesc-collision", [0, 0, 0], [0.04162706, 0.042504999, 0.00633])], protectedVolumes: [box("openesc-keepout", [0, 0, 0], [0.04762706, 0.048504999, 0.01033])], mountInterfaces: stackMounts.map((position, index) => mount(`openesc-mount-${index + 1}`, position, 0.004)), geometry: { kind: "parametric", graph: OPEN_ESC_GRAPH }, interfaces: [...stackMounts.map((position, index) => semantic("mount", `openesc-mount-${index + 1}`, position, { diameter: m(0.004), fastenerType: "M3" })), semantic("cable", "openesc-to-fc", [0, 0, 0.003165], { connector: "JST-SH 8-pin" }), semantic("cable", "motor-east-phases", [0.021, 0, -0.003165], { connector: "3x ESC phase pads" }), semantic("cable", "motor-north-phases", [0, 0.021, -0.003165], { connector: "3x ESC phase pads" }), semantic("cable", "motor-west-phases", [-0.021, 0, -0.003165], { connector: "3x ESC phase pads" }), semantic("cable", "motor-south-phases", [0, -0.021, -0.003165], { connector: "3x ESC phase pads" }), semantic("cable", "battery-power", [0.0208, -0.012, -0.003165], { connector: "3-8S LiPo pads" })] },
  { ...common, id: "battery-6s-1550", category: "battery", manufacturer: "Tattu", partNumber: "TA-RL5-150C-1550-6S1P", provenance: provenance(["tattu"], [["package dimensions", "78 x 37 x 52", "mm", "tattu"], ["mass", 254, "g", "tattu"], ["discharge lead", "45 mm 12AWG XT60", "assembly", "tattu"]], "Manufacturer tolerances are length +/-5 mm, width/height +/-2 mm, and mass +/-20 g. Connector display position is reconstructed from the published 45 mm lead length."), mass: kg(0.254), massAccounting: "standalone", optimizationRole: "fixed-component", centerOfMass: point(0, 0, 0), anchor: anchor("package-center"), envelope: box("battery-envelope", [0, 0, 0], [0.078, 0.037, 0.052]), collisionVolumes: [box("battery-collision", [0, 0, 0], [0.078, 0.037, 0.052])], protectedVolumes: [box("keepout", [0, 0, 0], [0.084, 0.043, 0.058])], mountInterfaces: [], geometry: { kind: "parametric", graph: BATTERY_GRAPH }, interfaces: [semantic("cable", "battery-power", [0.078, 0, 0.014], { connector: "XT60 female" })] },
  { ...common, id: "battery-retention-strap", category: "retention", manufacturer: "Sunderlabs", partNumber: "FPV-BATTERY-STRAP-20X250-REV2", provenance: provenance(["body"], [["webbing width", 20, "mm", "body"], ["installed loop envelope", "20 x 43 x 61", "mm", "body"], ["frame pass-through", "two 22 x 3.5 mm slots", "assembly", "body"], ["installed mass", 6, "g", "body"]], "The installed loop encloses both battery and frame deck; its side webs pass through reserved deck slots. Production strap tensile rating requires supplier qualification."), mass: kg(0.006), massAccounting: "standalone", optimizationRole: "protected", centerOfMass: point(0, 0, 0.001875), anchor: anchor("loop-center"), envelope: box("strap-envelope", [0, 0, 0.001875], [0.022, 0.045, 0.061]), collisionVolumes: [box("strap-top", [0, 0, 0.0305], [0.020, 0.043, 0.0015]), box("strap-bottom", [0, 0, -0.02675], [0.020, 0.043, 0.0015]), box("strap-left", [0, -0.0215, 0.001875], [0.020, 0.0015, 0.05725]), box("strap-right", [0, 0.0215, 0.001875], [0.020, 0.0015, 0.05725])], protectedVolumes: [box("strap-top-clearance", [0, 0, 0.0305], [0.022, 0.045, 0.0035]), box("strap-bottom-clearance", [0, 0, -0.02675], [0.022, 0.045, 0.0035]), box("strap-left-clearance", [0, -0.0215, 0.001875], [0.022, 0.0035, 0.05925]), box("strap-right-clearance", [0, 0.0215, 0.001875], [0.022, 0.0035, 0.05925])], mountInterfaces: [], geometry: { kind: "parametric", graph: BATTERY_STRAP_GRAPH }, interfaces: [semantic("mate", "frame-slot-left", [0, -0.0215, 0.0305], { mating: "planar" }), semantic("mate", "frame-slot-right", [0, 0.0215, 0.0305], { mating: "planar" })] },
  { ...common, id: "battery-power-harness", category: "wiring", manufacturer: "Sunderlabs", partNumber: "XT60-12AWG-OPENESC-REV3", provenance: provenance(["tattu", "body"], [["battery connector", "XT60 female", "interface", "tattu"], ["installed route", "underside perimeter with outboard east-edge riser", "assembly", "body"], ["installed mass budget", 8, "g", "body"]], "Assembly-qualified route remains below the frame, clears the forward strap, and rises outside the OpenESC envelope; wire bend radii and ESC solder termination require production inspection."), mass: kg(0.008), massAccounting: "standalone", optimizationRole: "protected", centerOfMass: point(0, 0, 0), anchor: anchor("route-center"), envelope: box("battery-harness-envelope", [0, -0.005, -0.003], [0.060, 0.020, 0.036]), collisionVolumes: [box("battery-harness-plug", [0.022, 0.005238, -0.014], [0.014, 0.012, 0.010]), box("battery-harness-horizontal", [0.0079, -0.005, -0.014], [0.040, 0.009, 0.007]), box("battery-harness-riser", [-0.012, -0.005, -0.0036], [0.008, 0.009, 0.0208]), box("battery-harness-esc-tail", [-0.020, -0.005, 0.0088], [0.018, 0.009, 0.004])], protectedVolumes: [box("battery-harness-plug-keepout", [0.022, 0.005238, -0.014], [0.014, 0.012, 0.010]), box("battery-harness-horizontal-keepout", [0.0079, -0.005, -0.014], [0.040, 0.009, 0.007]), box("battery-harness-riser-keepout", [-0.012, -0.005, -0.0036], [0.008, 0.009, 0.0208]), box("battery-harness-esc-tail-keepout", [-0.020, -0.005, 0.0088], [0.018, 0.009, 0.004])], mountInterfaces: [], geometry: { kind: "parametric", graph: BATTERY_HARNESS_GRAPH }, interfaces: [semantic("cable", "battery-side", [0.027838, 0.005238, -0.014], { connector: "XT60 male" }), semantic("cable", "esc-side", [-0.027838, -0.005238, 0.010835], { connector: "3-8S LiPo underside pads" })] },
  { ...common, id: "fpv-camera", category: "avionics", manufacturer: "RunCam", partNumber: "Phoenix 2", provenance: provenance(["runcam"], [["housing dimensions", "19 x 19 x 20", "mm", "runcam"], ["mass", 9, "g", "runcam"], ["side fasteners", "M2", "thread", "runcam"]], "Housing and installation interfaces follow the manufacturer drawing; the display lens barrel is a bounded specification model."), mass: kg(0.009), massAccounting: "standalone", optimizationRole: "fixed-component", centerOfMass: point(0, 0, 0), anchor: anchor("housing-center"), envelope: box("camera-envelope", [0.006, 0, 0], [0.031, 0.020, 0.019]), collisionVolumes: [box("camera-collision", [0.006, 0, 0], [0.031, 0.020, 0.019])], protectedVolumes: [box("camera-keepout", [0.009, 0, 0], [0.040, 0.024, 0.023])], mountInterfaces: [mount("camera-mount-left", [0, -0.010, 0], 0.002, "M2"), mount("camera-mount-right", [0, 0.010, 0], 0.002, "M2")], geometry: { kind: "parametric", graph: CAMERA_GRAPH }, interfaces: [semantic("mount", "camera-mount-left", [0, -0.010, 0], { diameter: m(0.002), fastenerType: "M2" }), semantic("mount", "camera-mount-right", [0, 0.010, 0], { diameter: m(0.002), fastenerType: "M2" }), semantic("cable", "camera-power-video", [-0.010, 0, 0], { connector: "6-pin silicone cable" })] },
  { ...common, id: "fastener-m3x8", category: "fastener", manufacturer: "Accu", partNumber: "SSCF-M3-8-12.9-Z", provenance: provenance(["accu"], [["shank", "M3 x 8", "mm", "accu"], ["head", "5.68 x 3", "mm", "accu"], ["socket", "2.5 x 1.3", "mm", "accu"]], "Head diameter is +0/-0.36 mm and head height +0/-0.14 mm; thread uses its nominal envelope."), mass: kg(0.0008), massAccounting: "standalone", optimizationRole: "fixed-component", centerOfMass: point(0, 0, 0.0025), anchor: anchor("under-head-bearing-plane"), envelope: cylinder("fastener-envelope", [0, 0, 0.0025], 0.00284, 0.011), collisionVolumes: [cylinder("fastener-collision", [0, 0, 0.0025], 0.00284, 0.011)], protectedVolumes: [], mountInterfaces: [], geometry: { kind: "parametric", graph: FASTENER_GRAPH }, interfaces: [semantic("mate", "m3-thread", [0, 0, 0], { mating: "concentric", diameter: m(0.003) })] },
  { ...common, id: "motor-wiring-corridor", category: "wiring", manufacturer: "Sunderlabs", partNumber: "3x20AWG-MOTOR-ESC-HARNESS-REV4", provenance: provenance(["hobbywing", "openEscProduct", "body"], [["motor leads", "3x 20AWG", "wire", "hobbywing"], ["published lead length", 150, "mm", "hobbywing"], ["ESC termination", "3x underside phase pads", "interface", "openEscProduct"], ["assembly-qualified route", "72 x 6 x 2.8", "mm", "body"]], "Repo-owned assembly derivative trims the published standalone lead to a protected underside channel and terminates on the OpenESC underside plane."), mass: kg(0), massAccounting: "none", optimizationRole: "protected", centerOfMass: point(0, 0, -0.00258), anchor: anchor("corridor-center"), envelope: box("wiring-envelope", [0, 0, -0.00258], [0.072, 0.006, 0.0028]), collisionVolumes: [box("wiring-collision", [0, 0, -0.00258], [0.072, 0.006, 0.0028])], protectedVolumes: [box("keepout", [0, 0, -0.00258], [0.072, 0.006, 0.0028])], mountInterfaces: [], geometry: { kind: "parametric", graph: WIRING_GRAPH }, interfaces: [semantic("cable", "motor-side", [0.036, 0, -0.004], { connector: "3x 20AWG soldered phase joint" }), semantic("cable", "esc-side", [-0.036, 0, -0.001165], { connector: "3x ESC underside phase pads" })] },
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
