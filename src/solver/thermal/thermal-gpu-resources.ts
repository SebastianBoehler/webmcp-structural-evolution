import { StructuralGpuError } from "../structural/structural-gpu-runtime";
import type { ThermalInput } from "./thermal-contract";

export interface ThermalGpuResources {
  readonly gridParams: GPUBuffer;
  readonly vectorParams: GPUBuffer;
  readonly reductionParams: GPUBuffer;
  readonly active: GPUBuffer;
  readonly fixed: GPUBuffer;
  readonly conductivity: GPUBuffer;
  readonly fixedTemperature: GPUBuffer;
  readonly sourcePower: GPUBuffer;
  readonly boundaryFaceHeatFlux: GPUBuffer;
  readonly boundaryFaceAreas: GPUBuffer;
  readonly rhs: GPUBuffer;
  readonly solution: GPUBuffer;
  readonly residual: GPUBuffer;
  readonly preconditioned: GPUBuffer;
  readonly direction: GPUBuffer;
  readonly product: GPUBuffer;
  readonly diagonal: GPUBuffer;
  readonly heatFlux: GPUBuffer;
  readonly faceHeatFlux: GPUBuffer;
  readonly faceAreas: GPUBuffer;
  readonly thermostatPower: GPUBuffer;
  readonly partialA: GPUBuffer;
  readonly partialB: GPUBuffer;
  readonly scalarReadback: GPUBuffer;
  readonly fieldReadback: GPUBuffer;
  readonly sourcePowerValues: Float32Array;
  readonly referenceTemperatureK: number;
  destroy(): void;
}

function validate(input: ThermalInput): number {
  const [width, height, depth] = input.grid.cellDimensions;
  const count = width * height * depth;
  const faceAreaM2 = input.grid.cellSizeM ** 2;
  if (![width, height, depth].every((value) => Number.isSafeInteger(value) && value > 0)
    || !Number.isSafeInteger(count) || count < 1 || input.activeCells.length !== count
    || input.conductivityWmK.length !== count || input.activeCellCount !== input.activeCells.filter(Boolean).length
    || !Number.isFinite(input.grid.cellSizeM) || input.grid.cellSizeM <= 0
    || !Number.isFinite(faceAreaM2) || faceAreaM2 <= 0
    || !Number.isFinite(Math.fround(input.grid.cellSizeM)) || Math.fround(input.grid.cellSizeM) <= 0
    || !Number.isFinite(Math.fround(faceAreaM2)) || Math.fround(faceAreaM2) <= 0) {
    throw new StructuralGpuError("invalid-input", "Thermal GPU dimensions and field lengths are inconsistent");
  }
  for (let cell = 0; cell < count; cell += 1) {
    const active = input.activeCells[cell];
    const conductivity = input.conductivityWmK[cell];
    if ((active !== 0 && active !== 1) || !Number.isFinite(conductivity)
      || (active === 1 && conductivity! <= 0) || (active === 0 && conductivity !== 0)) {
      throw new StructuralGpuError("invalid-input", "Thermal conductivity and active-cell fields are invalid");
    }
  }
  const occupiedFaces = new Set<number>(), accumulatedSource = new Float32Array(count);
  for (const boundary of input.dirichletCells) if (!Number.isInteger(boundary.cellIndex)
    || boundary.cellIndex < 0 || boundary.cellIndex >= count
    || input.activeCells[boundary.cellIndex] !== 1 || !Number.isFinite(boundary.temperatureK)) {
    throw new StructuralGpuError("invalid-input", "Thermal fixed-temperature boundary is invalid");
  }
  for (const boundary of input.neumannFaces) {
    const { cellIndex, axis, direction, areaM2, heatFluxWm2 } = boundary;
    const areaF32 = Math.fround(areaM2), fluxF32 = Math.fround(heatFluxWm2);
    const exactPower = areaM2 * heatFluxWm2, powerF32 = Math.fround(exactPower);
    const slot = cellIndex * 6 + axis * 2 + (direction > 0 ? 1 : 0);
    if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= count
      || input.activeCells[cellIndex] !== 1 || !Number.isInteger(axis) || axis < 0 || axis > 2
      || (direction !== -1 && direction !== 1) || !Number.isFinite(areaM2) || areaM2 <= 0
      || !Number.isFinite(areaF32) || areaF32 <= 0 || !Number.isFinite(heatFluxWm2)
      || (heatFluxWm2 !== 0 && (!Number.isFinite(fluxF32) || fluxF32 === 0))
      || (exactPower !== 0 && (!Number.isFinite(powerF32) || powerF32 === 0))
      || occupiedFaces.has(slot)) {
      throw new StructuralGpuError("invalid-input", "Thermal heat-flux boundary exceeds the finite f32 source envelope");
    }
    occupiedFaces.add(slot);
    const next = Math.fround(accumulatedSource[cellIndex]! + powerF32);
    if (!Number.isFinite(next)) {
      throw new StructuralGpuError("invalid-input", "Thermal accumulated heat source exceeds the finite f32 envelope");
    }
    accumulatedSource[cellIndex] = next;
  }
  return count;
}

