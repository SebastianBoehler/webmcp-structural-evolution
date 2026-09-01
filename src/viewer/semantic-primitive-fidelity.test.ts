import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { SemanticMeshPayload } from "../cad/rebuild-payload";
import { se6Assembly } from "../samples/cobot/cobot-assembly";
import { SE6_CATALOG } from "../samples/cobot/cobot-catalog";
import { renderSe6Assembly } from "../samples/cobot/cobot-visuals";
import type { AssemblyVisualPart, ViewerRenderModel } from "./render-model-types";
import { semanticArtifactFromViewerModel } from "./semantic-scene";
import { addSemanticScene } from "./semantic-three-scene";
import type { SemanticRenderState } from "./webgpu-renderer-types";

const shared = {
  selectionId: "part", label: "Part", center: [0, 0, 0] as const,
  appearance: "component" as const, material: "joint" as const,
};

function model(parts: readonly AssemblyVisualPart[]): ViewerRenderModel {
  return {
    grid: { dimensions: { width: 1, height: 1, depth: 1 }, cellSize: [1, 1, 1],
      anchor: { position: [0, 0, 0], orientation: [0, 0, 0, 1] } },
    currentInstances: new Uint32Array(), alternativeLayers: [], assemblyParts: parts,
  };
}

function topology(id: string): SemanticMeshPayload {
  return {
    positionsM: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
    indices: new Uint32Array([0, 1, 2]), triangleFaceIndices: new Uint32Array([0]),
    faces: [{ id: `face:${id}`, bodyId: `body-${id}`, signature: {
      ownerFeatureId: "shared-feature", kind: "face", geometry: "plane",
      centroidM: [0, 0, 0], measureSI: 1, adjacentKinds: [],
    }, surfaceEvidence: { kind: "plane", normal: [0, 0, 1] } }],
    edgePointsM: new Float32Array([0, 0, 0, 1, 0, 0]),
    edgePointRanges: new Uint32Array([0, 2]), polylineEdgeIndices: new Uint32Array([0]),
    edges: [{ id: `edge:${id}`, bodyId: `body-${id}`, signature: {
      ownerFeatureId: "shared-feature", kind: "edge", geometry: "curve",
      centroidM: [0, 0, 0], measureSI: 1, adjacentKinds: [],
    } }],
  };
}

