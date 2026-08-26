import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const step = vi.hoisted(() => ({ decode: vi.fn() }));
vi.mock("./step-import", () => ({ decodeStepFile: step.decode }));

import { droneAssemblyVisuals, INITIAL_MOTORS } from "./drone-workspace";
import { useAssemblyWorkspace } from "./use-assembly-workspace";

describe("drone assembly workspace", () => {
  it("starts as a recognizable four-motor assembly with attached rotor safety geometry", () => {
    const parts = droneAssemblyVisuals(INITIAL_MOTORS, []);

    expect(parts.filter(({ kind }) => kind === "motor")).toHaveLength(4);
    expect(parts.filter(({ kind }) => kind === "motor-mount")).toHaveLength(4);
    expect(parts.filter(({ kind }) => kind === "propeller")).toHaveLength(4);
    expect(parts.filter(({ kind }) => kind === "guard")).toHaveLength(4);
    expect(parts.filter(({ kind }) => kind === "protected-disc")).toHaveLength(4);
    expect(parts.find(({ id }) => id === "motor-east")).toMatchObject({
      center: [105, 0, 3],
      base: { radius: 12, height: 3, centerZ: 1.5 },
      stator: { radius: 11.25, height: 7.6, centerZ: 6.7 },
      bell: { radius: 14, height: 17, centerZ: 11.4 },
      shaft: { radius: 2.5, height: 12.1, centerZ: 25.85 },
    });
    expect(parts.find(({ id }) => id === "motor-east-fastener-1")).toMatchObject({
      kind: "fastener",
      center: [110.657, 5.657, 3],
      shank: { centerZ: 4, height: 8 },
      head: { centerZ: -1.5, height: 3 },
      localBounds: { minimum: [-2.84, -2.84, -3], maximum: [2.84, 2.84, 8] },
    });
    expect(parts.find(({ id }) => id === "motor-east-propeller-swept-volume")).toMatchObject({
      appearance: "constraint",
      kind: "protected-disc",
      center: [105, 0, 26.15],
      radius: 66,
      height: 8.5,
    });
    expect(parts.find(({ id }) => id === "flight-controller")).toMatchObject({
      kind: "flight-controller",
      size: [41.6, 39.4, 7.8],
    });
    expect(parts.find(({ id }) => id === "flight-controller-esc")).toMatchObject({
      kind: "flight-controller",
      size: [45.6, 44, 8],
    });
    expect(parts.find(({ id }) => id === "battery")).toMatchObject({ size: [78, 37, 52] });
    expect(parts.filter(({ id }) => id.includes("-fastener-"))).toHaveLength(16);
    expect(parts.some(({ id }) => id === "receiver")).toBe(false);
    expect(parts.filter(({ appearance }) => appearance === "constraint").length).toBeGreaterThanOrEqual(8);
    expect(parts.find(({ id }) => id === "arm-design-region")?.appearance).toBe("design-region");
  });

  it("moves a motor and every attached visual while invalidating prior layout evidence", () => {
    const view = renderHook(() => useAssemblyWorkspace());
    const before = view.result.current.parts.filter(({ dragGroup }) => dragGroup === "motor-east");

    act(() => view.result.current.movePart("motor-east", [118, 14, 3]));

    const after = view.result.current.parts.filter(({ dragGroup }) => dragGroup === "motor-east");
    expect(after).toHaveLength(9);
    expect(after.map(({ center }, index) => [
      center[0] - before[index]!.center[0],
      center[1] - before[index]!.center[1],
    ])).toEqual(Array.from({ length: 9 }, () => [13, 14]));
    expect(view.result.current.layoutState).toBe("changed");
    expect(view.result.current.layoutVersion).toBe(2);
  });

  it("treats a propeller as a visible handle for its whole motor group", () => {
    const propeller = droneAssemblyVisuals(INITIAL_MOTORS, []).find(
      ({ id }) => id === "motor-east-propeller",
    );
    expect(propeller).toMatchObject({ movable: true, dragGroup: "motor-east" });

    const view = renderHook(() => useAssemblyWorkspace());
    act(() => view.result.current.movePart("motor-east-propeller", [118, 14, 26.15]));
    expect(view.result.current.motors.find(({ id }) => id === "motor-east")?.anchor).toEqual([118, 14, 3]);
  });

  it("imports a locally supplied STEP model as tessellated CAD geometry", async () => {
    step.decode.mockResolvedValueOnce({
      surfaces: [{ name: "board", positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), indices: new Uint32Array([0, 1, 2]) }],
      sizeMm: [54.3, 39, 17.5],
      triangleCount: 1,
    });
    const view = renderHook(() => useAssemblyWorkspace());
    let importedId = "";

    await act(async () => {
      importedId = await view.result.current.importFile(new File(["STEP"], "pixhawk-6c-mini.step"));
    });

    expect(view.result.current.imports.find(({ id }) => id === importedId)).toMatchObject({
      name: "pixhawk-6c-mini",
      assetUnits: "mm",
      sizeMm: [54.3, 39, 17.5],
      validation: "unverified-visual",
    });
    expect(view.result.current.parts.find(({ id }) => id === importedId)?.kind).toBe("mesh");
  });

  it("rejects agent moves made against stale layout state", () => {
    const view = renderHook(() => useAssemblyWorkspace());
    act(() => view.result.current.movePart("motor-east", [112, 0, 12], 1));

    expect(() => view.result.current.movePart("motor-east", [120, 0, 12], 1)).toThrow(/layout is stale/i);
  });
});
