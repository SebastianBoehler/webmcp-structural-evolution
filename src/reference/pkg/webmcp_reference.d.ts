/* tslint:disable */
/* eslint-disable */

export class WasmStructuralFieldEvaluation {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly compliance_j: number;
    readonly direct_relative_residual: number;
    readonly energy_relative_mismatch: number;
    readonly force_balance_error_n: number;
    readonly reaction_n: Float64Array;
    readonly strain_energy_j: number;
    readonly von_mises_stress_pa: Float32Array;
}

export class WasmStructuralIterateEvaluation {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly free_residual_n: Float64Array;
}

export class WasmStructuralReferenceResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly compliance_j: number;
    readonly displacement_m: Float32Array;
    readonly force_balance_error_n: number;
    readonly iterations: number;
    readonly relative_residual: number;
    readonly von_mises_stress_pa: Float32Array;
}

export class WasmThermalFieldEvaluation {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly energy_imbalance_w: number;
    readonly face_areas_m2: Float64Array;
    readonly face_heat_flux_wm2: Float64Array;
    readonly heat_flux_wm2: Float64Array;
    readonly heat_input_w: number;
    readonly heat_output_w: number;
    readonly relative_energy_imbalance: number;
}

export class WasmThermalReferenceResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly face_areas_m2: Float64Array;
    readonly face_heat_flux_wm2: Float64Array;
    readonly heat_flux_wm2: Float64Array;
    readonly heat_input_w: number;
    readonly heat_output_w: number;
    readonly iterations: number;
    readonly relative_energy_imbalance: number;
    readonly relative_residual: number;
    readonly temperature_k: Float64Array;
}

export class WasmTopologyResult {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    readonly case_displacement: Float32Array;
    readonly case_ids: string[];
    readonly case_stress: Float32Array;
    readonly density: Float32Array;
    readonly depth: number;
    readonly displacement: Float32Array;
    readonly final_compliance: number;
    readonly height: number;
    readonly initial_compliance: number;
    readonly iterations: number;
    readonly material_fraction: number;
    readonly max_displacement: number;
    readonly max_stress: number;
    readonly minimum_safety_factor: number;
    readonly stress: Float32Array;
    readonly width: number;
}

export function evaluate_structural_field(input: any, displacement_m: Float32Array): WasmStructuralFieldEvaluation;

export function evaluate_structural_iterate_f64(input: any, displacement_m: Float64Array): WasmStructuralIterateEvaluation;

export function evaluate_thermal_field_wasm(value: any, temperature_k: Float64Array): WasmThermalFieldEvaluation;

export function optimize_assembly_frame(preset: string, input: any): WasmTopologyResult;

export function optimize_demo_frame(preset: string): WasmTopologyResult;

export function relative_l2(expected: Float32Array, actual: Float32Array): number;

export function solve_structural_reference(input: any): WasmStructuralReferenceResult;

