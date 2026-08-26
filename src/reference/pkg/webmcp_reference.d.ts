/* tslint:disable */
/* eslint-disable */

export class WasmTopologyResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly density: Float32Array;
    readonly depth: number;
    readonly final_compliance: number;
    readonly height: number;
    readonly initial_compliance: number;
    readonly iterations: number;
    readonly material_fraction: number;
    readonly max_displacement: number;
    readonly max_stress: number;
    readonly minimum_safety_factor: number;
    readonly width: number;
}

export function optimize_assembly_frame(preset: string, input: any): WasmTopologyResult;

export function optimize_demo_frame(preset: string): WasmTopologyResult;

export function relative_l2(expected: Float32Array, actual: Float32Array): number;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmtopologyresult_free: (a: number, b: number) => void;
    readonly optimize_assembly_frame: (a: number, b: number, c: any) => [number, number, number];
    readonly optimize_demo_frame: (a: number, b: number) => [number, number, number];
    readonly wasmtopologyresult_density: (a: number) => [number, number];
    readonly wasmtopologyresult_depth: (a: number) => number;
    readonly wasmtopologyresult_final_compliance: (a: number) => number;
    readonly wasmtopologyresult_height: (a: number) => number;
    readonly wasmtopologyresult_initial_compliance: (a: number) => number;
    readonly wasmtopologyresult_iterations: (a: number) => number;
    readonly wasmtopologyresult_material_fraction: (a: number) => number;
    readonly wasmtopologyresult_max_displacement: (a: number) => number;
    readonly wasmtopologyresult_max_stress: (a: number) => number;
    readonly wasmtopologyresult_minimum_safety_factor: (a: number) => number;
    readonly wasmtopologyresult_width: (a: number) => number;
    readonly relative_l2: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
