import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import { FakeModelContext, installFakeModelContext } from "../test/fake-model-context";
import { testFoundationContext } from "../test/foundation-context";
import { FoundationTools } from "./FoundationTools";
import type { FoundationServices } from "./executors";
import { foundationToolDefinitions } from "./register-tools";
import type { FoundationProjectState } from "./schemas";
import type { LayoutAuthority } from "../assembly/layout-validation";
import { useAssemblyWorkspace } from "../assembly/use-assembly-workspace";

const revisionA = "a".repeat(64);
const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanup();
  cleanups.splice(0).forEach((dispose) => dispose());
});

function projectState(
  capability: FoundationProjectState["capability"],
  branches: FoundationProjectState["stagedBranches"] = [],
): FoundationProjectState {
  return {
    contextRevision: revisionA,
    context: testFoundationContext(),
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
    "generate_topology_candidate",
    "compare_topology_candidates",
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

test("run execution remains compatible when a pre-options browser omits callback options", async () => {
  const state = projectState({ status: "available", message: "ready" });
  const shared = services(state);
  vi.mocked(shared.runProbe).mockResolvedValue({
    parentRevision: revisionA,
    proposalRevision: "b".repeat(64),
    branchRevision: "c".repeat(64),
    attempt: 1,
    variant: "balanced",
    hypothesis: "Exercise the deterministic balanced",
    prediction: "Verification stays within the probe budget",
    stale: false,
    status: "verified",
  });
  const run = foundationToolDefinitions(shared, state)[1];

  const response = await run.execute({
    parentRevision: revisionA,
    variant: "balanced",
    hypothesis: "Exercise the deterministic balanced",
    prediction: "Verification stays within the probe budget",
  });

  expect(response.isError).toBeUndefined();
  expect(shared.runProbe).toHaveBeenCalledWith(expect.anything(), undefined);
});

test("withholds topology registration while a moved layout is unvalidated", async () => {
  const context = new FakeModelContext();
  cleanups.push(installFakeModelContext(context));
  const state = projectState({ status: "available", message: "ready" });
  const changed: LayoutAuthority = { revision: revisionA, version: 2, state: "changed" };
  const view = render(<FoundationTools services={services(state)} state={state} layoutAuthority={changed} />);

  await waitFor(() => expect([...context.active.keys()]).toEqual(["inspect_design_context"]));
  view.rerender(<FoundationTools services={services(state)} state={state} layoutAuthority={{ ...changed, state: "verified" }} />);
  await waitFor(() => expect(context.active.has("generate_topology_candidate")).toBe(true));
});

test("removes topology authority after a real workspace move until that revision validates", async () => {
  const context = new FakeModelContext();
  cleanups.push(installFakeModelContext(context));
  const workspace = renderHook(() => useAssemblyWorkspace());
  await act(() => workspace.result.current.movePart("motor-east", [118, 14, 3]));
  const state = { ...projectState({ status: "available", message: "ready" }), contextRevision: workspace.result.current.revision };
  const authority = () => ({ revision: workspace.result.current.revision, version: workspace.result.current.layoutVersion, state: workspace.result.current.layoutState });
  const view = render(<FoundationTools services={services(state)} state={state} layoutAuthority={authority()} />);

  await waitFor(() => expect(context.active.has("generate_topology_candidate")).toBe(false));
  await act(async () => { await workspace.result.current.validateLayout(workspace.result.current.layoutVersion); });
  view.rerender(<FoundationTools services={services(state)} state={state} layoutAuthority={authority()} />);
  await waitFor(() => expect(context.active.has("generate_topology_candidate")).toBe(true));
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
  expect(screen.getByText(/1 of 3 structural design tools registered/i)).toBeVisible();

  state = projectState({ status: "available", message: "ready" });
  shared = services(state);
  view.rerender(<FoundationTools services={shared} state={state} />);
  await waitFor(() => expect([...context.active.keys()].sort()).toEqual([
    "generate_topology_candidate",
    "inspect_design_context",
  ]));

  const verified = (suffix: string) => ({
    parentRevision: revisionA,
    proposalRevision: suffix.repeat(64),
    branchRevision: suffix.repeat(64),
    attempt: 1,
    variant: "balanced" as const,
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
    "compare_topology_candidates",
    "generate_topology_candidate",
    "inspect_design_context",
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
    "generate_topology_candidate",
    "compare_topology_candidates",
  ]));

  view.unmount();
  expect(context.active.size).toBe(0);
  expect(context.aborted).toContain("compare_topology_candidates");
});

test("unsupported WebMCP is visible in semantic status", () => {
  const state = projectState({ status: "available", message: "ready" });
  render(<FoundationTools services={services(state)} state={state} />);

  expect(screen.getByText(/webmcp is unavailable/i)).toBeVisible();
});

test("registration status waits for the imperative registration promises", async () => {
  let release!: () => void;
  const context = new FakeModelContext({
    registrationGate: new Promise<void>((resolve) => { release = resolve; }),
  });
  cleanups.push(installFakeModelContext(context));
  const state = projectState({ status: "available", message: "ready" });

  render(<FoundationTools services={services(state)} state={state} />);

  expect(screen.getByText(/0 of 3 structural design tools registered/i)).toBeVisible();
  release();
  await waitFor(() => expect(screen.getByText(/2 of 3 structural design tools registered/i)).toBeVisible());
});

test("registration failures are caught and rendered", async () => {
  const context = new FakeModelContext({ registrationError: new Error("registration denied") });
  cleanups.push(installFakeModelContext(context));
  const state = projectState({ status: "available", message: "ready" });

  render(<FoundationTools services={services(state)} state={state} />);

  expect((await screen.findAllByRole("alert"))[0]?.textContent).toContain("registration denied");
  expect(screen.getByText(/0 of 3 structural design tools registered/i)).toBeVisible();
});

test("StrictMode registers one live dynamic tool set and cleans it without abort leaks", async () => {
  const context = new FakeModelContext();
  cleanups.push(installFakeModelContext(context));
  const state = projectState({ status: "available", message: "ready" });
  const view = render(
    <StrictMode><FoundationTools services={services(state)} state={state} /></StrictMode>,
  );

  await waitFor(() => expect([...context.active.keys()].sort()).toEqual([
    "generate_topology_candidate", "inspect_design_context",
  ]));
  expect(screen.queryByRole("alert")).toBeNull();
  view.unmount();
  expect(context.active.size).toBe(0);
});
