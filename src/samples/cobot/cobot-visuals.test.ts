import { describe, expect, it } from "vitest";

import { prepareRenderModel } from "../../viewer/render-envelope";
import { SE6_INSTANCE_GROUPS, se6Assembly } from "./cobot-assembly";
import { SE6_CATALOG } from "./cobot-catalog";
import { renderSe6Assembly } from "./cobot-visuals";

const componentIds = new Set(se6Assembly.components.map(({ instanceId }) => instanceId));

describe("SE-6 visual adapter", () => {
  it("owns all 52 detailed component visuals through semantic assembly instances", () => {
    const parts = renderSe6Assembly(se6Assembly, SE6_CATALOG, {});
    const components = parts.filter(({ appearance }) => appearance === "component");

    expect(components).toHaveLength(52);
    expect(components.every(({ selectionId }) => componentIds.has(selectionId))).toBe(true);
    expect(new Set(components.map(({ semanticGroup }) => semanticGroup))).toEqual(new Set([
      "base", "shoulder", "upper-arm", "forearm", "wrist", "tooling", "services",
    ]));
    expect(components.find(({ id }) => id === "calibration-payload")).toMatchObject({
      material: "payload", semanticGroup: "tooling", selectionId: "calibration-payload",
    });
    expect(components.find(({ id }) => id === "upper-arm-service-cover")).toMatchObject({
      material: "cover", semanticGroup: "upper-arm",
    });
    expect(components.some(({ id }) => id === "upper-arm-link")).toBe(false);
    expect(Object.values(SE6_INSTANCE_GROUPS).flat()).toHaveLength(52);
  });

  it("frames the complete industrial-arm silhouette and installed upper-arm domain", () => {
    const parts = renderSe6Assembly(se6Assembly, SE6_CATALOG, {});
    const domain = parts.find(({ appearance }) => appearance === "design-region");
    const prepared = prepareRenderModel({
      grid: {
        dimensions: { width: 48, height: 32, depth: 16 },
        cellSize: [7.5, 130 / 32, 110 / 16],
        anchor: { position: [30, -65, 285], orientation: [0, 0, 0, 1] },
      },
      currentInstances: new Uint32Array(), alternativeLayers: [], assemblyParts: parts,
    });

    expect(domain).toMatchObject({
      id: "arm-design-region", label: "SE-6 upper-arm topology domain",
      center: [210, 0, 340], size: [360, 130, 110],
    });
    expect(prepared.camera.span).toBeGreaterThan(1_100);
    expect(prepared.camera.target[0]).toBeGreaterThan(400);
    expect(parts.find(({ id }) => id === "base-plate")!.center[2]).toBeLessThan(
      parts.find(({ id }) => id === "j2-barrel")!.center[2]!,
    );
    expect(parts.find(({ id }) => id === "calibration-payload")!.center[0]).toBeGreaterThan(
      parts.find(({ id }) => id === "gripper-body")!.center[0]!,
    );
  });
});
