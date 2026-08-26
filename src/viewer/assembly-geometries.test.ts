import { describe, expect, it } from "vitest";

import { droneAssemblyVisuals, INITIAL_MOTORS } from "../assembly/drone-workspace";
import { geometryPieces } from "./assembly-geometries";

describe("reference assembly geometry", () => {
  it("renders every specification-authored motor feature", () => {
    const motor = droneAssemblyVisuals(INITIAL_MOTORS, []).find(({ id }) => id === "motor-east")!;
    if (motor.kind === "model" || motor.kind === "mesh") throw new Error("unexpected motor asset");

    expect(geometryPieces(motor).map(({ id }) => id)).toEqual(expect.arrayContaining([
      "motor-base",
      "motor-stator",
      "motor-bell",
      "motor-shaft",
      "motor-mount-hole-1",
      "motor-mount-hole-2",
      "motor-mount-hole-3",
      "motor-mount-hole-4",
    ]));
  });

  it("renders the protected rotor as a filled exact swept volume", () => {
    const volume = droneAssemblyVisuals(INITIAL_MOTORS, []).find(
      ({ id }) => id === "motor-east-propeller-swept-volume",
    )!;
    if (volume.kind === "model" || volume.kind === "mesh") throw new Error("unexpected volume asset");
    const pieces = geometryPieces(volume);

    expect(volume).toMatchObject({ kind: "protected-disc", radius: 66, height: 8.5 });
    expect(pieces).toHaveLength(1);
    expect(pieces[0]).toMatchObject({ id: "filled-protected-swept-volume" });
    expect(pieces[0]!.geometry.type).toBe("CylinderGeometry");
  });
});
