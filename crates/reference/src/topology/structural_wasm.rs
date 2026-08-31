use wasm_bindgen::prelude::*;

use super::structural::{solve_reference, StructuralReferenceInput, StructuralReferenceResult};
use super::structural_field::{evaluate_structural_field as evaluate_field, evaluate_structural_iterate_f64 as evaluate_iterate};

#[wasm_bindgen]
pub struct WasmStructuralReferenceResult {
    inner: StructuralReferenceResult,
}

#[wasm_bindgen]
impl WasmStructuralReferenceResult {
    #[wasm_bindgen(getter)]
    pub fn displacement_m(&self) -> Vec<f32> {
        self.inner.displacement_m.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn von_mises_stress_pa(&self) -> Vec<f32> {
        self.inner.von_mises_stress_pa.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn iterations(&self) -> usize {
        self.inner.iterations
    }
    #[wasm_bindgen(getter)]
    pub fn relative_residual(&self) -> f64 {
        self.inner.relative_residual
    }
    #[wasm_bindgen(getter)]
    pub fn force_balance_error_n(&self) -> f64 {
        self.inner.force_balance_error_n
    }
    #[wasm_bindgen(getter)]
    pub fn compliance_j(&self) -> f64 {
        self.inner.compliance_j
    }
}

#[wasm_bindgen]
pub fn solve_structural_reference(
    input: JsValue,
) -> Result<WasmStructuralReferenceResult, JsValue> {
    let input: StructuralReferenceInput =
        serde_wasm_bindgen::from_value(input).map_err(|error| {
            js_sys::Error::new(&format!("invalid structural reference input: {error}"))
        })?;
    Ok(WasmStructuralReferenceResult {
        inner: solve_reference(&input).map_err(|error| js_sys::Error::new(&error))?,
    })
}

#[wasm_bindgen]
pub struct WasmStructuralFieldEvaluation {
    reaction_n: [f64; 3],
    von_mises_stress_pa: Vec<f32>,
    force_balance_error_n: f64,
    compliance_j: f64,
    strain_energy_j: f64,
    energy_relative_mismatch: f64,
    direct_relative_residual: f64,
}

#[wasm_bindgen]
impl WasmStructuralFieldEvaluation {
    #[wasm_bindgen(getter)]
    pub fn reaction_n(&self) -> Vec<f64> { self.reaction_n.to_vec() }
    #[wasm_bindgen(getter)]
    pub fn von_mises_stress_pa(&self) -> Vec<f32> { self.von_mises_stress_pa.clone() }
    #[wasm_bindgen(getter)]
    pub fn force_balance_error_n(&self) -> f64 { self.force_balance_error_n }
    #[wasm_bindgen(getter)]
    pub fn compliance_j(&self) -> f64 { self.compliance_j }
    #[wasm_bindgen(getter)]
    pub fn strain_energy_j(&self) -> f64 { self.strain_energy_j }
    #[wasm_bindgen(getter)]
    pub fn energy_relative_mismatch(&self) -> f64 { self.energy_relative_mismatch }
    #[wasm_bindgen(getter)]
    pub fn direct_relative_residual(&self) -> f64 { self.direct_relative_residual }
}

#[wasm_bindgen]
pub fn evaluate_structural_field(
    input: JsValue,
    displacement_m: Vec<f32>,
) -> Result<WasmStructuralFieldEvaluation, JsValue> {
    let input: StructuralReferenceInput = serde_wasm_bindgen::from_value(input)
        .map_err(|error| js_sys::Error::new(&format!("invalid structural field input: {error}")))?;
    let result = evaluate_field(&input, &displacement_m).map_err(|error| js_sys::Error::new(&error))?;
    Ok(WasmStructuralFieldEvaluation {
        reaction_n: result.reaction_n, von_mises_stress_pa: result.von_mises_stress_pa,
        force_balance_error_n: result.force_balance_error_n, compliance_j: result.compliance_j,
        strain_energy_j: result.strain_energy_j,
        energy_relative_mismatch: result.energy_relative_mismatch,
        direct_relative_residual: result.direct_relative_residual,
    })
}

#[wasm_bindgen]
pub struct WasmStructuralIterateEvaluation {
    free_residual_n: Vec<f64>,
}

#[wasm_bindgen]
impl WasmStructuralIterateEvaluation {
    #[wasm_bindgen(getter)]
    pub fn free_residual_n(&self) -> Vec<f64> { self.free_residual_n.clone() }
}

#[wasm_bindgen]
pub fn evaluate_structural_iterate_f64(
    input: JsValue,
    displacement_m: Vec<f64>,
) -> Result<WasmStructuralIterateEvaluation, JsValue> {
    let input: StructuralReferenceInput = serde_wasm_bindgen::from_value(input)
        .map_err(|error| js_sys::Error::new(&format!("invalid structural iterate input: {error}")))?;
    let result = evaluate_iterate(&input, &displacement_m).map_err(|error| js_sys::Error::new(&error))?;
    Ok(WasmStructuralIterateEvaluation {
        free_residual_n: result.free_residual_n,
    })
}
