import type { ViewportGpuDevice } from "./webgpu-renderer-types";

export interface RenderEnvelope {
  readonly target: readonly [number, number, number];
  readonly span: number;
}

export function abortError(): DOMException {
  return new DOMException("Viewport capture was canceled.", "AbortError");
}

export function blobFromCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error("WebGPU capture encoding failed."));
    }, "image/png");
  });
}

export function renderEnvelope(
  minimum: readonly number[],
  maximum: readonly number[],
): RenderEnvelope {
  const target = [
    (minimum[0]! + maximum[0]!) / 2,
    (minimum[1]! + maximum[1]!) / 2,
    (minimum[2]! + maximum[2]!) / 2,
  ] as const;
  const span = Math.max(.001, Math.hypot(
    maximum[0]! - minimum[0]!,
    maximum[1]! - minimum[1]!,
    maximum[2]! - minimum[2]!,
  ));
  return { target, span };
}

export async function acquireBrowserDevice(): Promise<ViewportGpuDevice> {
  const gpu = navigator.gpu;
  if (!gpu) {
    throw new Error("WebGPU is unavailable: navigator.gpu is not exposed in this context.");
  }
  const adapter = await gpu.requestAdapter();
  if (!adapter) {
    throw new Error("WebGPU is unavailable: no compatible GPU adapter was found.");
  }
  return adapter.requestDevice();
}
