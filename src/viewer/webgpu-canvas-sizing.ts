import { normalizeRenderDpr } from "./render-resolution";

interface RendererSizeTarget {
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setPixelRatio(value: number): void;
}

type ObserverConstructor = new (
  callback: ResizeObserverCallback,
) => Pick<ResizeObserver, "observe" | "disconnect">;

export function sizeWebGpuCanvas(
  renderer: RendererSizeTarget,
  width: number,
  height: number,
  devicePixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio,
): void {
  renderer.setPixelRatio(normalizeRenderDpr(devicePixelRatio));
  renderer.setSize(Math.max(1, width), Math.max(1, height), false);
}

export function observeWebGpuCanvasContainer(
  canvas: HTMLCanvasElement,
  callback: (width: number, height: number) => void,
  Observer: ObserverConstructor = ResizeObserver,
): Pick<ResizeObserver, "disconnect"> {
  const container = canvas.parentElement;
  if (!container) throw new Error("WebGPU canvas requires an owning viewport container.");
  canvas.style.removeProperty("width");
  canvas.style.removeProperty("height");
  const observer = new Observer(([entry]) => {
    if (entry) callback(entry.contentRect.width, entry.contentRect.height);
  });
  observer.observe(container);
  return observer;
}
