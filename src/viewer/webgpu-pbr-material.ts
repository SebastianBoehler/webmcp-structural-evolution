import type * as THREE from "three";

import type {
  SemanticPbrMaterial,
  SemanticPbrMaterialFactory,
} from "./semantic-three-scene";

interface MultipliableNode {
  mul(value: unknown): unknown;
}

interface StandardNodeMaterial extends SemanticPbrMaterial {
  emissiveNode: unknown;
}

export interface WebGpuPbrRuntime {
  readonly createMaterial: (
    parameters: THREE.MeshStandardMaterialParameters,
  ) => StandardNodeMaterial;
  readonly materialColor: unknown;
  readonly instanceColor: unknown;
  readonly vertexColor: unknown;
}

function multiply(node: unknown, value: unknown): unknown {
  if (!node || typeof (node as Partial<MultipliableNode>).mul !== "function") {
    throw new Error("WebGPU node material runtime is missing a multiplicative color node.");
  }
  return (node as MultipliableNode).mul(value);
}

export function createWebGpuPbrMaterialFactory(
  runtime: WebGpuPbrRuntime,
): SemanticPbrMaterialFactory {
  return (role, parameters) => {
    const material = runtime.createMaterial(parameters);
    const fieldColor = role === "field"
      ? runtime.instanceColor
      : role === "field-surface" ? runtime.vertexColor : undefined;
    const base = fieldColor
      ? multiply(fieldColor, runtime.materialColor)
      : runtime.materialColor;
    material.emissiveNode = multiply(base, role === "surface" ? .45 : .7);
    material.userData.semanticPbrRole = role;
    return material;
  };
}
