import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

import { runComputeProbe, type ProbeResult } from "./compute-probe";

const wasm = vi.hoisted(() => ({
  relativeL2: vi.fn<(expected: Float32Array, actual: Float32Array) => Promise<number>>(),
}));

vi.mock("../reference", () => ({ relativeL2: wasm.relativeL2 }));

const BUFFER_USAGE = {
  MAP_READ: 1,
  COPY_SRC: 2,
  COPY_DST: 4,
  UNIFORM: 8,
  STORAGE: 16,
} as const;

class FakeBuffer {
  readonly data: ArrayBuffer;
  destroyed = false;
  mapped = false;

  constructor(
    readonly size: number,
    private readonly rejectMap: boolean,
  ) {
    this.data = new ArrayBuffer(size);
  }

  destroy() {
    this.destroyed = true;
  }

  getMappedRange() {
    return this.data;
  }

  async mapAsync() {
    if (this.rejectMap) throw new Error("readback mapping rejected");
    this.mapped = true;
  }

  unmap() {
    this.mapped = false;
  }
}

interface FakeWebGpuOptions {
  readonly bufferFailureAt?: number;
  readonly deviceLost?: boolean;
  readonly dispatchFailure?: boolean;
  readonly mapFailure?: boolean;
  readonly outputDelta?: number;
  readonly pipelineFailure?: boolean;
  readonly pendingDispatch?: boolean;
  readonly shaderFailure?: boolean;
}

function fakeWebGpu(options: FakeWebGpuOptions = {}) {
  const buffers: FakeBuffer[] = [];
  const copies: Array<[FakeBuffer, FakeBuffer, number]> = [];
  const dispatchWorkgroups = vi.fn();
  let loseDevice!: (info: GPUDeviceLostInfo) => void;
  const device = {
    limits: { maxBufferSize: 1 << 28, maxStorageBufferBindingSize: 1 << 27 },
    lost: new Promise<GPUDeviceLostInfo>((resolve) => {
      loseDevice = resolve;
    }),
    destroy: vi.fn(),
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn().mockResolvedValue(null),
    createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => {
      if (buffers.length === options.bufferFailureAt) throw new Error("buffer allocation rejected");
      const buffer = new FakeBuffer(
        Number(descriptor.size),
        Boolean(options.mapFailure && (descriptor.usage & BUFFER_USAGE.MAP_READ) !== 0),
      );
      buffers.push(buffer);
      return buffer;
    }),
    createShaderModule: vi.fn(() => ({
      getCompilationInfo: vi.fn().mockResolvedValue({
        messages: options.shaderFailure
          ? [{ type: "error", lineNum: 12, linePos: 4, message: "invalid shader" }]
          : [],
      }),
    })),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createComputePipelineAsync: options.pipelineFailure
      ? vi.fn().mockRejectedValue(new Error("pipeline rejected"))
      : vi.fn().mockResolvedValue({}),
    createBindGroup: vi.fn(() => ({})),
    createCommandEncoder: vi.fn(() => ({
      beginComputePass: () => ({
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        dispatchWorkgroups,
        end: vi.fn(),
      }),
      copyBufferToBuffer: (
        source: FakeBuffer,
        _sourceOffset: number,
        destination: FakeBuffer,
        _destinationOffset: number,
        size: number,
      ) => copies.push([source, destination, size]),
      finish: () => ({ copies: [...copies] }),
    })),
    queue: {
      writeBuffer: (buffer: FakeBuffer, offset: number, source: ArrayBufferView) => {
        new Uint8Array(buffer.data, offset, source.byteLength).set(
          new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
        );
      },
      submit: (commands: Array<{ copies: Array<[FakeBuffer, FakeBuffer, number]> }>) => {
        const input = new Float32Array(buffers[0].data);
        const output = new Float32Array(buffers[1].data);
        for (let index = 0; index < input.length; index += 1) {
          output[index] = Math.fround(Math.fround(input[index] * input[index]) + 0.125);
        }
        output[0] += options.outputDelta ?? 0;
        for (const command of commands) {
          for (const [source, destination, size] of command.copies) {
            new Uint8Array(destination.data, 0, size).set(new Uint8Array(source.data, 0, size));
          }
        }
        if (options.deviceLost) {
          loseDevice({ reason: "unknown", message: "test device loss" } as GPUDeviceLostInfo);
        }
      },
      onSubmittedWorkDone: options.deviceLost
        ? vi.fn(() => new Promise<void>(() => undefined))
        : options.pendingDispatch
          ? vi.fn(() => new Promise<void>(() => undefined))
        : options.dispatchFailure
          ? vi.fn().mockRejectedValue(new Error("submission rejected"))
          : vi.fn().mockResolvedValue(undefined),
    },
  };
  const adapter = { requestDevice: vi.fn().mockResolvedValue(device) };
  const gpu = { requestAdapter: vi.fn().mockResolvedValue(adapter) };

  return { buffers, device, dispatchWorkgroups, gpu };
}

function validInput() {
  const values = new Float32Array(32 * 32 * 32);
  values.set([-2, -0.5, 0, 1.5]);
  return { dimensions: { width: 32, height: 32, depth: 32 }, values };
}

