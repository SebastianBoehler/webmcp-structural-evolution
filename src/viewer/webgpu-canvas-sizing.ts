import { normalizeRenderDpr } from "./render-resolution";

interface RendererSizeTarget {
  setSize(width: number, height: number, updateStyle?: boolean): void;
  setPixelRatio(value: number): void;
}

type ObserverConstructor = new (
  callback: ResizeObserverCallback,
) => Pick<ResizeObserver, "observe" | "disconnect">;

function currentDevicePixelRatio(): number {
  return typeof window === "undefined" ? 1 : window.devicePixelRatio;
}

function subscribeToDprMediaChanges(onChange: () => void): (() => void) | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
  let query: MediaQueryList | undefined;
  let removeListener: (() => void) | undefined;
  let disposed = false;
  const onMediaChange = () => {
    removeListener?.();
    removeListener = undefined;
    query = undefined;
    try {
      onChange();
    } finally {
      if (!disposed) subscribe();
    }
  };
  const subscribe = () => {
    const rawDpr = currentDevicePixelRatio();
    const queryDpr = Number.isFinite(rawDpr) && rawDpr > 0 ? rawDpr : 1;
    const nextQuery = window.matchMedia(`(resolution: ${queryDpr}dppx)`);
    if (typeof nextQuery.addEventListener === "function") {
      nextQuery.addEventListener("change", onMediaChange);
      query = nextQuery;
      removeListener = () => nextQuery.removeEventListener("change", onMediaChange);
    } else if (typeof nextQuery.addListener === "function") {
      nextQuery.addListener(onMediaChange);
      query = nextQuery;
      removeListener = () => nextQuery.removeListener(onMediaChange);
    }
  };
  subscribe();
  if (!removeListener) return undefined;
  return () => {
    disposed = true;
    removeListener?.();
    removeListener = undefined;
    query = undefined;
  };
}

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
  let disconnected = false;
  const observer = new Observer(([entry]) => {
    if (!disconnected && entry) callback(entry.contentRect.width, entry.contentRect.height);
  });
  observer.observe(container);
  let lastRenderDpr = normalizeRenderDpr(currentDevicePixelRatio());
  let pixelObserver: Pick<ResizeObserver, "observe" | "disconnect"> | undefined;
  let listeningForWindowResize = false;
  let stopDprMediaChanges: (() => void) | undefined;
  const onDprCandidate = () => {
    if (disconnected) return;
    const nextRenderDpr = normalizeRenderDpr(currentDevicePixelRatio());
    if (nextRenderDpr === lastRenderDpr) return;
    lastRenderDpr = nextRenderDpr;
    const rect = container.getBoundingClientRect();
    callback(rect.width, rect.height);
  };
  try {
    pixelObserver = new Observer(() => onDprCandidate());
    pixelObserver.observe(canvas, { box: "device-pixel-content-box" });
  } catch (error) {
    if (!(error instanceof TypeError)) {
      pixelObserver?.disconnect();
      observer.disconnect();
      throw error;
    }
    pixelObserver?.disconnect();
    pixelObserver = undefined;
    if (typeof window !== "undefined") {
      stopDprMediaChanges = subscribeToDprMediaChanges(onDprCandidate);
      if (!stopDprMediaChanges) {
        window.addEventListener("resize", onDprCandidate);
        listeningForWindowResize = true;
      }
    }
  }
  return {
    disconnect() {
      if (disconnected) return;
      disconnected = true;
      observer.disconnect();
      pixelObserver?.disconnect();
      stopDprMediaChanges?.();
      if (listeningForWindowResize) window.removeEventListener("resize", onDprCandidate);
      pixelObserver = undefined;
      stopDprMediaChanges = undefined;
      listeningForWindowResize = false;
    },
  };
}
