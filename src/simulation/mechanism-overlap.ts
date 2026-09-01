import { createMechanismOverlapClient, type MechanismOverlapWorker } from "./mechanism-overlap-client";
import { preflightExactOverlapPairs } from "./mechanism-overlap-kernel";
import type { ExactPlacedInstance, ExactSourceBody } from "./mechanism-overlap-protocol";

class BrowserMechanismOverlapWorker implements MechanismOverlapWorker {
  private readonly worker = new Worker(new URL("./mechanism-overlap-worker.ts", import.meta.url), { type: "module" });
  postMessage(message: unknown, transfer?: readonly Transferable[]): void {
    this.worker.postMessage(message, transfer ? [...transfer] : []);
  }
  addEventListener(type: "message" | "error" | "messageerror", listener: (event: unknown) => void): void {
    this.worker.addEventListener(type, listener as EventListener);
  }
  removeEventListener(type: "message" | "error" | "messageerror", listener: (event: unknown) => void): void {
    this.worker.removeEventListener(type, listener as EventListener);
  }
  terminate(): void { this.worker.terminate(); }
}

const checkInWorker = createMechanismOverlapClient(() => new BrowserMechanismOverlapWorker());

export async function checkExactInitialOverlaps(
  sourceBodies: readonly ExactSourceBody[],
  instances: readonly ExactPlacedInstance[],
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) throw new DOMException("Mechanism compilation was cancelled", "AbortError");
  if (preflightExactOverlapPairs(instances) === 0) return;
  return checkInWorker(sourceBodies, instances, signal);
}
