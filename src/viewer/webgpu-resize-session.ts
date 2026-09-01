export interface WebGpuResizeSession { dispose(): void }

export interface WebGpuResizeOptions {
  readonly observe: (
    callback: (width: number, height: number) => void,
  ) => { disconnect(): void };
  readonly requestFrame: (callback: () => void) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly onResize: (width: number, height: number) => void;
  readonly render: () => void;
}

export function createWebGpuResizeSession(
  options: WebGpuResizeOptions,
): WebGpuResizeSession {
  let disposed = false;
  let frame: number | undefined;
  let latest: readonly [number, number] | undefined;
  const observer = options.observe((width, height) => {
    if (disposed || !Number.isFinite(width) || !Number.isFinite(height)
      || width <= 0 || height <= 0) return;
    latest = [width, height];
    if (frame !== undefined) return;
    frame = options.requestFrame(() => {
      frame = undefined;
      if (disposed || !latest) return;
      options.onResize(...latest);
      options.render();
    });
  });
  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      if (frame !== undefined) {
        options.cancelFrame(frame);
        frame = undefined;
      }
    },
  };
}
