import type { AssemblyMaterialToken, AssemblyVisualPart } from "./render-model-types";

export type AssemblyAppearance = AssemblyVisualPart["appearance"];

export interface AssemblyMaterialMetadata {
  readonly appearance: AssemblyAppearance;
  readonly token?: AssemblyMaterialToken;
  readonly color?: number;
  readonly metalness?: number;
  readonly opacity?: number;
}

export interface AssemblyMaterialProperties {
  readonly color: number;
  readonly metalness: number;
  readonly roughness: number;
  readonly opacity: number;
  readonly transparent: boolean;
  readonly wireframe: boolean;
}

const appearance = {
  component: { color: 0x687386, opacity: 1, wireframe: false },
  generated: { color: 0x1688c9, opacity: 1, wireframe: false },
  "design-region": { color: 0x487aa8, opacity: 0.18, wireframe: true },
  constraint: { color: 0xd98b5f, opacity: 0.16, wireframe: true },
} as const;

const semanticMaterial = {
  structural: { color: 0xdfe8ef, metalness: 0.28, roughness: 0.4 },
  joint: { color: 0x52687a, metalness: 0.58, roughness: 0.3 },
  cover: { color: 0x168fc2, metalness: 0.18, roughness: 0.46 },
  fastener: { color: 0x9aa3ad, metalness: 0.92, roughness: 0.22 },
  cable: { color: 0xf07836, metalness: 0.02, roughness: 0.68 },
  tooling: { color: 0x7b8792, metalness: 0.5, roughness: 0.34 },
  payload: { color: 0xd7a94a, metalness: 0.16, roughness: 0.52 },
} as const;

export function assemblyMaterialProperties(
  metadata: AssemblyMaterialMetadata,
): AssemblyMaterialProperties {
  const style = appearance[metadata.appearance];
  const semantic = metadata.token ? semanticMaterial[metadata.token] : undefined;
  const opacity = metadata.opacity ?? style.opacity;
  return {
    color: metadata.color ?? semantic?.color ?? style.color,
    metalness: metadata.metalness ?? semantic?.metalness
      ?? (metadata.appearance === "component" ? 0.24 : 0),
    roughness: semantic?.roughness ?? 0.52,
    opacity,
    transparent: opacity < 1,
    wireframe: style.wireframe,
  };
}
