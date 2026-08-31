import { vi } from "vitest";

export class RecordingBuffer {
  readonly data: ArrayBuffer;
  destroyed = false;
  mapped = false;

  constructor(readonly descriptor: GPUBufferDescriptor) {
    this.data = new ArrayBuffer(Number(descriptor.size));
  }

  get mapState(): GPUBufferMapState { return this.mapped ? "mapped" : "unmapped"; }

  destroy(): void { this.destroyed = true; }
  async mapAsync(): Promise<void> {
    if (this.mapped) throw new Error("recording buffer mapped concurrently");
    this.mapped = true;
  }
  getMappedRange(offset = 0, size = this.data.byteLength - offset): ArrayBuffer {
    return this.data.slice(offset, offset + size);
  }
  unmap(): void { this.mapped = false; }
}

export interface RecordingGpuOptions {
  readonly loseAfterSubmit?: boolean;
  readonly pipelineFailure?: boolean;
  readonly scalarSequence?: readonly number[];
  readonly maxBufferSize?: number;
}

export function recordingGpu(options: RecordingGpuOptions = {}) {
  const buffers: RecordingBuffer[] = [];
  const pipelines: string[] = [];
  const dispatches: string[] = [];
  let lose!: (info: GPUDeviceLostInfo) => void;
  const lost = new Promise<GPUDeviceLostInfo>((resolve) => { lose = resolve; });
  const copies: Array<readonly [RecordingBuffer, number, RecordingBuffer, number, number]> = [];
  let currentEntry = "unset";
  let scalarIndex = 0;
  const device = {
    limits: {
      maxBufferSize: options.maxBufferSize ?? 1 << 28,
      maxStorageBufferBindingSize: options.maxBufferSize ?? 1 << 27,
      maxComputeWorkgroupsPerDimension: 65_535,
    },
    lost,
    destroy: vi.fn(),
    pushErrorScope: vi.fn(),
    popErrorScope: vi.fn().mockResolvedValue(null),
    createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => {
      const buffer = new RecordingBuffer(descriptor);
      buffers.push(buffer);
      return buffer;
    }),
    createShaderModule: vi.fn(() => ({
      getCompilationInfo: vi.fn().mockResolvedValue({ messages: [] }),
    })),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createComputePipelineAsync: vi.fn(async (descriptor: GPUComputePipelineDescriptor) => {
      if (options.pipelineFailure) throw new Error("recording pipeline rejected");
      const entry = descriptor.compute.entryPoint!;
      pipelines.push(entry);
      return { entry };
    }),
    createBindGroup: vi.fn((descriptor: GPUBindGroupDescriptor) => ({ descriptor })),
    createCommandEncoder: vi.fn(() => ({
      beginComputePass: () => ({
        setPipeline: (pipeline: { entry: string }) => { currentEntry = pipeline.entry; },
        setBindGroup: vi.fn(),
        dispatchWorkgroups: () => { dispatches.push(currentEntry); },
        end: vi.fn(),
      }),
      copyBufferToBuffer: (
        source: RecordingBuffer, sourceOffset: number, destination: RecordingBuffer,
        destinationOffset: number, size: number,
      ) => copies.push([source, sourceOffset, destination, destinationOffset, size]),
      finish: () => ({ copies: copies.splice(0) }),
    })),
    queue: {
      writeBuffer: (
        buffer: RecordingBuffer, offset: number, source: ArrayBuffer | ArrayBufferView,
        sourceOffset = 0, size?: number,
      ) => {
        const bytes = ArrayBuffer.isView(source)
          ? new Uint8Array(source.buffer, source.byteOffset + sourceOffset, size ?? source.byteLength - sourceOffset)
          : new Uint8Array(source, sourceOffset, size ?? source.byteLength - sourceOffset);
        new Uint8Array(buffer.data, offset, bytes.byteLength).set(bytes);
      },
      submit: (commands: Array<{ copies: typeof copies }>) => {
        for (const command of commands) for (const [source, sourceOffset, destination, destinationOffset, size] of command.copies) {
          new Uint8Array(destination.data, destinationOffset, size)
            .set(new Uint8Array(source.data, sourceOffset, size));
          if (destination.descriptor.label === "structural-scalar-readback" && options.scalarSequence) {
            new Float32Array(destination.data)[0] = options.scalarSequence[scalarIndex++] ?? 0;
          }
        }
        if (options.loseAfterSubmit) lose({ reason: "unknown", message: "recording device lost" } as GPUDeviceLostInfo);
      },
      onSubmittedWorkDone: options.loseAfterSubmit
        ? vi.fn(() => new Promise<void>(() => undefined))
        : vi.fn().mockResolvedValue(undefined),
    },
  };
  const adapter = { requestDevice: vi.fn().mockResolvedValue(device) };
  const gpu = { requestAdapter: vi.fn().mockResolvedValue(adapter) };
  return { adapter, buffers, device, dispatches, gpu, pipelines };
}

export const RECORDING_GPU_GLOBALS = {
  GPUBufferUsage: { MAP_READ: 1, COPY_SRC: 2, COPY_DST: 4, UNIFORM: 8, STORAGE: 16 },
  GPUShaderStage: { COMPUTE: 1 },
  GPUMapMode: { READ: 1 },
} as const;
