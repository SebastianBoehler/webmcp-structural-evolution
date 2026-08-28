import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProbeInput } from "../gpu/probe-contract";

const input: ProbeInput = {
  dimensions: { width: 32, height: 32, depth: 8 },
  values: new Float32Array(32 * 32 * 8),
  topologyPreset: "balanced",
};

class FakeWorker {
  static current: FakeWorker | undefined;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();

  constructor() { FakeWorker.current = this; }
}

describe("runTopologyProbeInWorker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeWorker.current = undefined;
  });

  it("runs the solve outside the renderer thread and returns the worker result", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const { runTopologyProbeInWorker } = await import("./topology-probe-client");
    const pending = runTopologyProbeInWorker(input);
    const worker = FakeWorker.current!;

    expect(worker.postMessage).toHaveBeenCalledWith({ input });
    worker.onmessage?.({ data: {
      result: { status: "canceled", code: "canceled", message: "worker result", elapsedMs: 12 },
    } } as MessageEvent);

    await expect(pending).resolves.toMatchObject({ status: "canceled", message: "worker result" });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates the active solve immediately when cancellation is requested", async () => {
    vi.stubGlobal("Worker", FakeWorker);
    const { runTopologyProbeInWorker } = await import("./topology-probe-client");
    const controller = new AbortController();
    const pending = runTopologyProbeInWorker(input, controller.signal);
    const worker = FakeWorker.current!;

    controller.abort();

    await expect(pending).resolves.toMatchObject({ status: "canceled", code: "canceled" });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
