import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import type { AssemblyVisualPart } from "./render-envelope";
import { materializeSemanticModelParts } from "./semantic-model-materializer";

type Loader = { loadAsync(url: string): Promise<{ scene: THREE.Object3D }> };

const modelPart = (id: string, assetUrl: string): AssemblyVisualPart => ({
  id, selectionId: "drone", label: "Reference drone", center: [40, 50, 60],
  rotation: [.1, .2, .3], dragGroup: "reference", movable: true,
  material: "structural", semanticGroup: "airframe", appearance: "component",
  kind: "model", assetUrl, assetUnits: "m", size: [1, 1, 1],
});

function nestedIndexedScene(): THREE.Group {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
  ], 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 0, 1, 0, 0, 1,
  ], 3));
  geometry.setIndex([0, 1, 2]);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x336699 }));
  mesh.name = "rotor";
  mesh.position.set(1, 0, 0);
  const parent = new THREE.Group();
  parent.position.set(1, 2, 3);
  parent.rotation.z = Math.PI / 2;
  parent.add(mesh);
  return parent;
}

function nonTriangleScene(): THREE.Group {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0,
  ], 3));
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(geometry));
  return scene;
}

function interleavedScene(): THREE.Group {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.InterleavedBufferAttribute(
    new THREE.InterleavedBuffer(new Float32Array([
      0, 0, 0, 99, 1, 0, 0, 99, 0, 1, 0, 99,
    ]), 4), 3, 0,
  ));
  geometry.setAttribute("normal", new THREE.InterleavedBufferAttribute(
    new THREE.InterleavedBuffer(new Float32Array([
      0, 0, 1, 88, 0, 0, 1, 88, 0, 0, 1, 88,
    ]), 4), 3, 0,
  ));
  geometry.setIndex([0, 1, 2]);
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(geometry));
  return scene;
}

function normalizedScene(): THREE.Group {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Uint16BufferAttribute([
    0, 0, 0, 65535, 0, 0, 0, 65535, 0,
  ], 3, true));
  geometry.setAttribute("normal", new THREE.Int16BufferAttribute([
    0, 0, 32767, 0, 0, 32767, 0, 0, 32767,
  ], 3, true));
  geometry.setIndex([0, 1, 2]);
  const scene = new THREE.Group();
  scene.add(new THREE.Mesh(geometry));
  return scene;
}

