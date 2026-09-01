import { describe, expect, it, vi } from "vitest";

import { runBufferPcg, type BufferPcgCallbacks, type BufferPcgVectors } from "./pcg";

const buffer = () => ({}) as GPUBuffer;
const vectors: BufferPcgVectors = {
  rhs: buffer(), solution: buffer(), residual: buffer(), preconditioned: buffer(),
  direction: buffer(), product: buffer(),
};

function callbacks(dot: BufferPcgCallbacks["dot"]): BufferPcgCallbacks {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    applyOperator: vi.fn().mockResolvedValue(undefined),
    precondition: vi.fn().mockResolvedValue(undefined), dot,
    axpy: vi.fn().mockResolvedValue(undefined), residualNorm: vi.fn().mockResolvedValue(0),
    checkIteration: vi.fn(), emit: vi.fn(), diverged: (message) => new Error(message),
  };
}

describe("buffer PCG", () => {
  it("accepts the exact zero-residual system without an iteration or regularization", async () => {
    const operations = callbacks(vi.fn().mockResolvedValue(0));

    await expect(runBufferPcg(vectors, operations, { maxIterations: 10, tolerance: 1e-6 }))
      .resolves.toEqual({ iterations: 0, relativeResidual: 0 });
    expect(operations.axpy).not.toHaveBeenCalled();
    expect(operations.precondition).not.toHaveBeenCalled();
  });

  it("still rejects a nonzero residual with a singular search denominator", async () => {
    const operations = callbacks(vi.fn()
      .mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValueOnce(0));

    await expect(runBufferPcg(vectors, operations, { maxIterations: 10, tolerance: 1e-6 }))
      .rejects.toThrow("initialization did not produce positive finite reductions");
  });
});
