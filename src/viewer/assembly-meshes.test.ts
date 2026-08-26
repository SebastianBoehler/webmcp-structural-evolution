import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { selectableAssemblyMeshes } from "./assembly-meshes";

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
});