describe("semantic primitive and material fidelity", () => {
  it("uses stable authoritative piece IDs instead of one synthetic box", () => {
    const parts = ([
      { ...shared, id: "cylinder", kind: "cylinder", radius: 4, height: 8 },
      { ...shared, id: "mount", kind: "motor-mount", radius: 6, height: 2,
        boltCircle: 4, boltRadius: 0.8 },
      { ...shared, id: "guard", kind: "guard", radius: 9, tubeRadius: 1 },
      { ...shared, id: "protected", kind: "protected-disc", radius: 9, height: 1 },
      { ...shared, id: "motor", kind: "motor",
        base: { radius: 4, height: 2, centerZ: 1 },
        stator: { radius: 3, height: 2, centerZ: 3 },
        bell: { radius: 4, height: 2, centerZ: 5 },
        shaft: { radius: 1, height: 3, centerZ: 7 },
        mountHoles: [{ radius: .4, height: 1, centerZ: 0, centerX: 2, centerY: 2 }],
        localBounds: { minimum: [-4, -4, 0], maximum: [4, 4, 8] } },
      { ...shared, id: "fastener", kind: "fastener",
        shank: { radius: 1, height: 4, centerZ: 2 },
        head: { radius: 2, height: 1, centerZ: 4.5 }, socketWidth: 1,
        socketDepth: .5, socketCenterZ: 5,
        localBounds: { minimum: [-2, -2, 0], maximum: [2, 2, 5] } },
      { ...shared, id: "controller", kind: "flight-controller", size: [30, 30, 4] },
      { ...shared, id: "load", kind: "load-vector", forceN: [0, 0, -5], length: 12 },
      { ...shared, id: "prop", kind: "propeller", radius: 12, hubRadius: 2,
        hubHeight: 3, bladeCount: 3 },
    ] as AssemblyVisualPart[]).map((part) => ({ ...part, selectionId: part.id }));
    const artifact = semanticArtifactFromViewerModel(model(parts), "r1");
    const pieces = artifact.nodes.filter(({ kind, geometry }) => kind === "feature" && geometry);
    const ids = pieces.map(({ id }) => id);
    expect(ids).toEqual(expect.arrayContaining([
      "feature:cylinder:cylinder", "feature:mount:motor-mount-base",
      "feature:mount:motor-mount-bolt-4", "feature:guard:guard-ring",
      "feature:protected:filled-protected-swept-volume", "feature:motor:motor-base",
      "feature:motor:motor-mount-hole-1", "feature:fastener:fastener-socket",
      "feature:controller:flight-controller-board", "feature:load:load-vector-head",
      "feature:prop:propeller-hub", "feature:prop:propeller-blade-3",
    ]));
    expect(pieces.find(({ id }) => id === "feature:cylinder:cylinder")?.geometry?.positions.length)
      .toBeGreaterThan(24);
    expect(pieces.find(({ id }) => id === "feature:motor:motor-base")?.transform?.position)
      .toEqual([0, 0, 1]);
  });

  it("preserves all exact meshes, ordinary meshes, and primitive components", () => {
    const exact = (id: string): AssemblyVisualPart => ({ ...shared, id, selectionId: id,
      kind: "mesh", mesh: { surfaces: [], sizeMm: [1, 1, 1], triangleCount: 1,
        semanticMesh: topology(id) } });
    const ordinary: AssemblyVisualPart = { ...shared, id: "step", selectionId: "step",
      kind: "mesh", mesh: { sizeMm: [1, 1, 1], triangleCount: 1, surfaces: [{
        name: "shell", positions: new Float32Array([2, 0, 0, 3, 0, 0, 2, 1, 0]),
        indices: new Uint32Array([0, 1, 2]), color: [.1, .2, .3],
      }] } };
    const cylinder: AssemblyVisualPart = { ...shared, id: "pin", selectionId: "pin",
      kind: "cylinder", radius: 1, height: 3 };
    const artifact = semanticArtifactFromViewerModel(model([
      exact("first"), ordinary, exact("second"), cylinder,
    ]), "mixed");
    const ids = artifact.nodes.map(({ id }) => id);
    expect(ids).toEqual(expect.arrayContaining([
      "component:first", "component:step", "feature:step:shell",
      "component:second", "component:pin", "feature:pin:cylinder",
    ]));
    expect(artifact.nodes.filter(({ sourceTopology }) => sourceTopology?.id === "face:first"
      || sourceTopology?.id === "face:second")).toHaveLength(2);
    expect(artifact.nodes.find(({ id }) => id === "feature:step:shell")?.geometry?.positions)
      .toEqual(ordinary.kind === "mesh" ? ordinary.mesh.surfaces[0]?.positions : undefined);
  });

  it("carries appearance and semantic material into MeshStandardMaterial", () => {
    const artifact = semanticArtifactFromViewerModel(model([{
      ...shared, id: "motor", kind: "motor",
      base: { radius: 4, height: 2, centerZ: 1 },
      stator: { radius: 3, height: 2, centerZ: 3 },
      bell: { radius: 4, height: 2, centerZ: 5 },
      shaft: { radius: 1, height: 3, centerZ: 7 }, mountHoles: [],
      localBounds: { minimum: [-4, -4, 0], maximum: [4, 4, 8] },
    }]), "material");
    const scene = new THREE.Scene();
    addSemanticScene(THREE, scene, {
      revision: "material", document: artifact, resultLayers: {}, measurements: [],
    } as SemanticRenderState, false);
    const base = artifact.nodes.find(({ id }) => id.endsWith(":motor-base"))!;
    const group = scene.getObjectByName(`semantic:${base.id}`);
    const mesh = group?.children.find((child) => child instanceof THREE.Mesh) as THREE.Mesh;
    const material = mesh.material as THREE.MeshStandardMaterial;
    expect(material.color.getHex()).toBe(0x303947);
    expect(material.metalness).toBe(.7);
    expect(material.roughness).toBe(.3);
    expect(material.opacity).toBe(1);
    expect(material.wireframe).toBe(false);
  });

  it("keeps the complete cobot component ownership and material tokens", () => {
    const parts = renderSe6Assembly(se6Assembly, SE6_CATALOG, {});
    const artifact = semanticArtifactFromViewerModel(model(parts), "cobot");
    const componentIds = artifact.nodes.filter(({ kind }) => kind === "component")
      .map(({ id }) => id);
    expect(componentIds).toEqual(expect.arrayContaining(
      se6Assembly.components.map(({ instanceId }) => `component:${instanceId}`),
    ));
    expect(artifact.nodes.find(({ geometry }) => geometry?.material?.token === "payload")
      ?.geometry?.material).toMatchObject({ appearance: "component", token: "payload" });
    expect(artifact.nodes.find(({ geometry }) => geometry?.material?.appearance === "design-region")
      ?.geometry?.material).toMatchObject({ appearance: "design-region" });
  });

  it("fails visibly instead of synthesizing unsupported model geometry", () => {
    expect(() => semanticArtifactFromViewerModel(model([{
      ...shared, id: "robot", kind: "model", assetUrl: "/robot.glb", assetUnits: "mm",
      size: [10, 10, 10],
    }]), "model")).toThrow("Unsupported WebGPU semantic model asset: robot");
  });
});
