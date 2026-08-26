import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { FakeModelContext, installFakeModelContext } from "../test/fake-model-context";
import { FoundationTools } from "./FoundationTools";
import type { FoundationServices } from "./executors";
import { foundationToolDefinitions } from "./register-tools";
import type { FoundationProjectState } from "./schemas";

const revisionA = "a".repeat(64);
const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function projectState(
  capability: FoundationProjectState["capability"],
  branches: FoundationProjectState["stagedBranches"] = [],
): FoundationProjectState {
  return {
    contextRevision: revisionA,
    selection: { id: "motor-arm", label: "Motor arm" },
    locks: ["body-mount"],
    acceptedBranchRevision: revisionA,
    stagedBranches: branches,
    capability,
    operationStatus: "idle",
    receipts: [],
  };
}

function services(state: FoundationProjectState): FoundationServices {
  return {
    inspectContext: vi.fn(async () => ({
      ...state,
      stagedBranchCount: state.stagedBranches.length,
      omittedBranchCount: 0,
      stale: state.stagedBranches.some((branch) => branch.stale),
      nextActions: ["inspect_design_context"],
    })),
    runProbe: vi.fn(),
    compareProbes: vi.fn(),
    canCompare: vi.fn(() => false),
    cancelProbe: vi.fn(async () => { throw new Error("not running"); }),
    recordRejectedCall: vi.fn(async () => undefined),
  };
}

test("definitions are exactly three narrow annotated tools within Chrome budgets", () => {
  const state = projectState({ status: "available", message: "ready" });
  const definitions = foundationToolDefinitions(services(state), state);

  expect(definitions.map(({ name }) => name)).toEqual([
    "inspect_design_context",
    "run_foundation_probe",
    "compare_foundation_probes",
  ]);
  expect(definitions.every(({ name, description }) => name.length <= 30 && description.length <= 500)).toBe(true);
  for (const definition of definitions) {
    const schema = definition.inputSchema as {
      additionalProperties?: boolean;
      required?: string[];
      properties?: Record<string, { description?: string }>;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required?.length).toBeGreaterThan(0);
    expect(Object.entries(schema.properties ?? {}).every(([name, property]) =>
      name.length <= 30 && (property.description?.length ?? 0) <= 150,
    )).toBe(true);
    expect(definition.annotations.untrustedContentHint).toBe(true);
  }
  expect(definitions[0]?.annotations.readOnlyHint).toBe(true);
  expect(definitions[1]?.annotations.readOnlyHint).toBe(false);
  expect(definitions[2]?.annotations.readOnlyHint).toBe(true);
  expect(JSON.stringify(definitions)).not.toMatch(/promoteBranch|exposedTo|provenance/i);
});

test("actual hook lifecycle enables state-valid tools and unregisters them", async () => {
  const context = new FakeModelContext();
  cleanups.push(installFakeModelContext(context));
  let state = projectState({
    status: "unavailable",
    code: "api-unavailable",
    message: "WebGPU unavailable",
  });
  let shared = services(state);
  const view = render(<FoundationTools services={shared} state={state} />);

  await waitFor(() => expect([...context.active.keys()]).toEqual(["inspect_design_context"]));
  expect(screen.getByText(/1 of 3 foundation tools registered/i)).toBeVisible();

  state = projectState({ status: "available", message: "ready" });
  shared = services(state);
  view.rerender(<FoundationTools services={shared} state={state} />);
  await waitFor(() => expect([...context.active.keys()].sort()).toEqual([
    "inspect_design_context",
    "run_foundation_probe",
  ]));

  const verified = (suffix: string) => ({
    parentRevision: revisionA,
    proposalRevision: suffix.repeat(64),
    branchRevision: suffix.repeat(64),
    attempt: 1,
    variant: "baseline" as const,
    hypothesis: `Probe ${suffix}`,
    prediction: "Verification stays within the probe budget",
    stale: false,
    status: "verified" as const,
    measurement: {
      status: "verified" as const,
      elapsedMs: 8,
      relativeL2: 0,
      resultDigest: suffix.repeat(64),
    },
    result: {
      status: "verified" as const,
      elapsedMs: 8,
      relativeL2: 0,
      tolerance: 0.000005,
      output: new Float32Array([1]),
    },
  });
  state = projectState({ status: "available", message: "ready" }, [verified("b"), verified("c")]);
  shared = services(state);
  view.rerender(<FoundationTools services={shared} state={state} />);
  await waitFor(() => expect([...context.active.keys()].sort()).toEqual([
    "compare_foundation_probes",
    "inspect_design_context",
    "run_foundation_probe",
  ]));

  state = projectState({
    status: "unavailable",
    code: "api-unavailable",
    message: "WebGPU unavailable",
  }, [verified("b"), { ...verified("c"), stale: true }]);
  shared = services(state);
  view.rerender(<FoundationTools services={shared} state={state} />);
  await waitFor(() => expect([...context.active.keys()]).toEqual(["inspect_design_context"]));
  expect(context.aborted).toEqual(expect.arrayContaining([
    "run_foundation_probe",
    "compare_foundation_probes",
  ]));

  view.unmount();
  expect(context.active.size).toBe(0);
  expect(context.aborted).toContain("compare_foundation_probes");
});

test("unsupported WebMCP is visible in semantic status", () => {
  const state = projectState({ status: "available", message: "ready" });
  render(<FoundationTools services={services(state)} state={state} />);

  expect(screen.getByText(/webmcp is unavailable/i)).toBeVisible();
});