describe("runComputeProbe", () => {
  beforeEach(() => {
    wasm.relativeL2.mockReset().mockImplementation(async (expected, actual) => {
      for (let index = 0; index < expected.length; index += 1) {
        if (expected[index] !== actual[index]) return 0.25;
      }
      return 0;
    });
    vi.stubGlobal("GPUBufferUsage", BUFFER_USAGE);
    vi.stubGlobal("GPUShaderStage", { COMPUTE: 1 });
    vi.stubGlobal("GPUMapMode", { READ: 1 });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("fails closed before GPU acquisition when input is invalid", async () => {
    const gpu = { requestAdapter: vi.fn() };
    vi.stubGlobal("navigator", { gpu });

    const result = await runComputeProbe({
      dimensions: { width: 31, height: 32, depth: 32 },
      values: new Float32Array(31 * 32 * 32),
    });

    expect(result).toMatchObject({ status: "failed", code: "invalid-input" });
    if (result.status !== "failed") throw new Error("expected invalid-input failure");
    expect(result.message).toContain("dimensions.width");
    expect(result).not.toHaveProperty("output");
    expect(gpu.requestAdapter).not.toHaveBeenCalled();
  });

  it("returns only verified GPU readback and releases every buffer", async () => {
    const webGpu = fakeWebGpu();
    vi.stubGlobal("navigator", { gpu: webGpu.gpu });

    const result = await runComputeProbe(validInput());

    expect(result.status).toBe("verified");
    if (result.status === "verified") {
      expect(Array.from(result.output.slice(0, 4))).toEqual([4.125, 0.375, 0.125, 2.375]);
      expect(result.relativeL2).toBe(0);
    }
    expect(webGpu.buffers).toHaveLength(4);
    expect(webGpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    expect(webGpu.buffers.every((buffer) => !buffer.mapped)).toBe(true);
    expect(webGpu.dispatchWorkgroups).toHaveBeenCalledWith(512);
    expect(webGpu.device.createBindGroupLayout).toHaveBeenCalledWith({
      entries: [
        { binding: 0, visibility: 1, buffer: { type: "read-only-storage", minBindingSize: 131072 } },
        { binding: 1, visibility: 1, buffer: { type: "storage", minBindingSize: 131072 } },
        { binding: 2, visibility: 1, buffer: { type: "uniform", minBindingSize: 16 } },
      ],
    });
  });

  it("withholds mismatched output and still releases every buffer", async () => {
    const webGpu = fakeWebGpu({ outputDelta: 0.25 });
    vi.stubGlobal("navigator", { gpu: webGpu.gpu });

    const result = await runComputeProbe(validInput());

    expect(result).toMatchObject({ status: "mismatch", code: "verification-mismatch" });
    expect(result).not.toHaveProperty("output");
    expect(webGpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    expect(webGpu.buffers.every((buffer) => !buffer.mapped)).toBe(true);
  });

  it("reports map failures without output and releases partially used resources", async () => {
    const webGpu = fakeWebGpu({ mapFailure: true });
    vi.stubGlobal("navigator", { gpu: webGpu.gpu });

    const result = await runComputeProbe(validInput());

    expect(result).toMatchObject({ status: "failed", code: "map-error" });
    if (result.status !== "failed") throw new Error("expected map failure");
    expect(result.message).toContain("readback mapping rejected");
    expect(result).not.toHaveProperty("output");
    expect(webGpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
  });

  it("releases buffers created before a later allocation fails", async () => {
    const webGpu = fakeWebGpu({ bufferFailureAt: 2 });
    vi.stubGlobal("navigator", { gpu: webGpu.gpu });

    const result = await runComputeProbe(validInput());

    expect(result).toMatchObject({ status: "failed", code: "device-error" });
    expect(webGpu.buffers).toHaveLength(2);
    expect(webGpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
  });

  it.each([
    ["shader", { shaderFailure: true }, "shader-compilation-error"],
    ["pipeline", { pipelineFailure: true }, "pipeline-error"],
    ["dispatch", { dispatchFailure: true }, "dispatch-error"],
    ["device loss", { deviceLost: true }, "device-lost"],
  ] as const)("distinguishes a %s failure and withholds output", async (_stage, options, code) => {
    const webGpu = fakeWebGpu(options);
    vi.stubGlobal("navigator", { gpu: webGpu.gpu });

    const result = await runComputeProbe(validInput());

    expect(result).toMatchObject({ status: "failed", code });
    expect(result).not.toHaveProperty("output");
    expect(webGpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
  });

  it("distinguishes a Wasm verification failure and withholds output", async () => {
    const webGpu = fakeWebGpu();
    vi.stubGlobal("navigator", { gpu: webGpu.gpu });
    wasm.relativeL2.mockRejectedValueOnce(new Error("oracle unavailable"));

    const result = await runComputeProbe(validInput());

    expect(result).toMatchObject({ status: "failed", code: "wasm-verification-error" });
    expect(result).not.toHaveProperty("output");
    expect(webGpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
  });

  it("cancels a pending dispatch and releases every GPU resource", async () => {
    const webGpu = fakeWebGpu({ pendingDispatch: true });
    vi.stubGlobal("navigator", { gpu: webGpu.gpu });
    const controller = new AbortController();

    const running = runComputeProbe(validInput(), controller.signal);
    await vi.waitFor(() => expect(webGpu.device.queue.onSubmittedWorkDone).toHaveBeenCalledOnce());
    controller.abort();

    const result = await running;
    expect(result).toMatchObject({ status: "canceled", code: "canceled" });
    expect(result).not.toHaveProperty("output");
    expect(webGpu.buffers.every((buffer) => buffer.destroyed)).toBe(true);
    expect(webGpu.device.destroy).toHaveBeenCalledOnce();
  });

  it("makes renderable output impossible on failed and mismatch union members", () => {
    expectTypeOf<Extract<ProbeResult, { status: "failed" }>>().not.toHaveProperty("output");
    expectTypeOf<Extract<ProbeResult, { status: "mismatch" }>>().not.toHaveProperty("output");
    expectTypeOf<Extract<ProbeResult, { status: "canceled" }>>().not.toHaveProperty("output");
  });
});
