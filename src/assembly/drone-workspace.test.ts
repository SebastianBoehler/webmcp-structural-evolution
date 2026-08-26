import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { droneAssemblyVisuals, INITIAL_MOTORS } from "./drone-workspace";
import { useAssemblyWorkspace } from "./use-assembly-workspace";

describe("drone assembly workspace", () => {
  it("starts as a recognizable four-motor assembly with attached rotor safety geometry", () => {
    const parts = droneAssemblyVisuals(INITIAL_MOTORS, []);

    expect(parts.filter(({ kind }) => kind === "motor")).toHaveLength(4);
    expect(parts.filter(({ kind }) => kind === "propeller")).toHaveLength(4);
    expect(parts.filter(({ kind }) => kind === "guard")).toHaveLength(4);
    expect(parts.find(({ id }) => id === "arm-design-region")?.appearance).toBe("design-region");
  });

  it("moves a motor and every attached visual while invalidating prior layout evidence", () => {
    const view = renderHook(() => useAssemblyWorkspace());
    const before = view.result.current.parts.filter(({ dragGroup }) => dragGroup === "motor-east");

    act(() => view.result.current.movePart("motor-east", [118, 14, 12]));

    const after = view.result.current.parts.filter(({ dragGroup }) => dragGroup === "motor-east");
    expect(after.map(({ center }) => center.slice(0, 2))).toEqual([
      [118, 14],
      [118, 14],
      [118, 14],
    ]);
    expect(before.map(({ center }) => center.slice(0, 2))).not.toEqual(after.map(({ center }) => center.slice(0, 2)));
    expect(view.result.current.layoutState).toBe("changed");
    expect(view.result.current.layoutVersion).toBe(2);
  });

  it("treats a propeller as a visible handle for its whole motor group", () => {
    const propeller = droneAssemblyVisuals(INITIAL_MOTORS, []).find(
      ({ id }) => id === "motor-east-propeller",
    );
    expect(propeller).toMatchObject({ movable: true, dragGroup: "motor-east" });

    const view = renderHook(() => useAssemblyWorkspace());
    act(() => view.result.current.movePart("motor-east-propeller", [118, 14, 30]));
    expect(view.result.current.motors.find(({ id }) => id === "motor-east")?.center).toEqual([118, 14, 12]);
  });

  it("rejects agent moves made against stale layout state", () => {
    const view = renderHook(() => useAssemblyWorkspace());
    act(() => view.result.current.movePart("motor-east", [112, 0, 12], 1));

    expect(() => view.result.current.movePart("motor-east", [120, 0, 12], 1)).toThrow(/layout is stale/i);
  });
});