describe("materializeSemanticModelParts", () => {
  it("flattens authored meshes into millimetre triangles while preserving the part identity", async () => {
    const loader: Loader = { loadAsync: vi.fn(async () => ({ scene: nestedIndexedScene() })) };
    const [part] = await materializeSemanticModelParts([modelPart("reference-drone", "/reference.glb")], loader);

    expect(part).toMatchObject({
      id: "reference-drone", selectionId: "drone", center: [40, 50, 60], rotation: [.1, .2, .3],
      dragGroup: "reference", movable: true, material: "structural", semanticGroup: "airframe",
      appearance: "component", kind: "mesh",
    });
    expect(part.kind === "mesh" && part.mesh.triangleCount).toBe(1);
    expect(part.kind === "mesh" && part.mesh.sizeMm).toEqual([
      expect.closeTo(1000), expect.closeTo(1000), 0,
    ]);
    expect(part.kind === "mesh" && part.mesh.surfaces).toHaveLength(1);
    const surface = part.kind === "mesh" ? part.mesh.surfaces[0]! : undefined;
    expect(surface && [...surface.positions]).toEqual([
      1000, 3000, 3000, 1000, 4000, 3000, 0, 3000, 3000,
    ].map((value) => expect.closeTo(value)));
    expect(surface?.normals).toEqual(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]));
    expect(surface?.indices).toEqual(new Uint32Array([0, 1, 2]));
  });

  it("loads a shared authored asset once while materializing every part", async () => {
    const loader: Loader = { loadAsync: vi.fn(async () => ({ scene: nestedIndexedScene() })) };
    const parts = await materializeSemanticModelParts([
      modelPart("left", "/shared.glb"), modelPart("right", "/shared.glb"),
    ], loader);

    expect(loader.loadAsync).toHaveBeenCalledOnce();
    expect(parts.map(({ kind }) => kind)).toEqual(["mesh", "mesh"]);
    expect(parts.map(({ id }) => id)).toEqual(["left", "right"]);
  });

  it("creates valid indices and normals for a non-indexed triangle list", async () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute([
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ], 3));
    const scene = new THREE.Group();
    scene.add(new THREE.Mesh(geometry));
    const loader: Loader = { loadAsync: vi.fn(async () => ({ scene })) };

    const [part] = await materializeSemanticModelParts([modelPart("plain", "/plain.glb")], loader);

    expect(part.kind === "mesh" && part.mesh.surfaces[0]?.indices).toEqual(new Uint32Array([0, 1, 2]));
    expect(part.kind === "mesh" && part.mesh.surfaces[0]?.normals).toEqual(new Float32Array([
      0, 0, 1, 0, 0, 1, 0, 0, 1,
    ]));
  });

  it("reads interleaved accessors instead of their padded storage", async () => {
    const loader: Loader = { loadAsync: vi.fn(async () => ({ scene: interleavedScene() })) };
    const [part] = await materializeSemanticModelParts([modelPart("interleaved", "/interleaved.glb")], loader);
    const surface = part.kind === "mesh" ? part.mesh.surfaces[0]! : undefined;

    expect(surface?.positions).toEqual(new Float32Array([0, 0, 0, 1000, 0, 0, 0, 1000, 0]));
    expect(surface?.normals).toEqual(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]));
  });

  it("reads normalized quantized position and normal accessors", async () => {
    const loader: Loader = { loadAsync: vi.fn(async () => ({ scene: normalizedScene() })) };
    const [part] = await materializeSemanticModelParts([modelPart("quantized", "/quantized.glb")], loader);
    const surface = part.kind === "mesh" ? part.mesh.surfaces[0]! : undefined;

    expect(surface?.positions).toEqual(new Float32Array([0, 0, 0, 1000, 0, 0, 0, 1000, 0]));
    expect(surface?.normals).toEqual(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]));
  });

  it.each([
    ["empty", new THREE.Group()],
    ["non-triangle", nonTriangleScene()],
  ])("rejects a %s asset with its part and asset identity", async (_case, scene) => {
    const loader: Loader = { loadAsync: vi.fn(async () => ({ scene })) };
    await expect(materializeSemanticModelParts([modelPart("bad-part", "/bad.glb")], loader))
      .rejects.toThrow(/bad-part.*\/bad\.glb/i);
  });

  it.each([
    ["non-finite", (() => { const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, NaN, 0, 0, 0, 1, 0], 3)); const scene = new THREE.Group(); scene.add(new THREE.Mesh(geometry)); return scene; })()],
    ["inconsistent", (() => { const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)); geometry.setIndex([0, 1, 3]); const scene = new THREE.Group(); scene.add(new THREE.Mesh(geometry)); return scene; })()],
  ])("rejects %s geometry with its part and asset identity", async (_case, scene) => {
    const loader: Loader = { loadAsync: vi.fn(async () => ({ scene })) };
    await expect(materializeSemanticModelParts([modelPart("invalid", "/invalid.glb")], loader))
      .rejects.toThrow(/invalid.*\/invalid\.glb/i);
  });

  it("makes loader failures visible with the part and asset identity", async () => {
    const loader: Loader = { loadAsync: vi.fn(async () => { throw new Error("network unavailable"); }) };
    await expect(materializeSemanticModelParts([modelPart("offline", "/offline.glb")], loader))
      .rejects.toThrow(/offline.*\/offline\.glb.*network unavailable/i);
  });
});
