import {
  MechanismOverlapEventSchema, MechanismOverlapRequestSchema,
  type ExactPlacedInstance, type ExactSourceBody,
} from "./mechanism-overlap-protocol";

export interface MechanismOverlapWorker {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  addEventListener(type: "message" | "error" | "messageerror", listener: (event: unknown) => void): void;
  removeEventListener(type: "message" | "error" | "messageerror", listener: (event: unknown) => void): void;
  terminate(): void;
}

export function createMechanismOverlapClient(factory: () => MechanismOverlapWorker) {
  return (sourceBodies: readonly ExactSourceBody[], instances: readonly ExactPlacedInstance[], signal: AbortSignal): Promise<void> => {
    if (signal.aborted) return Promise.reject(new DOMException("Mechanism compilation was cancelled", "AbortError"));
    const owned = structuredClone({ sourceBodies, instances });
    const requestContent = MechanismOverlapRequestSchema.parse({
      type: "check-overlap", requestId: "mechanism-overlap-preflight", ...owned,
    });
    if (requestContent.type !== "check-overlap") throw new Error("Exact overlap request preflight failed");
    let worker: MechanismOverlapWorker;
    try { worker = factory(); } catch (error) { return Promise.reject(error); }
    const requestId = `mechanism-overlap-${crypto.randomUUID()}`;
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        worker.removeEventListener("messageerror", onMessageError);
        worker.terminate();
        if (error === undefined) resolve(); else reject(error);
      };
      const onAbort = () => {
        try {
          worker.postMessage(MechanismOverlapRequestSchema.parse({ type: "cancel", requestId }));
        } catch {
          // Termination below is the authoritative cancellation boundary.
        } finally {
          finish(new DOMException("Mechanism compilation was cancelled", "AbortError"));
        }
      };
      const onMessage = (message: unknown) => {
        const data = message && typeof message === "object" && "data" in message
          ? (message as { readonly data: unknown }).data : undefined;
        const parsed = MechanismOverlapEventSchema.safeParse(data);
        if (!parsed.success || parsed.data.requestId !== requestId) finish(new Error("Exact overlap worker returned an invalid response"));
        else if (parsed.data.type === "failed") finish(new Error(parsed.data.error));
        else if (parsed.data.type === "cancelled") finish(new DOMException("Mechanism compilation was cancelled", "AbortError"));
        else finish();
      };
      const onError = (event: unknown) => {
        const message = event && typeof event === "object" && "message" in event
          && typeof (event as { readonly message?: unknown }).message === "string"
          ? (event as { readonly message: string }).message : "Exact overlap worker crashed";
        finish(new Error(message));
      };
      const onMessageError = () => finish(new Error("Exact overlap worker could not deserialize a message"));
      signal.addEventListener("abort", onAbort, { once: true });
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.addEventListener("messageerror", onMessageError);
      if (signal.aborted) { onAbort(); return; }
      const request = { ...requestContent, requestId };
      const buffers = request.sourceBodies.map(({ brepBytes }) => brepBytes.buffer);
      try { worker.postMessage(request, buffers); } catch (error) { finish(error); }
    });
  };
}
