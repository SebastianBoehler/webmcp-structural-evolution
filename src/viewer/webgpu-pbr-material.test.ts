import * as THREE from "three";
import { instanceColor } from "three/src/nodes/accessors/Instance.js";
import { materialColor, vertexColor } from "three/tsl";
import { MeshStandardNodeMaterial } from "three/webgpu";
import { expect, it } from "vitest";

import { addSemanticScene } from "./semantic-three-scene";
import { createWebGpuPbrMaterialFactory } from "./webgpu-pbr-material";
import type { SemanticRenderState } from "./webgpu-renderer-types";

const document = { revision: "pbr", frame: { lengthUnit: "mm" as const,
  angleUnit: "radian" as const }, nodes: [
  { id: "assembly:test", kind: "assembly" as const },
  { id: "component:test", kind: "component" as const, parentId: "assembly:test" },
  { id: "body:test", kind: "body" as const, parentId: "component:test" },
  { id: "feature:test", kind: "feature" as const, parentId: "body:test" },
  { id: "face:test", kind: "face" as const, parentId: "feature:test", geometry: {
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    material: { appearance: "component" as const, token: "joint" as const, color: 0x303947 },
  } },
] };

it("uses emissive-capable standard node PBR for legible materials and nonuniform thermal cells", () => {
  const scene = new THREE.Scene();
  const state: SemanticRenderState = {
    revision: "pbr", document, selection: undefined, measurements: [],
    resultLayers: { temperature: {
      dimensions: [2, 1, 1], cellSize: [1, 1, 1], origin: [0, 0, 0],
      active: new Uint8Array([1, 1]),
      values: new Float32Array([300, 400]), maximum: 400,
    } },
  };
  const pbr = createWebGpuPbrMaterialFactory({
    createMaterial: (parameters) => new MeshStandardNodeMaterial(parameters),
    materialColor, instanceColor, vertexColor: vertexColor(),
  });
  addSemanticScene(THREE, scene, state, false, pbr);

  const primitive = scene.getObjectByName("semantic:face:test")?.children
    .find((child) => child instanceof THREE.Mesh) as THREE.Mesh;
  const primitiveMaterial = primitive.material as MeshStandardNodeMaterial;
  const field = scene.getObjectByProperty("isInstancedMesh", true) as THREE.InstancedMesh;
  const fieldMaterial = field.material as MeshStandardNodeMaterial;
  const first = new THREE.Color();
  const second = new THREE.Color();
  field.getColorAt(0, first);
  field.getColorAt(1, second);

  expect(primitiveMaterial.isMeshStandardNodeMaterial).toBe(true);
  expect(primitiveMaterial.color.getHex()).toBe(0x303947);
  expect(primitiveMaterial.emissiveNode).toBeTruthy();
  expect(primitiveMaterial.lightsNode).toBeNull();
  expect(fieldMaterial.isMeshStandardNodeMaterial).toBe(true);
  expect(fieldMaterial.emissiveNode).toBeTruthy();
  expect(fieldMaterial.lightsNode).toBeNull();
  expect(scene.children.some((child) => "isLight" in child)).toBe(false);
  expect(first.getHex()).not.toBe(0x000000);
  expect(second.getHex()).not.toBe(0x000000);
  expect(first.getHex()).not.toBe(second.getHex());
});

it("uses vertex-colored node PBR for the smooth production topology surface", () => {
  const scene = new THREE.Scene();
  const pbr = createWebGpuPbrMaterialFactory({
    createMaterial: (parameters) => new MeshStandardNodeMaterial(parameters),
    materialColor, instanceColor, vertexColor: vertexColor(),
  });
  addSemanticScene(THREE, scene, {
    revision: "pbr", document, selection: undefined, measurements: [],
    resultLayers: {
      topology: {
        dimensions: [2, 1, 1], cellSize: [1, 1, 1], origin: [0, 0, 0],
        active: new Uint8Array([1, 0]), density: new Float32Array([1, 0]),
      },
      stress: {
        dimensions: [2, 1, 1], cellSize: [1, 1, 1], origin: [0, 0, 0],
        active: new Uint8Array([1, 0]), values: new Float32Array([10, 0]), maximum: 10,
      },
    },
  }, false, pbr);

  const surface = scene.getObjectByName("verified-topology-surface") as THREE.Mesh;
  const material = surface.material as MeshStandardNodeMaterial;
  expect(scene.getObjectByName("semantic-result-field")).toBeUndefined();
  expect(material.userData.semanticPbrRole).toBe("field-surface");
  expect(material.emissiveNode).toBeTruthy();
  expect(surface.geometry.getAttribute("color").count).toBeGreaterThan(0);
});

it("wires instance, vertex, and plain emissive colors to their semantic roles", () => {
  const pbr = createWebGpuPbrMaterialFactory({
    createMaterial: (parameters) => new MeshStandardNodeMaterial(parameters),
    materialColor, instanceColor, vertexColor: vertexColor(),
  });
  const nodeTypes = (role: "field" | "field-surface" | "surface") => {
    const material = pbr(role, {}) as MeshStandardNodeMaterial;
    const graph = material.emissiveNode?.toJSON() as {
      readonly nodes?: readonly { readonly type: string }[];
    };
    return graph.nodes?.map((node) => node.type) ?? [];
  };

  expect(nodeTypes("field")).toContain("PropertyNode");
  expect(nodeTypes("field")).not.toContain("VertexColorNode");
  expect(nodeTypes("field-surface")).toContain("VertexColorNode");
  expect(nodeTypes("field-surface")).not.toContain("PropertyNode");
  expect(nodeTypes("surface")).not.toContain("VertexColorNode");
  expect(nodeTypes("surface")).not.toContain("PropertyNode");
});
