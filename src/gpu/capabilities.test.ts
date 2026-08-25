import { afterEach, describe, expect, it, vi } from "vitest";

import { detectWebGpu } from "./capabilities";

describe("detectWebGpu", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("distinguishes a missing browser API", async () => {
    vi.stubGlobal("navigator", {});

    await expect(detectWebGpu()).resolves.toMatchObject({
      status: "unavailable",
      code: "api-unavailable",
    });
  });

  it("distinguishes a browser with no compatible adapter", async () => {
    vi.stubGlobal("navigator", { gpu: { requestAdapter: vi.fn().mockResolvedValue(null) } });

    await expect(detectWebGpu()).resolves.toMatchObject({
      status: "unavailable",
      code: "adapter-unavailable",
    });
  });

  it("distinguishes device acquisition errors", async () => {
    const adapter = { requestDevice: vi.fn().mockRejectedValue(new Error("permission denied")) };
    vi.stubGlobal("navigator", { gpu: { requestAdapter: vi.fn().mockResolvedValue(adapter) } });

    await expect(detectWebGpu()).resolves.toMatchObject({
      status: "failed",
      code: "device-request-failed",
      message: expect.stringContaining("permission denied"),
    });
  });

  it("distinguishes an adapter that returns no device", async () => {
    const adapter = { requestDevice: vi.fn().mockResolvedValue(null) };
    vi.stubGlobal("navigator", { gpu: { requestAdapter: vi.fn().mockResolvedValue(adapter) } });

    await expect(detectWebGpu()).resolves.toMatchObject({
      status: "unavailable",
      code: "device-unavailable",
    });
  });

  it("reports availability and destroys its temporary detection device", async () => {
    const device = { destroy: vi.fn() };
    const adapter = { requestDevice: vi.fn().mockResolvedValue(device) };
    vi.stubGlobal("navigator", { gpu: { requestAdapter: vi.fn().mockResolvedValue(adapter) } });

    await expect(detectWebGpu()).resolves.toMatchObject({ status: "available" });
    expect(device.destroy).toHaveBeenCalledOnce();
  });
});
