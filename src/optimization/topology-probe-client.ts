import type { ProbeResult } from "../gpu/compute-probe";
import type { ProbeInput } from "../gpu/probe-contract";

interface WorkerReply {
  readonly result: ProbeResult;
}

const canceled = (startedAt: number): ProbeResult => ({
  status: "canceled",
  code: "canceled",
  message: "Topology optimization canceled by the user.",
  elapsedMs: performance.now() - startedAt,
});

export function runTopologyProbeInWorker(
  input: ProbeInput,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  const startedAt = performance.now();
  if (signal?.aborted) return Promise.resolve(canceled(startedAt));

  return new Promise((resolve) => {
    let settled = false;
    let worker: Worker;
    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      worker.terminate();
      resolve(result);
    };
    const abort = () => finish(canceled(startedAt));

    try {
      worker = new Worker(new URL("./topology-probe.worker.ts", import.meta.url), {
        type: "module",
        name: "topology-optimization",
      });
    } catch (error) {
      resolve({
        status: "failed",
        code: "device-error",
        message: `Topology worker failed to start: ${error instanceof Error ? error.message : String(error)}`,
        elapsedMs: performance.now() - startedAt,
      });
      return;
    }
    worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => finish(data.result);
    worker.onerror = (event) => finish({
      status: "failed",
      code: "device-error",
      message: `Topology worker crashed: ${event.message || "unknown worker error"}`,
      elapsedMs: performance.now() - startedAt,
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    worker.postMessage({ input });
  });
}
