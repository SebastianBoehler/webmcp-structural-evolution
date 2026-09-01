import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ThermalFieldViewport } from "./ThermalFieldViewport";
import type { ViewerRenderModel } from "../viewer/render-model-types";

const semantic = vi.hoisted(() => ({ mount: vi.fn() }));
vi.mock("../viewer/semantic-field-session", () => ({ mountSemanticFieldSession: semantic.mount }));

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const thermalResult = { grid: { cellDimensions: [2, 1, 1], originM: [.001, .002, .003], cellSizeM: .01 },
  temperatureK: new Float32Array([300, 320]), heatFluxWm2: new Float32Array([1, 0, 0, 2, 0, 0]) };
const session = {
  report: { sourceRevision: "a".repeat(64) },
  benchmark: { request: { input: { voxelPayload: { activeCells: new Uint8Array([1, 1]) } } } },
  output: { result: thermalResult },
} as never;

beforeEach(() => semantic.mount.mockReset());
afterEach(cleanup);

test("labels a thermal layer verified only after its first successful capture", async () => {
  const pending = deferred<never>();
  semantic.mount.mockReturnValue(pending.promise);
  render(<ThermalFieldViewport session={session}/>);

  expect(screen.getByRole("status").textContent).toMatch(/viewport initializing/i);
  expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/initializing.*temperature/i);
  expect(screen.queryByLabelText(/verified cobot temperature/i)).toBeNull();

  const mounted = { dispose: vi.fn(), updateModel: vi.fn(async () => undefined) };
  pending.resolve(mounted as never);
  expect(await screen.findByRole("img", { name: /verified cobot temperature/i })).toBeVisible();
  expect(screen.getByRole("status").textContent).toMatch(/temperature viewport ready/i);
});

test("surfaces initial capture failure and never implies viewport verification", async () => {
  const pending = deferred<never>();
  let captureFailed!: () => void;
  semantic.mount.mockImplementation((...args: unknown[]) => {
    const lifecycle = args[5] as (event: unknown) => void;
    captureFailed = () => lifecycle({ revision: args[2], state: "error",
      error: new Error("WebGPU device lost during initial capture") });
    return pending.promise;
  });
  const view = render(<ThermalFieldViewport session={session}/>);
  await waitFor(() => expect(semantic.mount).toHaveBeenCalledOnce());
  captureFailed();

  expect((await screen.findByRole("alert")).textContent).toMatch(/device lost/i);
  expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/failed.*temperature/i);
  expect(screen.queryByLabelText(/verified cobot/i)).toBeNull();
  view.unmount();
  const mounted = { dispose: vi.fn(), updateModel: vi.fn() };
  pending.resolve(mounted as never);
  await waitFor(() => expect(mounted.dispose).toHaveBeenCalledOnce());
});

test("rapid layer toggles replay only the latest model and ignore stale capture outcomes", async () => {
  const mount = deferred<never>();
  semantic.mount.mockReturnValue(mount.promise);
  render(<ThermalFieldViewport session={session}/>);
  fireEvent.click(screen.getByRole("button", { name: "Heat-flux field" }));
  const mounted = { dispose: vi.fn(), updateModel: vi.fn(async () => undefined) };
  mount.resolve(mounted as never);

  await waitFor(() => expect(mounted.updateModel).toHaveBeenCalledOnce());
  expect((mounted.updateModel.mock.calls as unknown[][])[0]?.[1]).toContain("heat-flux");
  expect(await screen.findByRole("img", { name: /verified cobot heat-flux/i })).toBeVisible();
  expect(semantic.mount).toHaveBeenCalledOnce();
});

test("stale capture success or failure cannot overwrite the latest pending layer", async () => {
  const updates = [deferred<void>(), deferred<void>()];
  const mounted = { dispose: vi.fn(), updateModel: vi.fn()
    .mockReturnValueOnce(updates[0]!.promise).mockReturnValueOnce(updates[1]!.promise) };
  semantic.mount.mockResolvedValue(mounted);
  render(<ThermalFieldViewport session={session}/>);
  await screen.findByRole("img", { name: /verified cobot temperature/i });

  fireEvent.click(screen.getByRole("button", { name: "Heat-flux field" }));
  fireEvent.click(screen.getByRole("button", { name: "Temperature field" }));
  await waitFor(() => expect(mounted.updateModel).toHaveBeenCalledOnce());
  expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/initializing.*temperature/i);
  updates[0]!.reject(new Error("stale flux capture failed"));
  await waitFor(() => expect(mounted.updateModel).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("img").getAttribute("aria-label")).toMatch(/initializing.*temperature/i);
  updates[1]!.resolve();
  expect(await screen.findByRole("img", { name: /verified cobot temperature/i })).toBeVisible();
});

