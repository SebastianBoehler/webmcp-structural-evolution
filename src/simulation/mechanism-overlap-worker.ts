import { OcctKernel } from "occt-wasm";
import occtWasmUrl from "occt-wasm/dist/occt-wasm.wasm?url";

import { checkExactInitialOverlapsWithKernel } from "./mechanism-overlap-kernel";
import {
  MechanismOverlapEventSchema, MechanismOverlapRequestSchema, type MechanismOverlapEvent,
  type MechanismOverlapRequest,
} from "./mechanism-overlap-protocol";

interface WorkerScope {
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  postMessage(message: unknown): void;
}
const scope = self as unknown as WorkerScope;
let active: { readonly requestId: string; readonly controller: AbortController } | undefined;
let queue = Promise.resolve();
const post = (event: MechanismOverlapEvent) => scope.postMessage(MechanismOverlapEventSchema.parse(event));
const messageFor = (error: unknown) => error instanceof Error && error.message ? error.message : "Exact overlap worker failed";

async function check(request: Extract<MechanismOverlapRequest, { type: "check-overlap" }>) {
  const controller = new AbortController();
  active = { requestId: request.requestId, controller };
  let kernel: OcctKernel | undefined;
  try {
    kernel = await OcctKernel.init({ wasm: occtWasmUrl });
    await checkExactInitialOverlapsWithKernel(kernel, request.sourceBodies, request.instances, controller.signal);
    post({ type: "succeeded", requestId: request.requestId });
  } catch (error) {
    post(error instanceof DOMException && error.name === "AbortError"
      ? { type: "cancelled", requestId: request.requestId }
      : { type: "failed", requestId: request.requestId, error: messageFor(error) });
  } finally {
    kernel?.[Symbol.dispose]();
    if (active?.requestId === request.requestId) active = undefined;
  }
}

scope.addEventListener("message", ({ data }) => {
  const parsed = MechanismOverlapRequestSchema.safeParse(data);
  if (!parsed.success) return;
  if (parsed.data.type === "cancel") {
    if (active?.requestId === parsed.data.requestId) active.controller.abort();
  } else {
    const request = parsed.data;
    queue = queue.then(() => check(request));
  }
});
