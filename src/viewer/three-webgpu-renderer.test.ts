import { expect, it, vi } from "vitest";

import { initializeThreeRenderer } from "./three-webgpu-renderer";

it("disposes the initialized renderer exactly once when post-init setup fails", async () => {
  const renderer = {
    init: vi.fn(async () => undefined),
    dispose: vi.fn(),
  };
  const setup = vi.fn(async () => {
    throw new Error("OrbitControls setup failed");
  });

  await expect(initializeThreeRenderer(renderer, setup))
    .rejects.toThrow("OrbitControls setup failed");
  expect(renderer.init).toHaveBeenCalledOnce();
  expect(setup).toHaveBeenCalledOnce();
  expect(renderer.dispose).toHaveBeenCalledOnce();
});
