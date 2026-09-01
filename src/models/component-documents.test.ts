import { describe, expect, it } from "vitest";
import { OcctKernel } from "occt-wasm";

import { createOcctBridge } from "../cad/kernel/occt-bridge";
import { rebuildDocument } from "../cad/kernel/feature-rebuild";
import { ComponentCadSourceSchema } from "./component-cad-authority";
import {
  droneMotorSideArmDocument,
  se6MechanismDocument,
  se6UpperArmDocument,
} from "./component-documents";

describe("authoritative component documents", () => {
  it("rejects imported STEP authority without owned bytes, digest, and exact import", () => {
    expect(() => ComponentCadSourceSchema.parse({
      authority: "digest-verified-step-import",
      step: { digest: "a".repeat(64), exactImport: "succeeded" },
    })).toThrow();
  });

  it("derives the SE-6 upper arm dimensions from its catalog definition", async () => {
    const model = await se6UpperArmDocument();

    expect(model.authority).toBe("parametric-specification-model");
    expect(model.document.bodies).toHaveLength(1);
    expect(model.componentInstances).toEqual(["upper-arm-housing"]);
    expect(model.document.sketches[0]!.entities[0]).toMatchObject({
      kind: "rectangle", sizeM: [.42, .08], centerM: [0, 0],
    });
  });

  it("maps the drone body support, motor load, material, and protected interfaces", async () => {
    const model = await droneMotorSideArmDocument();

    expect(model.document.materials.map(({ id }) => id)).toEqual(["pla-foundation-profile"]);
    expect(model.supports).toContain("body-interface");
    expect(model.loads).toEqual([{ instanceId: "motor-east", interfaceId: "motor-thrust-load" }]);
    expect(model.interfaces.map(({ id }) => id)).toEqual(expect.arrayContaining([
      "body-interface:body-mount-north", "motor-east:motor-mount-1", "motor-east:propeller-shaft-seat",
    ]));
  });

  it("covers every SE-6 instance once across seven stages and preserves six revolute joints", async () => {
    const model = await se6MechanismDocument();

    expect(model.componentInstances).toHaveLength(52);
    expect(new Set(model.componentInstances)).toHaveLength(52);
    expect(Object.keys(model.stages)).toEqual(["base", "axis-1", "axis-2", "axis-3", "axis-4", "axis-5", "axis-6"]);
    expect(Object.values(model.stages).flat()).toHaveLength(52);
    expect(model.joints).toHaveLength(6);
    expect(model.joints.every(({ kind }) => kind === "revolute")).toBe(true);
  });

  it("rebuilds every compiled component document through OCCT", async () => {
    const bridge = createOcctBridge(await OcctKernel.init());
    try {
      for (const model of await Promise.all([
        droneMotorSideArmDocument(), se6UpperArmDocument(), se6MechanismDocument(),
      ])) {
        const payload = await rebuildDocument(
          bridge, model.document, ["brep"], new AbortController().signal,
        );
        expect(payload.brep?.bytes.byteLength).toBeGreaterThan(100);
        expect(payload.bodyIds).toHaveLength(model.componentInstances.length);
      }
    } finally { bridge.dispose(); }
  });
});
