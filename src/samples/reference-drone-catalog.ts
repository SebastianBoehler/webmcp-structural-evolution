import type { ParametricGraph } from "../domain/component-model";

export type SiVector = readonly [number, number, number];
type OptimizationRole = "fixed-component" | "protected";
type Source = Readonly<{
  kind: "manufacturer-datasheet" | "manufacturer-product-page" | "supplier-specification" | "derived-constraint-input";
  title: string;
  url: string;
  accessedOn: "2026-08-26";
  redistribution: "specification-facts-only; no CAD redistributed";
}>;
type Volume = Readonly<{
  kind: "box" | "cylinder" | "swept-disc";
  center: SiVector;
  size?: SiVector;
  radius?: number;
  height?: number;
}>;
type Interface = Readonly<{
  id: string;
  kind: "mount" | "mate" | "cable";
  position: SiVector;
  diameter?: number;
  connector?: string;
}>;
export type ReferenceGeometry =
  | Readonly<{ kind: "parametric"; graph: ParametricGraph; display: Readonly<{ kind: "motor" | "fastener" }> }>
  | Readonly<{ kind: "stack"; boards: readonly StackBoard[]; boardGap: number; mountPitch: number }>
  | Readonly<{ kind: "box"; size: SiVector }>
  | Readonly<{ kind: "corridor"; size: SiVector }>
  | Readonly<{ kind: "swept-rotor"; radius: number; hubRadius: number; hubHeight: number; bladeCount: number }>;
type StackBoard = Readonly<{ id: "flight-controller" | "esc"; size: SiVector; mass: number }>;

export interface ReferenceDroneComponent {
  readonly id: string;
  readonly exactPart: string;
  readonly category: "motor" | "avionics" | "battery" | "fastener" | "wiring" | "propeller";
  readonly massKg: number;
  readonly massAccounting: "standalone" | "none";
  readonly optimizationRole: OptimizationRole;
  readonly anchor: Readonly<{ id: string; position: readonly [0, 0, 0] }>;
  readonly geometry: ReferenceGeometry;
  readonly collision: readonly Volume[];
  readonly interfaces: readonly Interface[];
  readonly protectedEnvelopes: readonly Volume[];
  readonly provenance: Readonly<{
    mode: "modeled-from-specification";
    sources: readonly Source[];
    dimensionalUncertainty: string;
    dimensionsUsed: readonly string[];
  }>;
}

const zeroOrientation = {
  roll: { value: 0, unit: "rad" as const },
  pitch: { value: 0, unit: "rad" as const },
  yaw: { value: 0, unit: "rad" as const },
};
const m = (value: number) => ({ value, unit: "m" as const });
const point = (x: number, y: number, z: number) => ({ x: m(x), y: m(y), z: m(z) });
const cylinder = (id: string, center: SiVector, radius: number, height: number) => ({
  kind: "cylinder" as const, id, center: point(...center), radius: m(radius), height: m(height), orientation: zeroOrientation,
});
const source = (kind: Source["kind"], title: string, url: string): Source => ({
  kind, title, url, accessedOn: "2026-08-26", redistribution: "specification-facts-only; no CAD redistributed",
});

const motorGraph: ParametricGraph = { nodes: [
  cylinder("motor-base", [0, 0, 0.0015], 0.012, 0.003),
  { kind: "named-interface", id: "motor-mount-interface", source: "motor-base" },
  cylinder("motor-stator", [0, 0, 0.0067], 0.01125, 0.0076),
  { kind: "union", id: "base-and-stator", left: "motor-mount-interface", right: "motor-stator" },
  cylinder("motor-bell", [0, 0, 0.0114], 0.014, 0.017),
  { kind: "union", id: "motor-body", left: "base-and-stator", right: "motor-bell" },
  cylinder("motor-shaft", [0, 0, 0.02585], 0.0025, 0.0121),
  { kind: "union", id: "motor-body-and-shaft", left: "motor-body", right: "motor-shaft" },
  cylinder("mount-hole-ne", [0.005657, 0.005657, 0.0015], 0.0015, 0.004),
  cylinder("mount-hole-nw", [-0.005657, 0.005657, 0.0015], 0.0015, 0.004),
  cylinder("mount-hole-sw", [-0.005657, -0.005657, 0.0015], 0.0015, 0.004),
  cylinder("mount-hole-se", [0.005657, -0.005657, 0.0015], 0.0015, 0.004),
  { kind: "subtraction", id: "motor-minus-mount-ne", left: "motor-body-and-shaft", right: "mount-hole-ne" },
  { kind: "subtraction", id: "motor-minus-mount-nw", left: "motor-minus-mount-ne", right: "mount-hole-nw" },
  { kind: "subtraction", id: "motor-minus-mount-sw", left: "motor-minus-mount-nw", right: "mount-hole-sw" },
  { kind: "subtraction", id: "motor-with-four-mount-holes", left: "motor-minus-mount-sw", right: "mount-hole-se" },
] };

