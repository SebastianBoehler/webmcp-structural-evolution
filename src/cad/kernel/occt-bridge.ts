import type { OcctKernel } from "occt-wasm";

interface DisposableKernel {
  [Symbol.dispose](): void;
}

export class OcctBridge<Kernel extends DisposableKernel = OcctKernel> {
  private disposed = false;

  constructor(private readonly kernel: Kernel) {}

  withKernel<Result>(operation: (kernel: Kernel) => Result): Result {
    if (this.disposed) throw new Error("OCCT bridge has been disposed");
    return operation(this.kernel);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.kernel[Symbol.dispose]();
  }
}

export function createOcctBridge<Kernel extends DisposableKernel>(kernel: Kernel): OcctBridge<Kernel> {
  return new OcctBridge(kernel);
}
