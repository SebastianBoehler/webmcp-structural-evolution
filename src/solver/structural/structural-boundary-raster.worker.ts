import {
  rasterizeStructuralBoundariesDirect, type BoundaryRasterInput,
} from "./structural-boundary-raster";

self.addEventListener("message", (event: MessageEvent<{
  requestId: string; input: BoundaryRasterInput;
}>) => {
  try {
    self.postMessage({
      requestId: event.data.requestId,
      output: rasterizeStructuralBoundariesDirect(event.data.input),
    });
  } catch (error) {
    self.postMessage({
      requestId: event.data.requestId,
      error: error instanceof Error ? error.message : "Structural boundary rasterization failed",
    });
  }
});
