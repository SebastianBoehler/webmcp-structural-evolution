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

function ownedFactory(factory: OcctWorkerFactory) {
  const workers = new Set<OcctWorkerLike>();
  return {
    create(): OcctWorkerLike {
      const worker = factory(), listeners = new Set<(event: OcctWorkerMessageEvent) => void>();
      let terminated = false;
      const owned: OcctWorkerLike = {
        postMessage: (message) => worker.postMessage(message),
        addEventListener(type, listener) {
          listeners.add(listener);
          worker.addEventListener(type, listener);
        },
        removeEventListener(type, listener) {
          listeners.delete(listener);
          worker.removeEventListener(type, listener);
        },
        terminate() {
          if (terminated) return;
          terminated = true;
          for (const listener of listeners) worker.removeEventListener("message", listener);
          listeners.clear();
          workers.delete(owned);
          worker.terminate();
        },
      };
      workers.add(owned);
      return owned;
    },
    dispose() {
      for (const worker of [...workers]) worker.terminate();
    },
  };
}

export function createOcctCadAdapter(
  factory: OcctWorkerFactory = defaultOcctWorkerFactory,
): CadKernelAdapter {
  const owned = ownedFactory(factory);
  const client = createOcctWorkerClient(owned.create);
  let disposed = false;
  const controllers = new Set<AbortController>();
  const signalFor = (signal: AbortSignal) => {
    const controller = new AbortController();
    controllers.add(controller);
    return { controller, signal: AbortSignal.any([signal, controller.signal]) };
  };
  return {
    evaluate(request, signal, emit) {
      if (disposed) return Promise.reject(new Error("OCCT CAD adapter has been disposed"));
      const operation = signalFor(signal);
      return client.evaluate(request, operation.signal, emit).finally(() => controllers.delete(operation.controller));
    },
    importStep(request, signal) {
      if (disposed) return Promise.reject(new Error("OCCT CAD adapter has been disposed"));
      const operation = signalFor(signal);
      return client.importStep(request, operation.signal).finally(() => controllers.delete(operation.controller));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      client.dispose();
      for (const controller of controllers) controller.abort();
      owned.dispose();
    },
  };
}
