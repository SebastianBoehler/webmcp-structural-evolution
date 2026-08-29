import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createAssemblyMeshes, selectableAssemblyMeshes } from "./assembly-meshes";
import type { AssemblyVisualPart } from "./render-envelope";

function mesh(appearance: "component" | "design-region") {
  const object = new THREE.Mesh();
  object.userData.appearance = appearance;
  return object;
}

describe("selectableAssemblyMeshes", () => {
  it("keeps selection rays on physical components, not surrounding regions", () => {
    const region = mesh("design-region");
    const motor = mesh("component");

    expect(selectableAssemblyMeshes([region, motor])).toEqual([motor]);
  });

  it("applies semantic component materials without changing selection ownership", () => {
    const roots: THREE.Object3D[] = [];
    const releases: (() => void)[] = [];
    const part: AssemblyVisualPart = {
      id: "payload", selectionId: "payload", label: "Calibration payload",
      appearance: "component", material: "payload", semanticGroup: "tooling",
      kind: "box", center: [0, 0, 0], size: [100, 80, 60],
    };

    const result = createAssemblyMeshes([part], {
      own: (release) => releases.push(release),
      attach: (root) => roots.push(root),
    });

    expect(result.materials.get("payload")![0]!.color.getHex()).toBe(0xd7a94a);
    expect(result.meshes[0]!.userData.partId).toBe("payload");
    expect(roots).toHaveLength(1);
    releases.forEach((release) => release());
  });
});
