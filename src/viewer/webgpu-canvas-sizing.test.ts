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
  let emitContainer!: () => void;
  let observed: Element | undefined;
  const disconnect = vi.fn();
  class Observer {
    constructor(private readonly callback: ResizeObserverCallback) {
      const emit = () => this.callback([{ contentRect: parent.getBoundingClientRect() } as ResizeObserverEntry], this as never);
      if (!emitContainer) emitContainer = emit;
    }
    observe(target: Element) { if (!observed) observed = target; }
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
  emitContainer();
  width = 364;
  emitContainer();
  expect(setSize).toHaveBeenLastCalledWith(364, 720, false);
  expect(canvas.style.width).toBe("");
  expect(canvas.getBoundingClientRect().width).toBe(364);
  observation.disconnect();
  expect(disconnect).toHaveBeenCalledTimes(2);
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

it("reconfigures on a device-pixel-only DPR change without changing CSS bounds", () => {
  const parent = document.createElement("section");
  const canvas = document.createElement("canvas");
  parent.append(canvas);
  parent.getBoundingClientRect = () => ({ width: 640, height: 360, x: 0, y: 0,
    top: 0, right: 640, bottom: 360, left: 0, toJSON: () => ({}) });
  const observers: Array<{
    readonly target?: Element;
    readonly options?: ResizeObserverOptions;
    emit(): void;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  class Observer {
    private callback: ResizeObserverCallback;
    target?: Element;
    options?: ResizeObserverOptions;
    disconnect = vi.fn();
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      observers.push(this);
    }
    observe(target: Element, options?: ResizeObserverOptions) {
      this.target = target;
      this.options = options;
    }
    emit() {
      this.callback([], this as never);
    }
  }
  const setPixelRatio = vi.fn();
  const setSize = vi.fn();
  const callback = vi.fn((width: number, height: number) =>
    sizeWebGpuCanvas({ setPixelRatio, setSize }, width, height));
  const originalDpr = window.devicePixelRatio;
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });

  try {
    const observation = observeWebGpuCanvasContainer(canvas, callback, Observer as never);
    const dprObserver = observers.find(({ target }) => target === canvas);
    expect(dprObserver?.options).toEqual({ box: "device-pixel-content-box" });

    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
    dprObserver?.emit();

    expect(callback).toHaveBeenCalledWith(640, 360);
    expect(setPixelRatio).toHaveBeenLastCalledWith(2);
    expect(setSize).toHaveBeenLastCalledWith(640, 360, false);
    expect(canvas.style.width).toBe("");
    expect(canvas.style.height).toBe("");
    observation.disconnect();
    observation.disconnect();
    dprObserver?.emit();
    expect(callback).toHaveBeenCalledOnce();
    expect(observers).toHaveLength(2);
    expect(observers.every(({ disconnect }) => disconnect.mock.calls.length === 1)).toBe(true);
  } finally {
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: originalDpr });
  }
});

it("falls back to a window resize DPR check when device-pixel observation is unsupported", () => {
  const parent = document.createElement("section");
  const canvas = document.createElement("canvas");
  parent.append(canvas);
  parent.getBoundingClientRect = () => ({ width: 640, height: 360, x: 0, y: 0,
    top: 0, right: 640, bottom: 360, left: 0, toJSON: () => ({}) });
  let observeCount = 0;
  class UnsupportedObserver {
    disconnect = vi.fn();
    constructor(private readonly callback: ResizeObserverCallback) {}
    observe(_target: Element, options?: ResizeObserverOptions) {
      observeCount += 1;
      if (options) throw new TypeError("device-pixel-content-box is unsupported");
    }
    emit() { this.callback([], this as never); }
  }
  const addEventListener = vi.spyOn(window, "addEventListener");
  const removeEventListener = vi.spyOn(window, "removeEventListener");
  const setPixelRatio = vi.fn();
  const setSize = vi.fn();
  const callback = vi.fn((width: number, height: number) =>
    sizeWebGpuCanvas({ setPixelRatio, setSize }, width, height));
  const originalDpr = window.devicePixelRatio;
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 1 });

  try {
    const observation = observeWebGpuCanvasContainer(
      canvas, callback, UnsupportedObserver as never,
    );
    expect(observeCount).toBe(2);
    const resizeListener = addEventListener.mock.calls
      .find(([type]) => (type as string) === "resize")?.[1];
    expect(resizeListener).toEqual(expect.any(Function));

    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });
    window.dispatchEvent(new Event("resize"));

    expect(callback).toHaveBeenCalledWith(640, 360);
    expect(setPixelRatio).toHaveBeenLastCalledWith(2);
    expect(setSize).toHaveBeenLastCalledWith(640, 360, false);
    observation.disconnect();
    expect(removeEventListener).toHaveBeenCalledWith("resize", resizeListener);
  } finally {
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: originalDpr });
  }
});
