import { expect, it, vi } from "vitest";

import { createWebGpuResizeSession } from "./webgpu-resize-session";

it("coalesces narrow resize rendering and disconnects/cancels exactly once", () => {
  let observed!: (width: number, height: number) => void;
  let frame: (() => void) | undefined;
  const disconnect = vi.fn();
  const cancel = vi.fn();
  const onResize = vi.fn();
  const render = vi.fn();
  const session = createWebGpuResizeSession({
    observe(callback) {
      observed = callback;
      return { disconnect };
    },
    requestFrame(callback) { frame = callback; return 17; },
    cancelFrame: cancel,
    onResize,
    render,
  });

  observed(1440, 900);
  observed(390, 780);
  expect(onResize).not.toHaveBeenCalled();
  frame?.();
  expect(onResize).toHaveBeenCalledOnce();
  expect(onResize).toHaveBeenCalledWith(390, 780);
  expect(render).toHaveBeenCalledOnce();

  observed(400, 800);
  session.dispose();
  session.dispose();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalledOnce();
  frame?.();
  expect(render).toHaveBeenCalledOnce();
});
