import type { MechanismInput } from "./mechanism-contract";
import {
  MechanismSolverEventSchema, MechanismSolverRequestSchema, type MechanismSolverEvent,
} from "./mechanism-solver-protocol";

export interface MechanismSolverWorker {
  postMessage(message: unknown, transfer?: readonly Transferable[]): void;
  addEventListener(type: "message" | "error" | "messageerror", listener: (event: unknown) => void): void;
  removeEventListener(type: "message" | "error" | "messageerror", listener: (event: unknown) => void): void;
  terminate(): void;
}

const cancelled = () => new DOMException("Mechanism solve was cancelled", "AbortError");
export type MechanismSolverStarted = Extract<MechanismSolverEvent, { type: "started" }>;

export function createMechanismSolverClient(factory: () => MechanismSolverWorker) {
  return (
    input: MechanismInput, signal: AbortSignal,
    onStarted: (event: MechanismSolverStarted) => void = () => undefined,
  ): Promise<unknown> => {
    if (signal.aborted) return Promise.reject(cancelled());
    const inputBytes = new TextEncoder().encode(JSON.stringify(input));
    const requestId = `mechanism-solver-${crypto.randomUUID()}`;
    const request = MechanismSolverRequestSchema.parse({
      type: "solve-mechanism", requestId, mechanismInputDigest: input.mechanismInputDigest, inputBytes,
    });
    if (request.type !== "solve-mechanism") return Promise.reject(new Error("Mechanism solve preflight failed"));
    let worker: MechanismSolverWorker;
    try { worker = factory(); } catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      let settled = false, started = false;
      const finish = (error?: unknown, value?: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        worker.removeEventListener("messageerror", onMessageError);
        worker.terminate();
        if (error === undefined) resolve(value); else reject(error);
      };
      const onAbort = () => {
        try { worker.postMessage(MechanismSolverRequestSchema.parse({ type: "cancel", requestId })); }
        catch { /* Termination below is the cancellation authority. */ }
        finally { finish(cancelled()); }
      };
      const onMessage = (event: unknown) => {
        const data = event && typeof event === "object" && "data" in event
          ? (event as { readonly data: unknown }).data : undefined;
        const parsed = MechanismSolverEventSchema.safeParse(data);
        if (!parsed.success || parsed.data.requestId !== requestId) {
          finish(new Error("Mechanism solver worker returned an invalid response")); return;
        }
        if (parsed.data.type === "started") {
          if (started || parsed.data.mechanismInputDigest !== input.mechanismInputDigest) {
            finish(new Error("Mechanism solver worker returned an invalid start acknowledgement")); return;
          }
          started = true;
          try { onStarted(parsed.data); } catch (error) { finish(error); }
          return;
        }
        if (!started) {
          const detail = parsed.data.type === "failed" ? `: ${parsed.data.error}` : "";
          finish(new Error(`Mechanism solver worker returned a terminal before starting${detail}`)); return;
        }
        if (parsed.data.type === "failed") finish(new Error(parsed.data.error));
        else if (parsed.data.type === "cancelled") finish(cancelled());
        else {
          try { finish(undefined, JSON.parse(new TextDecoder().decode(parsed.data.outputBytes))); }
          catch (error) { finish(error); }
        }
      };
      const onError = (event: unknown) => {
        const message = event && typeof event === "object" && "message" in event
          && typeof (event as { readonly message?: unknown }).message === "string"
          ? (event as { readonly message: string }).message : "Mechanism solver worker crashed";
        finish(new Error(message));
      };
      const onMessageError = () => finish(new Error("Mechanism solver worker could not deserialize a message"));
      signal.addEventListener("abort", onAbort, { once: true });
      worker.addEventListener("message", onMessage);
      worker.addEventListener("error", onError);
      worker.addEventListener("messageerror", onMessageError);
      if (signal.aborted) { onAbort(); return; }
      try { worker.postMessage(request, [inputBytes.buffer]); } catch (error) { finish(error); }
    });
  };
}