test("synchronous update rejection is visible and clears verified state", async () => {
  const mounted = { dispose: vi.fn(), updateModel: vi.fn(() => { throw new Error("invalid flux model"); }) };
  semantic.mount.mockResolvedValue(mounted);
  render(<ThermalFieldViewport session={session}/>);
  await screen.findByRole("img", { name: /verified cobot temperature/i });
  fireEvent.click(screen.getByRole("button", { name: "Heat-flux field" }));

  expect((await screen.findByRole("alert")).textContent).toMatch(/invalid flux model/i);
  expect(screen.queryByLabelText(/verified cobot heat-flux/i)).toBeNull();
});

test("retries an identical failed layer without reacquiring the session", async () => {
  const mounted = { dispose: vi.fn(), updateModel: vi.fn()
    .mockRejectedValueOnce(new Error("capture failed")).mockResolvedValueOnce(undefined) };
  semantic.mount.mockResolvedValue(mounted);
  render(<ThermalFieldViewport session={session}/>);
  await screen.findByRole("img", { name: /verified cobot temperature/i });
  fireEvent.click(screen.getByRole("button", { name: "Heat-flux field" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: /retry viewport/i }));
  expect(await screen.findByRole("img", { name: /verified cobot heat-flux/i })).toBeVisible();
  expect(mounted.updateModel).toHaveBeenCalledTimes(2);
  expect(semantic.mount).toHaveBeenCalledOnce();
});

test("a device-loss callback invalidates an already ready layer", async () => {
  const mounted = { dispose: vi.fn(), updateModel: vi.fn(async () => undefined) };
  let reportDeviceLoss!: (error: unknown) => void;
  semantic.mount.mockImplementation(async (
    _canvas: HTMLCanvasElement, _model: ViewerRenderModel, _revision: string,
    onError: (error: unknown) => void,
  ) => { reportDeviceLoss = onError; return mounted; });
  render(<ThermalFieldViewport session={session}/>);
  await screen.findByRole("img", { name: /verified cobot temperature/i });
  reportDeviceLoss(new Error("WebGPU device lost"));
  expect((await screen.findByRole("alert")).textContent).toMatch(/device lost/i);
  expect(screen.queryByLabelText(/verified cobot/i)).toBeNull();
});

test("unmount disposes a late session once without resurrecting ready state", async () => {
  const pending = deferred<never>();
  semantic.mount.mockReturnValue(pending.promise);
  const view = render(<ThermalFieldViewport session={session}/>);
  view.unmount();
  const mounted = { dispose: vi.fn(), updateModel: vi.fn() };
  pending.resolve(mounted as never);
  await waitFor(() => expect(mounted.dispose).toHaveBeenCalledOnce());
  expect(semantic.mount).toHaveBeenCalledOnce();
});

test("converts the thermal grid once and leaves flux vectors in physical units", async () => {
  const mounted = { dispose: vi.fn(), updateModel: vi.fn(async () => undefined) };
  semantic.mount.mockResolvedValue(mounted);
  render(<ThermalFieldViewport session={session}/>);
  await screen.findByRole("img", { name: /verified cobot temperature/i });
  const mountedModel = (semantic.mount.mock.calls as unknown[][])[0]![1] as ViewerRenderModel;
  expect(mountedModel.grid.cellSize).toEqual([10, 10, 10]);
  expect(mountedModel.grid.anchor.position).toEqual([1, 2, 3]);
  fireEvent.click(screen.getByRole("button", { name: "Heat-flux field" }));
  await screen.findByRole("img", { name: /verified cobot heat-flux/i });
  const fluxModel = (mounted.updateModel.mock.calls as unknown[][]).at(-1)?.[0] as ViewerRenderModel;
  expect(fluxModel.analysisField?.vectors).toBe(thermalResult.heatFluxWm2);
});