const fastenerGraph: ParametricGraph = { nodes: [
  cylinder("m3-thread-envelope", [0, 0, 0.004], 0.0015, 0.008),
  cylinder("socket-head", [0, 0, -0.00145], 0.00284, 0.0031),
  { kind: "union", id: "m3x8-solid", left: "m3-thread-envelope", right: "socket-head" },
  { kind: "box", id: "socket-recess", center: point(0, 0, -0.0013), size: point(0.0025, 0.0025, 0.0014) },
  { kind: "subtraction", id: "m3x8-with-drive", left: "m3x8-solid", right: "socket-recess" },
] };

const hobbywing = source("manufacturer-datasheet", "Hobbywing XRotor 2207.5SL 1780KV specification", "https://www.hobbywing.com/en/uploads/file/20251117/feb50ba5342e53ce2431c20799f047d8.pdf");
const hobbywingProduct = source("manufacturer-product-page", "Hobbywing XRotor 2207.5 product page", "https://www.hobbywing.com/en/products/xrotor-22075");
const speedybee = source("manufacturer-product-page", "SpeedyBee F405 V4 BLS 55A 30x30 stack", "https://www.speedybee.com/speedybee-f405-v4-bls-55a-30x30-fc-esc-stack/");
const tattu = source("manufacturer-product-page", "Tattu R-Line V5 1550mAh 6S 150C", "https://www.genstattu.com/tattu-r-line-version-5-0-1550mah-6s-150c-22-2v-lipo-battery-pack-with-xt60-plug/");
const accu = source("supplier-specification", "Accu SSCF-M3-8-12.9-Z", "https://www.accu.co.uk/metric-cap-head-screws/386767-SSCF-M3-8-12-9-Z");
const hqprop = source("manufacturer-product-page", "HQProp HQ5X4.3X3V2S-PC", "https://www.hqprop.com/hq-freestyle-prop-5x43x3v2s-2cw2ccw-poly-carbonate-p0233.html");
const wiringMotorInput = source("derived-constraint-input", "Hobbywing motor-lead input to derived corridor", hobbywing.url);
const wiringStackInput = source("derived-constraint-input", "SpeedyBee connection input to derived corridor", speedybee.url);
const mountPoints = [[0.005657, 0.005657, 0], [-0.005657, 0.005657, 0], [-0.005657, -0.005657, 0], [0.005657, -0.005657, 0]] as const;
const stackMounts = [[0.01525, 0.01525, 0], [-0.01525, 0.01525, 0], [-0.01525, -0.01525, 0], [0.01525, -0.01525, 0]] as const;

