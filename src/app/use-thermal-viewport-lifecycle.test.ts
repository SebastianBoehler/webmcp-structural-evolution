import { expect, test, vi } from "vitest";

import { settleThermalMount } from "./use-thermal-viewport-lifecycle";

test("settles mount rejection through the error callback without rejecting outward", async () => {
  const ready = vi.fn(), failed = vi.fn();
  await expect(settleThermalMount(
    Promise.reject(new Error("WebGPU adapter unavailable")), ready, failed,
  )).resolves.toBeUndefined();
  expect(ready).not.toHaveBeenCalled();
  expect(failed).toHaveBeenCalledWith(expect.objectContaining({ message: "WebGPU adapter unavailable" }));
});
