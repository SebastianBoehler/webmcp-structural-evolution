import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OcctKernel } from "occt-wasm";

import { checkExactInitialOverlapsWithKernel } from "./mechanism-overlap-kernel";

let kernel: OcctKernel;
let boxBytes: Uint8Array;
const placed = (instanceId: string, x: number, membershipMask = 1, filterMask = 1) => ({
  instanceId, membershipMask, filterMask,
  transform: { positionM: [x, 0, 0] as const, rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] as const },
  bodyIds: ["box-body"],
});
const sourceBodies = () => [{ bodyId: "box-body", brepBytes: boxBytes }];

beforeAll(async () => {
  kernel = await OcctKernel.init();
  const box = kernel.makeBox(1, 1, 1);
  boxBytes = kernel.toBREPBinary(box);
  kernel.release(box);
});
afterAll(() => kernel[Symbol.dispose]());

describe("exact initial mechanism overlap", () => {
  it("rejects positive common volume but permits touching", async () => {
    await expect(checkExactInitialOverlapsWithKernel(kernel, sourceBodies(), [
      placed("first", 0), placed("overlap", 0.5),
    ], new AbortController().signal)).rejects.toThrow(/positive-volume.*first.*overlap/i);
    await expect(checkExactInitialOverlapsWithKernel(kernel, sourceBodies(), [
      placed("first", 0), placed("touching", 1),
    ], new AbortController().signal)).resolves.toBeUndefined();
  });

  it("rejects collision-disabled initial interpenetration and honors cancellation", async () => {
    await expect(checkExactInitialOverlapsWithKernel(kernel, sourceBodies(), [
      placed("first", 0, 1, 0), placed("overlap", 0.5, 1, 1),
    ], new AbortController().signal)).rejects.toThrow(/positive-volume.*first.*overlap/i);
    const controller = new AbortController();
    controller.abort();
    await expect(checkExactInitialOverlapsWithKernel(kernel, sourceBodies(), [placed("first", 0)], controller.signal))
      .rejects.toMatchObject({ name: "AbortError" });
  });

  it("cancels between bounded exact checks and rejects an excessive pair product", async () => {
    const controller = new AbortController();
    const pending = checkExactInitialOverlapsWithKernel(kernel, sourceBodies(), [
      placed("first", 0), placed("second", 2), placed("third", 4),
    ], controller.signal);
    setTimeout(() => controller.abort(), 0);
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const many = Array.from({ length: 257 }, (_value, index) => placed(`body-${index}`, index * 2));
    await expect(checkExactInitialOverlapsWithKernel(kernel, sourceBodies(), many, new AbortController().signal))
      .rejects.toThrow(/pair budget/i);
  });
});