export const REFERENCE_DRONE_CATALOG: readonly ReferenceDroneComponent[] = Object.freeze([
  { id: "motor-2207", exactPart: "Hobbywing XRotor-2207.5SL-1780KV", category: "motor", massKg: 0.038, massAccounting: "standalone", optimizationRole: "fixed-component", anchor: { id: "mount-plane", position: [0, 0, 0] },
    geometry: { kind: "parametric", graph: motorGraph, display: { kind: "motor" } },
    collision: [{ kind: "cylinder", center: [0, 0, 0.00995], radius: 0.014, height: 0.0199 }, { kind: "cylinder", center: [0, 0, 0.0259], radius: 0.0025, height: 0.012 }],
    interfaces: [...mountPoints.map((position, index) => ({ id: `motor-mount-${index + 1}`, kind: "mount" as const, position, diameter: 0.003 })), { id: "motor-phase-leads", kind: "cable", position: [0, 0, 0], connector: "3x 20AWG wire" }], protectedEnvelopes: [],
    provenance: { mode: "modeled-from-specification", sources: [hobbywing, hobbywingProduct], dimensionalUncertainty: "Published dimensions; unlisted bell/base contours modeled within the 28 mm x 19.9 mm envelope.", dimensionsUsed: ["motor diameter 28 mm", "body height 19.9 mm", "stator 22.5 x 7.6 mm", "shaft 5 x 12 mm", "4xM3 on 16 mm pitch circle"] } },
  { id: "fc-esc-stack-30x30", exactPart: "SpeedyBee F405 V4 + BLS 55A Stack, SB-F4V4-55-STACK", category: "avionics", massKg: 0.034, massAccounting: "standalone", optimizationRole: "fixed-component", anchor: { id: "stack-mid-plane", position: [0, 0, 0] },
    geometry: { kind: "stack", boards: [{ id: "flight-controller", size: [0.0416, 0.0394, 0.0078], mass: 0.0105 }, { id: "esc", size: [0.0456, 0.044, 0.008], mass: 0.0235 }], boardGap: 0.004, mountPitch: 0.0305 },
    collision: [{ kind: "box", center: [0, 0, 0], size: [0.0456, 0.044, 0.0198] }], interfaces: [...stackMounts.map((position, index) => ({ id: `stack-mount-${index + 1}`, kind: "mount" as const, position, diameter: 0.004 })), { id: "stack-power", kind: "cable", position: [0.0228, 0, 0], connector: "3-6S LiPo pads" }], protectedEnvelopes: [{ kind: "box", center: [0, 0, 0], size: [0.0516, 0.05, 0.0258] }],
    provenance: { mode: "modeled-from-specification", sources: [speedybee], dimensionalUncertainty: "Board dimensions and masses are published; 4 mm installed board gap is a conservative +/-2 mm assembly assumption.", dimensionsUsed: ["FC 41.6 x 39.4 x 7.8 mm", "ESC 45.6 x 44 x 8 mm", "30.5 mm square mount", "4 mm holes"] } },
  { id: "battery-6s-1550", exactPart: "Tattu TA-RL5-150C-1550-6S1P", category: "battery", massKg: 0.254, massAccounting: "standalone", optimizationRole: "fixed-component", anchor: { id: "package-center", position: [0, 0, 0] }, geometry: { kind: "box", size: [0.078, 0.037, 0.052] }, collision: [{ kind: "box", center: [0, 0, 0], size: [0.078, 0.037, 0.052] }], interfaces: [{ id: "battery-power", kind: "cable", position: [0.039, 0, 0], connector: "XT60" }], protectedEnvelopes: [{ kind: "box", center: [0, 0, 0], size: [0.084, 0.043, 0.058] }], provenance: { mode: "modeled-from-specification", sources: [tattu], dimensionalUncertainty: "Manufacturer tolerances: length +/-5 mm, width/height +/-2 mm, mass +/-20 g.", dimensionsUsed: ["78 x 37 x 52 mm package", "XT60 interface"] } },
  { id: "fastener-m3x8", exactPart: "Accu SSCF-M3-8-12.9-Z", category: "fastener", massKg: 0.0008, massAccounting: "standalone", optimizationRole: "fixed-component", anchor: { id: "under-head-bearing-plane", position: [0, 0, 0] }, geometry: { kind: "parametric", graph: fastenerGraph, display: { kind: "fastener" } }, collision: [{ kind: "cylinder", center: [0, 0, 0.0025], radius: 0.00284, height: 0.011 }], interfaces: [{ id: "m3-thread", kind: "mate", position: [0, 0, 0], diameter: 0.003 }], protectedEnvelopes: [], provenance: { mode: "modeled-from-specification", sources: [accu], dimensionalUncertainty: "Head diameter +0/-0.36 mm and head height +0/-0.14 mm; thread represented by its nominal envelope.", dimensionsUsed: ["M3 x 8 mm shank", "5.68 x 3 mm head", "2.5 x 1.3 mm socket"] } },
  { id: "motor-wiring-corridor", exactPart: "Reference 3x20AWG motor-lead routing corridor rev 1", category: "wiring", massKg: 0, massAccounting: "none", optimizationRole: "protected", anchor: { id: "corridor-center", position: [0, 0, 0] }, geometry: { kind: "corridor", size: [0.184, 0.006, 0.006] }, collision: [{ kind: "box", center: [0, 0, 0], size: [0.184, 0.006, 0.006] }], interfaces: [{ id: "wire-route", kind: "cable", position: [0, 0, 0], connector: "3x 20AWG motor leads" }], protectedEnvelopes: [{ kind: "box", center: [0, 0, 0], size: [0.184, 0.006, 0.006] }], provenance: { mode: "modeled-from-specification", sources: [wiringMotorInput, wiringStackInput], dimensionalUncertainty: "6 mm corridor is a conservative routing allowance around published 20AWG motor leads; the constraint has no independent physical mass.", dimensionsUsed: ["three 20AWG motor leads", "150 mm published lead length", "184 x 6 x 6 mm protected route assumption"] } },
  { id: "propeller-5x4.3x3", exactPart: "HQProp HQ5X4.3X3V2S-PC", category: "propeller", massKg: 0.0038, massAccounting: "standalone", optimizationRole: "protected", anchor: { id: "hub-mid-plane", position: [0, 0, 0] }, geometry: { kind: "swept-rotor", radius: 0.0635, hubRadius: 0.0064, hubHeight: 0.0065, bladeCount: 3 }, collision: [{ kind: "swept-disc", center: [0, 0, 0], radius: 0.0635, height: 0.0065 }], interfaces: [{ id: "propeller-shaft", kind: "mate", position: [0, 0, 0], diameter: 0.005 }], protectedEnvelopes: [{ kind: "swept-disc", center: [0, 0, 0], radius: 0.066, height: 0.0085 }], provenance: { mode: "modeled-from-specification", sources: [hqprop], dimensionalUncertainty: "Published overall and hub dimensions; blade planform is illustrative and the protected radius includes 2.5 mm clearance.", dimensionsUsed: ["5 inch diameter", "12.8 x 6.5 mm hub", "5 mm shaft", "3 blades"] } },
]);

