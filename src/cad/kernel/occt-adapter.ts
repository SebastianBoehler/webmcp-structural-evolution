import type { CadKernelAdapter } from "../runtime-contracts";
import {
  createOcctWorkerClient,
  type OcctWorkerFactory,
  type OcctWorkerLike,
  type OcctWorkerMessageEvent,
} from "./occt-worker-client";

class BrowserOcctWorker implements OcctWorkerLike {
  private readonly worker = new Worker(new URL("./occt-worker.ts", import.meta.url), { type: "module" });
  private requestId = "unknown-request";
  private readonly errorListeners = new Map<
    (event: OcctWorkerMessageEvent) => void,
    (event: ErrorEvent) => void
  >();

  postMessage(message: unknown): void {
    if (message && typeof message === "object" && "type" in message
      && (message.type === "evaluate" || message.type === "import-step")) {
      const candidate = message as { request?: { requestId?: unknown } };
      if (typeof candidate.request?.requestId === "string") this.requestId = candidate.request.requestId;
    }
    this.worker.postMessage(message);
  }

  addEventListener(_type: "message", listener: (event: OcctWorkerMessageEvent) => void): void {
    this.worker.addEventListener("message", listener);
    const onError = (event: ErrorEvent) => listener({
      data: {
        type: "failed",
        requestId: this.requestId,
        error: { code: "device-error", message: event.message || "OCCT worker device error" },
      },
    });
    this.errorListeners.set(listener, onError);
    this.worker.addEventListener("error", onError);
  }

  removeEventListener(_type: "message", listener: (event: OcctWorkerMessageEvent) => void): void {
    this.worker.removeEventListener("message", listener);
    const onError = this.errorListeners.get(listener);
    if (onError) this.worker.removeEventListener("error", onError);
    this.errorListeners.delete(listener);
  }

  terminate(): void {
    this.worker.terminate();
  }
}

export const defaultOcctWorkerFactory: OcctWorkerFactory = () => new BrowserOcctWorker();

export function createOcctCadAdapter(
  factory: OcctWorkerFactory = defaultOcctWorkerFactory,
): CadKernelAdapter {
  return createOcctWorkerClient(factory);
}
