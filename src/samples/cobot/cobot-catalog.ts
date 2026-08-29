import { defineComponent, type ComponentDefinition } from "../../domain/component-model";
import { boxVolumeMm, cylinderVolumeMm, kg, mm, mmPoint, orientationRad, qualifiedProvenance } from "./cobot-values";

interface PartSpec {
  readonly id: string;
  readonly category: string;
  readonly size: readonly [number, number, number] | readonly [number, number];
  readonly shape: "box" | "cylinder";
  readonly massKg: number;
}

const specs: readonly PartSpec[] = [
  { id: "base-plate", category: "robotics/structure", size: [260, 260, 18], shape: "box", massKg: 3 },
  { id: "base-fastener", category: "robotics/fastener", size: [8, 16], shape: "cylinder", massKg: 0.05 },
  { id: "pedestal", category: "robotics/structure", size: [90, 250], shape: "cylinder", massKg: 4.3 },
  { id: "turntable", category: "robotics/joint", size: [95, 50], shape: "cylinder", massKg: 1 },
  { id: "bearing-ring", category: "robotics/joint", size: [78, 20], shape: "cylinder", massKg: 0.3 },
  { id: "base-cover", category: "robotics/cover", size: [82, 18], shape: "cylinder", massKg: 0.2 },
  { id: "shoulder-yoke", category: "robotics/structure", size: [80, 34, 170], shape: "box", massKg: 1.2 },
  { id: "shoulder-joint", category: "robotics/joint", size: [85, 120], shape: "cylinder", massKg: 1.1 },
  { id: "shoulder-cap", category: "robotics/cover", size: [68, 18], shape: "cylinder", massKg: 0.2 },
  { id: "shoulder-fastener", category: "robotics/fastener", size: [10, 20], shape: "cylinder", massKg: 0.05 },
  { id: "shoulder-guard", category: "robotics/cover", size: [112, 16, 122], shape: "box", massKg: 0.2 },
  { id: "upper-boss", category: "robotics/interface", size: [68, 24], shape: "cylinder", massKg: 0.25 },
  { id: "upper-link", category: "robotics/design-member", size: [360, 90, 80], shape: "box", massKg: 0.8 },
  { id: "upper-fastener", category: "robotics/fastener", size: [8, 18], shape: "cylinder", massKg: 0.025 },
  { id: "elbow-joint", category: "robotics/joint", size: [72, 96], shape: "cylinder", massKg: 1 },
  { id: "elbow-cap", category: "robotics/cover", size: [58, 16], shape: "cylinder", massKg: 0.2 },
  { id: "elbow-guard", category: "robotics/cover", size: [104, 14, 110], shape: "box", massKg: 0.2 },
  { id: "forearm-shell", category: "robotics/structure", size: [292, 82, 74], shape: "box", massKg: 2.1 },
  { id: "forearm-cover", category: "robotics/cover", size: [220, 8, 34], shape: "box", massKg: 0.2 },
  { id: "cover-fastener", category: "robotics/fastener", size: [6, 12], shape: "cylinder", massKg: 0.1 },
  { id: "wrist-joint", category: "robotics/joint", size: [58, 68], shape: "cylinder", massKg: 0.4 },
  { id: "wrist-cap", category: "robotics/cover", size: [48, 14], shape: "cylinder", massKg: 0.15 },
  { id: "wrist-spacer", category: "robotics/interface", size: [40, 20], shape: "cylinder", massKg: 0.1 },
  { id: "tool-flange", category: "robotics/tooling", size: [40, 18], shape: "cylinder", massKg: 0.3 },
  { id: "gripper-body", category: "robotics/tooling", size: [130, 90, 70], shape: "box", massKg: 0.7 },
  { id: "gripper-jaw", category: "robotics/tooling", size: [90, 18, 20], shape: "box", massKg: 0.15 },
  { id: "finger-pad", category: "robotics/tooling", size: [28, 22, 16], shape: "box", massKg: 0.05 },
  { id: "calibration-payload", category: "robotics/payload", size: [100, 80, 60], shape: "box", massKg: 1.5 },
  { id: "cable-segment", category: "robotics/cable", size: [38, 8, 8], shape: "box", massKg: 0.15 },
  { id: "strain-relief", category: "robotics/cable", size: [12, 24], shape: "cylinder", massKg: 0.2 },
] as const;

async function component(spec: PartSpec): Promise<ComponentDefinition> {
  const envelope = spec.shape === "box"
    ? boxVolumeMm(`${spec.id}-envelope`, spec.size as readonly [number, number, number])
    : cylinderVolumeMm(`${spec.id}-envelope`, spec.size[0], spec.size[1]);
  const collision = spec.shape === "box"
    ? boxVolumeMm(`${spec.id}-collision`, (spec.size as readonly [number, number, number]).map((value) => value * 0.12) as [number, number, number])
    : cylinderVolumeMm(`${spec.id}-collision`, spec.size[0] * 0.12, spec.size[1] * 0.12);
  const graphNode = spec.shape === "box"
    ? { kind: "box" as const, id: `${spec.id}-body`, center: mmPoint(0, 0, 0), size: (envelope as Extract<typeof envelope, { kind: "box" }>).size }
    : { kind: "cylinder" as const, id: `${spec.id}-body`, center: mmPoint(0, 0, 0), radius: mm(spec.size[0]), height: mm(spec.size[1]), orientation: orientationRad() };
  const interfaces: ComponentDefinition["interfaces"][number][] = [
    { kind: "mate", id: "anchor", coordinates: "component-local", position: mmPoint(0, 0, 0), orientation: orientationRad(), mating: "concentric", diameter: mm(8) },
  ];
  if (spec.id === "upper-boss") interfaces.push(...[-45, 45].map((offset, index) => ({
    kind: "access" as const, id: `fastener-access-${index + 1}`, coordinates: "component-local" as const,
    position: mmPoint(0, offset, 0), orientation: orientationRad(),
    volume: cylinderVolumeMm(`fastener-access-volume-${index + 1}`, 5, 110, [0, offset, 0]),
  })));
  return defineComponent({
    id: `se6-${spec.id}`, category: spec.category, geometryCoordinates: "component-local",
    manufacturer: "Sunderlabs", partNumber: `SE6-${spec.id.toUpperCase()}`,
    provenance: qualifiedProvenance(`SE-6 ${spec.id} design`, "nominal mass", spec.massKg, "kg"),
    mass: kg(spec.massKg), massAccounting: "standalone", optimizationRole: "fixed-component",
    centerOfMass: mmPoint(0, 0, 0),
    anchor: { id: "anchor", coordinates: "component-local", position: mmPoint(0, 0, 0) },
    envelope, collisionVolumes: [collision], protectedVolumes: [],
    mountInterfaces: [{ id: "mount", position: mmPoint(0, 0, 0), orientation: orientationRad(), diameter: mm(8), fastenerType: "SE-6 qualified interface" }],
    loadContributions: [], allowedOrientations: [orientationRad()],
    geometry: { kind: "parametric", graph: { nodes: [graphNode] } },
    interfaces,
  });
}

export const SE6_CATALOG = Object.freeze(await Promise.all(specs.map(component)));

export function se6Component(id: string): ComponentDefinition {
  const result = SE6_CATALOG.find((candidate) => candidate.id === `se6-${id}`);
  if (!result) throw new Error(`Unknown SE-6 component: ${id}`);
  return result;
}