export interface ReferenceDroneInstance { readonly id: string; readonly componentId: string; readonly position: SiVector; readonly yaw: number; readonly optimizationRole: OptimizationRole }
const motorCenters = [["motor-east", 0.105, 0], ["motor-north", 0, 0.105], ["motor-west", -0.105, 0], ["motor-south", 0, -0.105]] as const;
const motors: readonly ReferenceDroneInstance[] = motorCenters.map(([id, x, y]) => ({ id, componentId: "motor-2207", position: [x, y, 0.003], yaw: 0, optimizationRole: "fixed-component" }));
const props: readonly ReferenceDroneInstance[] = motorCenters.map(([id, x, y]) => ({ id: `${id}-propeller`, componentId: "propeller-5x4.3x3", position: [x, y, 0.02615], yaw: 0, optimizationRole: "protected" }));
const fasteners: readonly ReferenceDroneInstance[] = motorCenters.flatMap(([id, x, y]) => mountPoints.map(([dx, dy], index) => ({ id: `${id}-fastener-${index + 1}`, componentId: "fastener-m3x8", position: [x + dx, y + dy, 0.003], yaw: 0, optimizationRole: "fixed-component" })));
export const referenceDroneAssembly = Object.freeze({ id: "reference-5-inch-drone", units: "m" as const, anchorConvention: "instance-position-is-component-local-anchor" as const, instances: Object.freeze<readonly ReferenceDroneInstance[]>([
  ...motors, ...props, ...fasteners,
  { id: "fc-esc-stack", componentId: "fc-esc-stack-30x30", position: [0, 0, 0.015], yaw: 0, optimizationRole: "fixed-component" },
  { id: "battery", componentId: "battery-6s-1550", position: [0, 0, -0.032], yaw: 0, optimizationRole: "fixed-component" },
  { id: "wiring-east-west", componentId: "motor-wiring-corridor", position: [0, 0, 0.005], yaw: 0, optimizationRole: "protected" },
  { id: "wiring-north-south", componentId: "motor-wiring-corridor", position: [0, 0, 0.005], yaw: Math.PI / 2, optimizationRole: "protected" },
]) });
