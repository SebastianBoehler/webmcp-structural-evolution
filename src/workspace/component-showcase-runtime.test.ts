import { expect, test, vi } from "vitest";

import { se6UpperArmDocument } from "../models/component-documents";
import type { SolverAdapter } from "../engineering/solver-adapter";
import { runComponentStudy } from "./component-showcase-runtime";

const seam = vi.hoisted(() => ({ subscribed: undefined as undefined | (() => void) }));
vi.mock("./engineering-workspace-service", () => ({
  createEngineeringWorkspaceService: () => ({
    launchStudy: vi.fn(async () => ({ jobId: "component-job" })),
    inspectJob: vi.fn(() => ({ event: { state: "running", jobId: "component-job" } })),
    subscribe: vi.fn(() => { seam.subscribed?.(); return () => undefined; }),
    cancelJob: vi.fn(async () => { throw new Error("component cancellation failed"); }),
    dispose: vi.fn(),
  }),
}));

test("surfaces a workspace cancellation failure instead of hanging the component study", async () => {
  let subscribed!: () => void;
  const ready = new Promise<void>((resolve) => { subscribed = resolve; });
  seam.subscribed = subscribed;
  const model = await se6UpperArmDocument();
  const adapter = { capability: { kind: "thermal" }, supports: () => ({ supported: true }),
    async run() { throw new Error("adapter must not run at this seam"); } } satisfies SolverAdapter<unknown, unknown>;
  const controller = new AbortController();
  const pending = runComponentStudy(model, "se6-upper-arm-thermal", adapter, controller.signal);
  await ready;
  controller.abort(new DOMException("stop component", "AbortError"));

  const outcome = await Promise.race([
    pending.then(() => "resolved", (error: unknown) => error instanceof Error ? error.message : String(error)),
    new Promise<string>((resolve) => setTimeout(() => resolve("hung"), 50)),
  ]);
  expect(outcome).toBe("component cancellation failed");
});
