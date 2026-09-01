import {
  renderPartsForAssembly,
  type AssemblyVisualRenderer,
} from "../../assembly/assembly-workspace-model";
import type { ComponentDefinition } from "../../domain/component-model";
import type { AssemblyMaterialToken, AssemblyVisualPart } from "../../viewer/render-envelope";
import { SE6_INSTANCE_GROUPS } from "./cobot-assembly";

const groupNames = {
  base: "base",
  shoulder: "shoulder",
  upperArm: "upper-arm",
  forearm: "forearm",
  wrist: "wrist",
  tooling: "tooling",
  services: "services",
} as const;

const semanticGroup = new Map<string, string>();
Object.entries(SE6_INSTANCE_GROUPS).forEach(([group, ids]) => ids.forEach((id) => {
  semanticGroup.set(id, groupNames[group as keyof typeof groupNames]);
}));

function materialFor(category: ComponentDefinition["category"]): AssemblyMaterialToken {
  if (category.endsWith("/joint") || category.endsWith("/interface")) return "joint";
  if (category.endsWith("/cover")) return "cover";
  if (category.endsWith("/fastener")) return "fastener";
  if (category.endsWith("/cable")) return "cable";
  if (category.endsWith("/tooling")) return "tooling";
  if (category.endsWith("/payload")) return "payload";
  return "structural";
}

const jointLabel: Readonly<Record<string, string>> = {
  "j1-turntable": "J1 base-yaw turntable",
  "j2-barrel": "J2 shoulder-pitch housing",
  "j3-barrel": "J3 elbow-pitch housing",
  "j4-roll-housing": "J4 forearm-roll housing",
  "j5-pitch-housing": "J5 wrist-pitch housing",
  "j6-tool-roll": "J6 tool-roll housing",
  "upper-arm-housing": "J2–J3 structural upper-arm housing",
  "calibration-payload": "Mounted 1.5 kg calibration payload",
};

const humanLabel = (id: string) => jointLabel[id] ?? id
  .replace(/^j([1-6])-/, "J$1 ")
  .replaceAll("-", " ")
  .replace(/^./, (letter) => letter.toUpperCase());

export const renderSe6Assembly: AssemblyVisualRenderer = (draft, catalog, resources) => {
  const instances = new Map(draft.components.map((instance) => [instance.instanceId, instance]));
  const parts = renderPartsForAssembly(draft, catalog, resources).map((part): AssemblyVisualPart => {
    if (part.appearance === "design-region") return {
      ...part,
      label: "SE-6 upper-arm topology domain",
      semanticGroup: "upper-arm",
    };
    if (part.appearance !== "component") return part;
    const instance = instances.get(part.selectionId);
    if (!instance) throw new Error(`SE-6 visual has no owning assembly instance: ${part.id}`);
    const definition = catalog.find(({ revision }) => revision === instance.componentRevision);
    if (!definition) throw new Error(`SE-6 visual component is absent: ${part.selectionId}`);
    const group = semanticGroup.get(part.selectionId);
    if (!group) throw new Error(`SE-6 visual has no semantic group: ${part.selectionId}`);
    return {
      ...part,
      label: humanLabel(part.selectionId),
      semanticGroup: group,
      material: materialFor(definition.category),
      movable: false,
    };
  });
  const represented = new Set(parts.filter(({ appearance }) => appearance === "component").map(({ selectionId }) => selectionId));
  const missing = [...instances.keys()].filter((id) => !represented.has(id));
  if (missing.length > 0) throw new Error(`SE-6 visual ownership is incomplete: ${missing.join(", ")}`);
  return Object.freeze(parts);
};
