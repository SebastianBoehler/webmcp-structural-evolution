import { expect, it, vi } from "vitest";

import {
  observeWebGpuCanvasContainer,
  sizeWebGpuCanvas,
} from "./webgpu-canvas-sizing";

it("tracks a 1280-to-364 parent shrink without writing a self-sized canvas CSS width", () => {
  const parent = document.createElement("section");
  const canvas = document.createElement("canvas");
  parent.append(canvas);
  let width = 1280;
  parent.getBoundingClientRect = () => ({ width, height: 720, x: 0, y: 0,
    top: 0, right: width, bottom: 720, left: 0, toJSON: () => ({}) });
  canvas.getBoundingClientRect = () => parent.getBoundingClientRect();
  let emit!: () => void;
  let observed: Element | undefined;
  const disconnect = vi.fn();
  class Observer {
    constructor(private readonly callback: ResizeObserverCallback) {
      emit = () => this.callback([{ contentRect: parent.getBoundingClientRect() } as ResizeObserverEntry], this as never);
    }
    observe(target: Element) { observed = target; }
    disconnect = disconnect;
    unobserve() {}
  }
  const setSize = vi.fn((nextWidth: number, nextHeight: number, updateStyle?: boolean) => {
    canvas.width = nextWidth;
    canvas.height = nextHeight;
    if (updateStyle !== false) canvas.style.width = `${nextWidth}px`;
  });
  const setPixelRatio = vi.fn();
  const callback = vi.fn((nextWidth: number, nextHeight: number) =>
    sizeWebGpuCanvas({ setSize, setPixelRatio }, nextWidth, nextHeight));
  const observation = observeWebGpuCanvasContainer(canvas, callback, Observer as never);

  expect(observed).toBe(parent);
  emit();
  width = 364;
  emit();
  expect(setSize).toHaveBeenLastCalledWith(364, 720, false);
  expect(canvas.style.width).toBe("");
  expect(canvas.getBoundingClientRect().width).toBe(364);
  observation.disconnect();
  expect(disconnect).toHaveBeenCalledOnce();
});

it("uses a normal device pixel ratio for the drawing buffer without changing CSS size", () => {
  const setPixelRatio = vi.fn();
  const setSize = vi.fn();

  sizeWebGpuCanvas({ setPixelRatio, setSize }, 640, 360, 1);

  expect(setPixelRatio).toHaveBeenCalledWith(1);
  expect(setSize).toHaveBeenCalledWith(640, 360, false);
});

it("uses a Retina device pixel ratio for the drawing buffer", () => {
  const setPixelRatio = vi.fn();
  const setSize = vi.fn();

  sizeWebGpuCanvas({ setPixelRatio, setSize }, 640, 360, 1.5);

  expect(setPixelRatio).toHaveBeenCalledWith(1.5);
  expect(setSize).toHaveBeenCalledWith(640, 360, false);
});

it("clamps an oversized device pixel ratio at the rendering budget", () => {
  const setPixelRatio = vi.fn();
  const setSize = vi.fn();

  sizeWebGpuCanvas({ setPixelRatio, setSize }, 640, 360, 3);

  expect(setPixelRatio).toHaveBeenCalledWith(2);
  expect(setSize).toHaveBeenCalledWith(640, 360, false);
});

it.each([Number.NaN, Number.POSITIVE_INFINITY, 0, -1])
  ("falls back to one for an invalid device pixel ratio (%s)", (devicePixelRatio) => {
    const setPixelRatio = vi.fn();
    const setSize = vi.fn();

    sizeWebGpuCanvas({ setPixelRatio, setSize }, 640, 360, devicePixelRatio);

    expect(setPixelRatio).toHaveBeenCalledWith(1);
    expect(setSize).toHaveBeenCalledWith(640, 360, false);
  });
