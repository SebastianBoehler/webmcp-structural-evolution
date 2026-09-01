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
  const callback = vi.fn((nextWidth: number, nextHeight: number) =>
    sizeWebGpuCanvas({ setSize }, nextWidth, nextHeight));
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