export function solve_thermal_reference_wasm(value: any): WasmThermalReferenceResult;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmtopologyresult_free: (a: number, b: number) => void;
    readonly optimize_assembly_frame: (a: number, b: number, c: any) => [number, number, number];
    readonly optimize_demo_frame: (a: number, b: number) => [number, number, number];
    readonly wasmtopologyresult_case_displacement: (a: number) => [number, number];
    readonly wasmtopologyresult_case_ids: (a: number) => [number, number];
    readonly wasmtopologyresult_case_stress: (a: number) => [number, number];
    readonly wasmtopologyresult_density: (a: number) => [number, number];
    readonly wasmtopologyresult_depth: (a: number) => number;
    readonly wasmtopologyresult_displacement: (a: number) => [number, number];
    readonly wasmtopologyresult_final_compliance: (a: number) => number;
    readonly wasmtopologyresult_height: (a: number) => number;
    readonly wasmtopologyresult_initial_compliance: (a: number) => number;
    readonly wasmtopologyresult_iterations: (a: number) => number;
    readonly wasmtopologyresult_material_fraction: (a: number) => number;
    readonly wasmtopologyresult_max_displacement: (a: number) => number;
    readonly wasmtopologyresult_max_stress: (a: number) => number;
    readonly wasmtopologyresult_minimum_safety_factor: (a: number) => number;
    readonly wasmtopologyresult_stress: (a: number) => [number, number];
    readonly wasmtopologyresult_width: (a: number) => number;
    readonly __wbg_wasmstructuralfieldevaluation_free: (a: number, b: number) => void;
    readonly __wbg_wasmstructuraliterateevaluation_free: (a: number, b: number) => void;
    readonly __wbg_wasmstructuralreferenceresult_free: (a: number, b: number) => void;
    readonly evaluate_structural_field: (a: any, b: number, c: number) => [number, number, number];
    readonly evaluate_structural_iterate_f64: (a: any, b: number, c: number) => [number, number, number];
    readonly solve_structural_reference: (a: any) => [number, number, number];
    readonly wasmstructuralfieldevaluation_compliance_j: (a: number) => number;
    readonly wasmstructuralfieldevaluation_direct_relative_residual: (a: number) => number;
    readonly wasmstructuralfieldevaluation_energy_relative_mismatch: (a: number) => number;
    readonly wasmstructuralfieldevaluation_force_balance_error_n: (a: number) => number;
    readonly wasmstructuralfieldevaluation_reaction_n: (a: number) => [number, number];
    readonly wasmstructuralfieldevaluation_strain_energy_j: (a: number) => number;
    readonly wasmstructuralfieldevaluation_von_mises_stress_pa: (a: number) => [number, number];
    readonly wasmstructuraliterateevaluation_free_residual_n: (a: number) => [number, number];
    readonly wasmstructuralreferenceresult_compliance_j: (a: number) => number;
    readonly wasmstructuralreferenceresult_displacement_m: (a: number) => [number, number];
    readonly wasmstructuralreferenceresult_force_balance_error_n: (a: number) => number;
    readonly wasmstructuralreferenceresult_iterations: (a: number) => number;
    readonly wasmstructuralreferenceresult_relative_residual: (a: number) => number;
    readonly wasmstructuralreferenceresult_von_mises_stress_pa: (a: number) => [number, number];
    readonly __wbg_wasmthermalfieldevaluation_free: (a: number, b: number) => void;
    readonly __wbg_wasmthermalreferenceresult_free: (a: number, b: number) => void;
    readonly evaluate_thermal_field_wasm: (a: any, b: number, c: number) => [number, number, number];
    readonly solve_thermal_reference_wasm: (a: any) => [number, number, number];
    readonly wasmthermalfieldevaluation_energy_imbalance_w: (a: number) => number;
    readonly wasmthermalfieldevaluation_face_areas_m2: (a: number) => [number, number];
    readonly wasmthermalfieldevaluation_face_heat_flux_wm2: (a: number) => [number, number];
    readonly wasmthermalfieldevaluation_heat_flux_wm2: (a: number) => [number, number];
    readonly wasmthermalfieldevaluation_heat_input_w: (a: number) => number;
    readonly wasmthermalfieldevaluation_heat_output_w: (a: number) => number;
    readonly wasmthermalfieldevaluation_relative_energy_imbalance: (a: number) => number;
    readonly wasmthermalreferenceresult_face_areas_m2: (a: number) => [number, number];
    readonly wasmthermalreferenceresult_face_heat_flux_wm2: (a: number) => [number, number];
    readonly wasmthermalreferenceresult_heat_flux_wm2: (a: number) => [number, number];
    readonly wasmthermalreferenceresult_iterations: (a: number) => number;
    readonly wasmthermalreferenceresult_relative_energy_imbalance: (a: number) => number;
    readonly wasmthermalreferenceresult_temperature_k: (a: number) => [number, number];
    readonly wasmthermalreferenceresult_heat_input_w: (a: number) => number;
    readonly wasmthermalreferenceresult_heat_output_w: (a: number) => number;
    readonly wasmthermalreferenceresult_relative_residual: (a: number) => number;
    readonly relative_l2: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
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
