import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const gpu = vi.hoisted(() => ({ acquire: vi.fn(), createRenderer: vi.fn() }));
vi.mock("../viewer/webgpu-renderer-helpers", async (original) => ({
  ...await original<typeof import("../viewer/webgpu-renderer-helpers")>(),
  acquireBrowserDevice: gpu.acquire,
}));
vi.mock("../viewer/three-webgpu-renderer", () => ({ createThreeWebGpuRenderer: gpu.createRenderer }));

import { ThermalFieldViewport } from "./ThermalFieldViewport";

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function device() {
  const loss = deferred<{ reason: string; message: string }>();
  return { lost: loss.promise, destroy: vi.fn(), loss };
}

function renderer() {
  return { render: vi.fn(async () => new Blob(["capture"])), present: vi.fn(async () => undefined), dispose: vi.fn(),
    onDeviceLost: vi.fn(), setInteractionHandlers: vi.fn() };
}

const thermalResult = { grid: { cellDimensions: [1, 1, 1], originM: [0, 0, 0], cellSizeM: .01 },
  temperatureK: new Float32Array([300]), heatFluxWm2: new Float32Array([1, 0, 0]) };
const session = { report: { status: "passed", sourceRevision: "a".repeat(64) },
  benchmark: { request: { input: { voxelPayload: { activeCells: new Uint8Array([1]) } } } },
  output: { result: thermalResult } } as never;

beforeEach(() => { gpu.acquire.mockReset(); gpu.createRenderer.mockReset(); });
afterEach(cleanup);

test("real viewport device loss invalidates ready state and retry reacquires once", async () => {
  const firstDevice = device(), secondDevice = device();
  const firstRenderer = renderer(), secondRenderer = renderer();
  gpu.acquire.mockResolvedValueOnce(firstDevice).mockResolvedValueOnce(secondDevice);
  gpu.createRenderer.mockResolvedValueOnce(firstRenderer).mockResolvedValueOnce(secondRenderer);
  render(<ThermalFieldViewport session={session}/>);
  await screen.findByRole("img", { name: /verified cobot temperature/i });

  firstDevice.loss.resolve({ reason: "unknown", message: "physical device lost" });
  expect((await screen.findByRole("alert")).textContent).toMatch(/physical device lost/i);
  expect(screen.queryByLabelText(/verified cobot/i)).toBeNull();
  expect(firstRenderer.dispose).toHaveBeenCalledOnce();
  expect(firstDevice.destroy).toHaveBeenCalledOnce();

  fireEvent.click(screen.getByRole("button", { name: /retry viewport/i }));
  expect(await screen.findByRole("img", { name: /verified cobot temperature/i })).toBeVisible();
  expect(gpu.acquire).toHaveBeenCalledTimes(2);
  expect(gpu.createRenderer).toHaveBeenCalledTimes(2);
  expect(firstRenderer.dispose).toHaveBeenCalledOnce();
  expect(firstDevice.destroy).toHaveBeenCalledOnce();
});

test("retry after initial acquisition failure mounts the identical layer on one new device", async () => {
  const recoveredDevice = device(), recoveredRenderer = renderer();
  gpu.acquire.mockRejectedValueOnce(new Error("adapter unavailable"))
    .mockResolvedValueOnce(recoveredDevice);
  gpu.createRenderer.mockResolvedValueOnce(recoveredRenderer);
  render(<ThermalFieldViewport session={session}/>);
  expect((await screen.findByRole("alert")).textContent).toMatch(/adapter unavailable/i);

  fireEvent.click(screen.getByRole("button", { name: /retry viewport/i }));
  expect(await screen.findByRole("img", { name: /verified cobot temperature/i })).toBeVisible();
  expect(gpu.acquire).toHaveBeenCalledTimes(2);
  expect(gpu.createRenderer).toHaveBeenCalledOnce();
});

test("unmount during reacquisition disposes the late recovered generation exactly once", async () => {
  const firstDevice = device(), lateDevice = device();
  const firstRenderer = renderer(), lateRenderer = renderer();
  const lateAcquire = deferred<never>();
  gpu.acquire.mockResolvedValueOnce(firstDevice).mockReturnValueOnce(lateAcquire.promise);
  gpu.createRenderer.mockResolvedValueOnce(firstRenderer).mockResolvedValueOnce(lateRenderer);
  const view = render(<ThermalFieldViewport session={session}/>);
  await screen.findByRole("img", { name: /verified cobot temperature/i });
  firstDevice.loss.resolve({ reason: "unknown", message: "lost before retry" });
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: /retry viewport/i }));
  await waitFor(() => expect(gpu.acquire).toHaveBeenCalledTimes(2));
  view.unmount();
  lateAcquire.resolve(lateDevice as never);

  await waitFor(() => expect(lateRenderer.dispose).toHaveBeenCalledOnce());
  expect(lateDevice.destroy).toHaveBeenCalledOnce();
  expect(firstRenderer.dispose).toHaveBeenCalledOnce();
  expect(firstDevice.destroy).toHaveBeenCalledOnce();
});
