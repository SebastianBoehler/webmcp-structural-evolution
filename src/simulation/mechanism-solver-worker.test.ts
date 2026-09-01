import { expect, test, vi } from "vitest";

import { MechanismSolverEventSchema } from "./mechanism-solver-protocol";
import { MechanismWorkerOutputSchema } from "./mechanism-solver-output";
import {
  MECHANISM_ENGINE_VERSION, MECHANISM_RUNTIME_VERSION, MECHANISM_SOLVER_BUILD_DIGEST,
  MECHANISM_WASM_MODULE_DIGEST,
} from "./mechanism-solver-provenance";
import { mechanismSolverInput } from "./mechanism-solver.test-support";

test("runs the pinned deterministic Rapier build inside the worker composition", async () => {
  const messages: unknown[] = [];
  let listener: ((event: { readonly data: unknown }) => void) | undefined;
  vi.spyOn(self, "postMessage").mockImplementation((value: unknown) => { messages.push(value); });
  vi.spyOn(self, "addEventListener").mockImplementation((type: string, value: EventListenerOrEventListenerObject) => {
    if (type === "message" && typeof value === "function") listener = value as unknown as typeof listener;
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("worker-artifact", { status: 200 })));
  await import("./mechanism-solver-worker");
  const input = await mechanismSolverInput();
  listener!({ data: { type: "solve-mechanism", requestId: "actual-worker",
    inputBytes: new TextEncoder().encode(JSON.stringify(input)) } });
  await vi.waitFor(() => expect(messages).toHaveLength(1));
  const event = MechanismSolverEventSchema.parse(messages[0]);
  if (event.type !== "succeeded") throw new Error(`unexpected worker terminal: ${JSON.stringify(event)}`);
  const output = MechanismWorkerOutputSchema.parse(JSON.parse(new TextDecoder().decode(event.outputBytes)));
  expect(output.evidence).toMatchObject({
    engineVersion: MECHANISM_ENGINE_VERSION, runtimeVersion: MECHANISM_RUNTIME_VERSION,
    solverBuildDigest: MECHANISM_SOLVER_BUILD_DIGEST, wasmModuleDigest: MECHANISM_WASM_MODULE_DIGEST,
    workerArtifactDigest: "876c82768bebbd3567d4813fe4f08f85714a34e093228994bef03ef7982a5991",
  });
  vi.unstubAllGlobals();
});
