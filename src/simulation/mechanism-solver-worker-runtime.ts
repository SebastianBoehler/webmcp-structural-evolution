import { MechanismSolverEventSchema, MechanismSolverRequestSchema } from "./mechanism-solver-protocol";
import { MechanismWorkerOutputSchema, type MechanismWorkerOutput } from "./mechanism-solver-output";

export interface MechanismSolverWorkerScope {
  postMessage(value: unknown, transfer?: readonly Transferable[]): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
}

const messageFor = (error: unknown) => error instanceof Error ? error.message : String(error);

export function createMechanismSolverWorkerRuntime(
  scope: MechanismSolverWorkerScope,
  solve: (value: unknown, signal: AbortSignal) => Promise<MechanismWorkerOutput>,
): void {
  let active: { readonly requestId: string; readonly controller: AbortController } | undefined;
  const post = (value: unknown, transfer: readonly Transferable[] = []) =>
    scope.postMessage(MechanismSolverEventSchema.parse(value), transfer);
  scope.addEventListener("message", ({ data }) => {
    const parsed = MechanismSolverRequestSchema.safeParse(data);
    if (!parsed.success) {
      const candidate = data as { readonly requestId?: unknown } | null;
      const requestId = typeof candidate?.requestId === "string" && candidate.requestId.length > 0
        ? candidate.requestId.slice(0, 256) : "unknown-request";
      post({ type: "failed", requestId, error: "Mechanism solver received an invalid request" });
      return;
    }
    const request = parsed.data;
    if (request.type === "cancel") {
      if (active?.requestId === request.requestId) active.controller.abort();
      return;
    }
    if (active) {
      post({ type: "failed", requestId: request.requestId, error: "Mechanism solver worker is already active" });
      return;
    }
    const controller = new AbortController();
    active = { requestId: request.requestId, controller };
    void (async () => {
      try {
        const input = JSON.parse(new TextDecoder().decode(request.inputBytes));
        const output = MechanismWorkerOutputSchema.parse(await solve(input, controller.signal));
        if (controller.signal.aborted) throw new DOMException("cancelled", "AbortError");
        const outputBytes = new TextEncoder().encode(JSON.stringify(output));
        post({ type: "succeeded", requestId: request.requestId, outputBytes }, [outputBytes.buffer]);
      } catch (error) {
        if (controller.signal.aborted || error instanceof DOMException && error.name === "AbortError") {
          post({ type: "cancelled", requestId: request.requestId });
        } else post({ type: "failed", requestId: request.requestId, error: messageFor(error).slice(0, 8_192) || "Mechanism solve failed" });
      } finally {
        if (active?.requestId === request.requestId) active = undefined;
      }
    })();
  });
}
