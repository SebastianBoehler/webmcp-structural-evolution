import * as THREE from "three";

import { geometryPieces } from "./assembly-geometries";
import type { AssemblyVisualPart } from "./render-envelope";

interface MeshOwnership {
  own(release: () => void): void;
  attach(object: THREE.Object3D): void;
}

export interface AssemblyMeshSet {
  readonly meshes: THREE.Mesh[];
  readonly materials: ReadonlyMap<string, readonly THREE.MeshStandardMaterial[]>;
  readonly roots: ReadonlyMap<string, THREE.Group>;
  readonly parts: ReadonlyMap<string, AssemblyVisualPart>;
}

export function selectableAssemblyMeshes(
  meshes: readonly THREE.Mesh[],
): readonly THREE.Mesh[] {
  return meshes.filter((mesh) => mesh.userData.appearance === "component");
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

export function createAssemblyMeshes(
  parts: readonly AssemblyVisualPart[],
  ownership: MeshOwnership,
  onLoad?: () => void,
): AssemblyMeshSet {
  const meshes: THREE.Mesh[] = [];
  const materials = new Map<string, THREE.MeshStandardMaterial[]>();
  const roots = new Map<string, THREE.Group>();
  const partMap = new Map<string, AssemblyVisualPart>();
  const materialFor = (
    part: AssemblyVisualPart,
    color?: number,
    opacity?: number,
    metalness?: number,
  ) => {
    const style = appearance[part.appearance];
    const semantic = part.material ? semanticMaterial[part.material] : undefined;
    const material = new THREE.MeshStandardMaterial({
      color: color ?? semantic?.color ?? style.color,
      metalness: metalness ?? semantic?.metalness ?? (part.appearance === "component" ? 0.24 : 0),
      opacity: opacity ?? style.opacity,
      roughness: semantic?.roughness ?? 0.52,
      transparent: (opacity ?? style.opacity) < 1,
      wireframe: style.wireframe,
    });
    ownership.own(() => material.dispose());
    materials.set(part.selectionId, [...(materials.get(part.selectionId) ?? []), material]);
    return material;
  };
  const ownMesh = (mesh: THREE.Mesh, part: AssemblyVisualPart) => {
    mesh.name = `assembly-part:${part.id}`;
    mesh.userData.partId = part.selectionId;
    mesh.userData.appearance = part.appearance;
    mesh.userData.movable = part.movable === true;
    mesh.userData.dragGroup = part.dragGroup;
    mesh.renderOrder = part.appearance === "constraint" || part.appearance === "design-region" ? 3 : 0;
    meshes.push(mesh);
  };
  for (const part of parts) {
    const root = new THREE.Group();
    root.name = `assembly-root:${part.id}`;
    root.position.set(...part.center);
    if (part.rotation) root.rotation.set(...part.rotation);
    roots.set(part.id, root);
    partMap.set(part.id, part);
    ownership.attach(root);
    if (part.kind === "model") {
      void import("three/examples/jsm/loaders/GLTFLoader.js").then(({ GLTFLoader }) =>
        new GLTFLoader().loadAsync(part.assetUrl)).then(({ scene }) => {
        const scale = part.assetUnits === "m" ? 1000 : 1;
        scene.scale.setScalar(scale);
        scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const mesh = object;
          const importedMaterial = (source: THREE.Material) => {
            if (!(source instanceof THREE.MeshStandardMaterial)) return materialFor(part);
            const material = materialFor(part, source.color.getHex(), source.opacity, source.metalness);
            material.roughness = source.roughness;
            return material;
          };
          mesh.material = Array.isArray(mesh.material)
            ? mesh.material.map(importedMaterial)
            : importedMaterial(mesh.material);
          ownership.own(() => mesh.geometry.dispose());
          ownMesh(mesh, part);
        });
        root.add(scene);
        onLoad?.();
      }).catch(() => onLoad?.());
      continue;
    }
    if (part.kind === "mesh") {
      for (const surface of part.mesh.surfaces) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(surface.positions, 3));
        if (surface.normals) geometry.setAttribute("normal", new THREE.BufferAttribute(surface.normals, 3));
        else geometry.computeVertexNormals();
        geometry.setIndex(new THREE.BufferAttribute(surface.indices, 1));
        ownership.own(() => geometry.dispose());
        const color = surface.color
          ? new THREE.Color(...surface.color).getHex()
          : undefined;
        const mesh = new THREE.Mesh(geometry, materialFor(part, color, undefined, 0.45));
        ownMesh(mesh, part);
        root.add(mesh);
      }
      continue;
    }
    for (const piece of geometryPieces(part)) {
      ownership.own(() => piece.geometry.dispose());
      const mesh = new THREE.Mesh(
        piece.geometry,
        materialFor(part, piece.color, piece.opacity, piece.metalness),
      );
      if (piece.position) mesh.position.set(...piece.position);
      if (piece.rotation) mesh.rotation.set(...piece.rotation);
      ownMesh(mesh, part);
      root.add(mesh);
    }
  }
  return { meshes, materials, roots, parts: partMap };
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
