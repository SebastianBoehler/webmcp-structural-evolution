import type { CompiledStructuralSystem } from "./structural-contract";
import { buildHex8Stiffness } from "./element-stiffness";
import { StructuralGpuError } from "./structural-gpu-runtime";

export interface StructuralGpuResources {
  readonly gridParams: GPUBuffer;
  readonly vectorParams: GPUBuffer;
  readonly reductionParams: GPUBuffer;
  readonly active: GPUBuffer;
  readonly fixed: GPUBuffer;
  readonly stiffness: GPUBuffer;
  readonly rhs: GPUBuffer;
  readonly x: GPUBuffer;
  readonly r: GPUBuffer;
  readonly z: GPUBuffer;
  readonly p: GPUBuffer;
  readonly product: GPUBuffer;
  readonly blockDiagonal: GPUBuffer;
  readonly stress: GPUBuffer;
  readonly partialA: GPUBuffer;
  readonly partialB: GPUBuffer;
  readonly scalarReadback: GPUBuffer;
  readonly fieldReadback: GPUBuffer;
  destroy(): void;
}

function byteSize(value: ArrayBufferView): number {
  return Math.max(4, Math.ceil(value.byteLength / 4) * 4);
}

export function createStructuralGpuResources(
  device: GPUDevice,
  system: CompiledStructuralSystem,
  rhsN: Float32Array = system.loadsN,
): StructuralGpuResources {
  const buffers: GPUBuffer[] = [];
  if (rhsN.length !== system.fixedDofs.length || !rhsN.every(Number.isFinite)
    || rhsN.some((value, index) => system.fixedDofs[index] !== 0 && value !== 0)) {
    throw new StructuralGpuError("invalid-input", "Structural GPU right-hand side is invalid");
  }
  const create = (label: string, size: number, usage: GPUBufferUsageFlags) => {
    if (size > device.limits.maxBufferSize || size > device.limits.maxStorageBufferBindingSize
      && (usage & GPUBufferUsage.STORAGE) !== 0) {
      throw new StructuralGpuError("resource-limit", `${label} requires ${size} bytes beyond device limits`);
    }
    const buffer = device.createBuffer({ label, size: Math.max(4, size), usage });
    buffers.push(buffer);
    return buffer;
  };
  try {
    const dofBytes = system.fixedDofs.byteLength;
    const cellBytes = system.activeCells.byteLength;
    const partialBytes = Math.max(4, Math.ceil(system.fixedDofs.length / 64) * 4);
    const gridParams = create("structural-grid-params", 48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const vectorParams = create("structural-vector-params", 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const reductionParams = create("structural-reduction-params", 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const active = create("structural-active", cellBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    const fixed = create("structural-fixed", dofBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    const stiffnessValues = buildHex8Stiffness(
      system.material.youngsModulusPa, system.material.poissonRatio, system.grid.cellSizeM,
    );
    const stiffness = create("structural-ke", stiffnessValues.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    const rhs = create("structural-rhs", dofBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    const vector = (label: string) => create(label, dofBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    const x = create(
      "structural-x", dofBytes * 2, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    );
    const r = vector("structural-r");
    const z = vector("structural-z");
    const p = vector("structural-p");
    const product = vector("structural-product");
    const blockDiagonal = create("structural-block-diagonal", dofBytes * 3, GPUBufferUsage.STORAGE);
    const stress = create("structural-stress", cellBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    const partialA = create("structural-reduction-a", partialBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    const partialB = create("structural-reduction-b", partialBytes, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
    const scalarReadback = create("structural-scalar-readback", 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    const fieldReadback = create(
      "structural-field-readback", Math.max(dofBytes, cellBytes), GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    );
    const gridRaw = new ArrayBuffer(48);
    new Uint32Array(gridRaw, 0, 8).set([
      ...system.grid.cellDimensions, system.activeCells.length,
      ...system.grid.nodeDimensions, system.fixedDofs.length,
    ]);
    const lambda = system.material.youngsModulusPa * system.material.poissonRatio
      / ((1 + system.material.poissonRatio) * (1 - 2 * system.material.poissonRatio));
    const mu = system.material.youngsModulusPa / (2 * (1 + system.material.poissonRatio));
    new Float32Array(gridRaw, 32, 4).set([lambda, mu, system.grid.cellSizeM, 0]);
    device.queue.writeBuffer(gridParams, 0, gridRaw);
    device.queue.writeBuffer(active, 0, system.activeCells);
    device.queue.writeBuffer(fixed, 0, system.fixedDofs);
    device.queue.writeBuffer(stiffness, 0, stiffnessValues);
    device.queue.writeBuffer(rhs, 0, rhsN);
    return {
      gridParams, vectorParams, reductionParams, active, fixed, stiffness, rhs,
      x, r, z, p, product, blockDiagonal, stress, partialA, partialB,
      scalarReadback, fieldReadback,
      destroy: () => {
        for (const mapped of [fieldReadback, scalarReadback]) {
          try { if (mapped.mapState === "mapped") mapped.unmap(); } catch { /* continue */ }
        }
        for (const buffer of buffers.reverse()) try { buffer.destroy(); } catch { /* continue */ }
      },
    };
  } catch (error) {
    for (const buffer of buffers.reverse()) try { buffer.destroy(); } catch { /* continue */ }
    if (error instanceof StructuralGpuError) throw error;
    throw new StructuralGpuError(
      "resource-limit",
      `Structural GPU allocation failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
