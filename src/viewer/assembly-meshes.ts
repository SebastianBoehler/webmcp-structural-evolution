import * as THREE from "three";

import type { AssemblyVisualPart } from "./render-envelope";

interface MeshOwnership {
  own(release: () => void): void;
  attach(object: THREE.Object3D): void;
}

export interface AssemblyMeshSet {
  readonly meshes: readonly THREE.Mesh[];
  readonly materials: ReadonlyMap<string, readonly THREE.MeshStandardMaterial[]>;
}

export function selectableAssemblyMeshes(
  meshes: readonly THREE.Mesh[],
): readonly THREE.Mesh[] {
  return meshes.filter((mesh) => mesh.userData.appearance === "component");
}

const appearance = {
  component: { color: 0x687386, opacity: 1, wireframe: false },
  "design-region": { color: 0x487aa8, opacity: 0.18, wireframe: true },
  constraint: { color: 0xd98b5f, opacity: 0.16, wireframe: true },
} as const;

function geometryFor(part: AssemblyVisualPart): THREE.BufferGeometry {
  if (part.kind === "box") return new THREE.BoxGeometry(...part.size);
  const geometry = new THREE.CylinderGeometry(part.radius, part.radius, part.height, 48);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

export function createAssemblyMeshes(
  parts: readonly AssemblyVisualPart[],
  ownership: MeshOwnership,
): AssemblyMeshSet {
  const meshes: THREE.Mesh[] = [];
  const materials = new Map<string, THREE.MeshStandardMaterial[]>();
  for (const part of parts) {
    const geometry = geometryFor(part);
    ownership.own(() => geometry.dispose());
    const style = appearance[part.appearance];
    const material = new THREE.MeshStandardMaterial({
      color: style.color,
      metalness: part.appearance === "component" ? 0.24 : 0,
      opacity: style.opacity,
      roughness: 0.58,
      transparent: style.opacity < 1,
      wireframe: style.wireframe,
    });
    ownership.own(() => material.dispose());
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `assembly-part:${part.id}`;
    mesh.userData.partId = part.selectionId;
    mesh.userData.appearance = part.appearance;
    mesh.position.set(...part.center);
    mesh.renderOrder = part.appearance === "component" ? 0 : 3;
    ownership.attach(mesh);
    meshes.push(mesh);
    materials.set(part.selectionId, [...(materials.get(part.selectionId) ?? []), material]);
  }
  return { meshes: Object.freeze(meshes), materials };
}

export function highlightAssemblyPart(
  materials: ReadonlyMap<string, readonly THREE.MeshStandardMaterial[]>,
  selectedPart: string | undefined,
): void {
  for (const [partId, partMaterials] of materials) {
    const selected = partId === selectedPart;
    for (const material of partMaterials) {
      material.emissive.setHex(selected ? 0x19465f : 0x000000);
      material.emissiveIntensity = selected ? 0.9 : 0;
      material.needsUpdate = true;
    }
  }
}
