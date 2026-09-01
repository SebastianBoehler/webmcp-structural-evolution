import { expect, test, vi } from "vitest";

test("keeps Rapier out of the main-thread solver module graph", async () => {
  vi.resetModules();
  vi.doMock("@dimforge/rapier3d-deterministic-compat", () => {
    throw new Error("Rapier was imported on the main thread");
  });
  await expect(import("./mechanism-solver")).resolves.toHaveProperty("solveMechanismStudy");
  vi.doUnmock("@dimforge/rapier3d-deterministic-compat");
});
