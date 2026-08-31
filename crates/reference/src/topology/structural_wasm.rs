use wasm_bindgen::prelude::*;

use super::structural::{solve_reference, StructuralReferenceInput, StructuralReferenceResult};

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