export function createThermalGpuResources(device: GPUDevice, input: ThermalInput): ThermalGpuResources {
  const count = validate(input);
  const buffers: GPUBuffer[] = [];
  const create = (label: string, size: number, usage: GPUBufferUsageFlags) => {
    if (size > device.limits.maxBufferSize
      || ((usage & GPUBufferUsage.STORAGE) !== 0 && size > device.limits.maxStorageBufferBindingSize)) {
      throw new StructuralGpuError("resource-limit", `${label} requires ${size} bytes beyond device limits`);
    }
    const buffer = device.createBuffer({ label, size: Math.max(4, size), usage });
    buffers.push(buffer);
    return buffer;
  };
  try {
    const scalarBytes = count * 4;
    const vectorBytes = count * 3 * 4;
    const faceBytes = count * 6 * 4;
    const storage = (label: string, size = scalarBytes) => create(
      label, size, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    );
    const gridParams = create("thermal-grid-params", 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const vectorParams = create("thermal-vector-params", 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const reductionParams = create("thermal-reduction-params", 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const active = storage("thermal-active");
    const fixed = storage("thermal-fixed");
    const conductivity = storage("thermal-conductivity");
    const fixedTemperature = storage("thermal-fixed-temperature");
    const sourcePower = storage("thermal-source-power");
    const boundaryFaceHeatFlux = storage("thermal-boundary-face-heat-flux", faceBytes);
    const boundaryFaceAreas = storage("thermal-boundary-face-areas", faceBytes);
    const rhs = storage("thermal-rhs");
    const solution = storage("thermal-solution");
    const residual = storage("thermal-residual");
    const preconditioned = storage("thermal-preconditioned");
    const direction = storage("thermal-direction");
    const product = storage("thermal-product");
    const diagonal = storage("thermal-diagonal");
    const heatFlux = storage("thermal-heat-flux", vectorBytes);
    const faceHeatFlux = storage("thermal-face-heat-flux", faceBytes);
    const faceAreas = storage("thermal-face-areas", faceBytes);
    const thermostatPower = storage("thermal-thermostat-power");
    const partialBytes = Math.max(4, Math.ceil(count / 64) * 4);
    const partialA = storage("thermal-reduction-a", partialBytes);
    const partialB = storage("thermal-reduction-b", partialBytes);
    const scalarReadback = create("thermal-scalar-readback", 4, GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    const fieldReadback = create("thermal-field-readback", Math.max(faceBytes, vectorBytes), GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    const gridRaw = new ArrayBuffer(32);
    new Uint32Array(gridRaw, 0, 4).set([...input.grid.cellDimensions, count]);
    new Float32Array(gridRaw, 16, 2).set([input.grid.cellSizeM, input.grid.cellSizeM ** 2]);
    const fixedValues = new Uint32Array(count), temperatures = new Float32Array(count);
    const referenceTemperatureK = input.dirichletCells[0]?.temperatureK;
    if (!Number.isFinite(referenceTemperatureK)) {
      throw new StructuralGpuError("invalid-input", "Thermal solve requires a finite reference temperature");
    }
    for (const boundary of input.dirichletCells) {
      if (!Number.isInteger(boundary.cellIndex) || boundary.cellIndex < 0 || boundary.cellIndex >= count
        || input.activeCells[boundary.cellIndex] !== 1 || !Number.isFinite(boundary.temperatureK)) {
        throw new StructuralGpuError("invalid-input", "Thermal fixed-temperature boundary is invalid");
      }
      const shifted = Math.fround(boundary.temperatureK - referenceTemperatureK!);
      if (fixedValues[boundary.cellIndex] && temperatures[boundary.cellIndex] !== shifted) {
        throw new StructuralGpuError("invalid-input", "Thermal fixed-temperature boundaries conflict");
      }
      fixedValues[boundary.cellIndex] = 1;
      temperatures[boundary.cellIndex] = shifted;
    }
    const sources = new Float32Array(count), boundaryFlux = new Float32Array(count * 6);
    const boundaryAreas = new Float32Array(count * 6), occupiedFaces = new Uint32Array(count * 6);
    for (const boundary of input.neumannFaces) {
      const { cellIndex, axis, direction, areaM2, heatFluxWm2 } = boundary;
      if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= count || input.activeCells[cellIndex] !== 1
        || !Number.isInteger(axis) || axis < 0 || axis > 2 || (direction !== -1 && direction !== 1)
        || !Number.isFinite(areaM2) || areaM2 <= 0 || !Number.isFinite(heatFluxWm2)) {
        throw new StructuralGpuError("invalid-input", "Thermal heat-flux boundary is invalid");
      }
      const slot = cellIndex * 6 + axis * 2 + (direction > 0 ? 1 : 0);
      if (occupiedFaces[slot]) throw new StructuralGpuError("invalid-input", "Thermal heat-flux face is duplicated");
      occupiedFaces[slot] = 1;
      sources[cellIndex] += Math.fround(areaM2 * heatFluxWm2);
      boundaryFlux[slot] = Math.fround(-heatFluxWm2);
      boundaryAreas[slot] = Math.fround(areaM2);
    }
    for (const [buffer, value] of [[active, input.activeCells], [fixed, fixedValues],
      [conductivity, input.conductivityWmK], [fixedTemperature, temperatures],
      [sourcePower, sources], [boundaryFaceHeatFlux, boundaryFlux],
      [boundaryFaceAreas, boundaryAreas]] as const) device.queue.writeBuffer(buffer, 0, value);
    device.queue.writeBuffer(gridParams, 0, gridRaw);
    return {
      gridParams, vectorParams, reductionParams, active, fixed, conductivity, fixedTemperature,
      sourcePower, boundaryFaceHeatFlux, boundaryFaceAreas, rhs, solution, residual,
      preconditioned, direction, product, diagonal, heatFlux, faceHeatFlux, faceAreas,
      thermostatPower, partialA, partialB, scalarReadback,
      fieldReadback, sourcePowerValues: sources, referenceTemperatureK: referenceTemperatureK!,
      destroy: () => {
        for (const mapped of [fieldReadback, scalarReadback]) try {
          if (mapped.mapState === "mapped") mapped.unmap();
        } catch { /* continue */ }
        for (const buffer of buffers.reverse()) try { buffer.destroy(); } catch { /* continue */ }
      },
    };
  } catch (error) {
    for (const buffer of buffers.reverse()) try { buffer.destroy(); } catch { /* continue */ }
    if (error instanceof StructuralGpuError) throw error;
    throw new StructuralGpuError("resource-limit", `Thermal GPU allocation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
