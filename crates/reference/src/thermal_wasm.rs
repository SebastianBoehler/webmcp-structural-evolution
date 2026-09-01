use wasm_bindgen::prelude::*;

use crate::thermal::{
    evaluate_thermal_field, solve_thermal_reference, ThermalFieldEvaluation,
    ThermalReferenceInput, ThermalReferenceResult,
};

#[wasm_bindgen]
pub struct WasmThermalFieldEvaluation { inner: ThermalFieldEvaluation }

#[wasm_bindgen]
impl WasmThermalFieldEvaluation {
    #[wasm_bindgen(getter)] pub fn heat_flux_wm2(&self) -> Vec<f64> { self.inner.heat_flux_wm2.clone() }
    #[wasm_bindgen(getter)] pub fn face_heat_flux_wm2(&self) -> Vec<f64> { self.inner.face_heat_flux_wm2.clone() }
    #[wasm_bindgen(getter)] pub fn face_areas_m2(&self) -> Vec<f64> { self.inner.face_areas_m2.clone() }
    #[wasm_bindgen(getter)] pub fn heat_input_w(&self) -> f64 { self.inner.heat_input_w }
    #[wasm_bindgen(getter)] pub fn heat_output_w(&self) -> f64 { self.inner.heat_output_w }
    #[wasm_bindgen(getter)] pub fn energy_imbalance_w(&self) -> f64 { self.inner.energy_imbalance_w }
    #[wasm_bindgen(getter)] pub fn relative_energy_imbalance(&self) -> f64 { self.inner.relative_energy_imbalance }
}

#[wasm_bindgen]
pub struct WasmThermalReferenceResult { inner: ThermalReferenceResult }

#[wasm_bindgen]
impl WasmThermalReferenceResult {
    #[wasm_bindgen(getter)] pub fn temperature_k(&self) -> Vec<f64> { self.inner.temperature_k.clone() }
    #[wasm_bindgen(getter)] pub fn iterations(&self) -> usize { self.inner.iterations }
    #[wasm_bindgen(getter)] pub fn relative_residual(&self) -> f64 { self.inner.relative_residual }
    #[wasm_bindgen(getter)] pub fn heat_flux_wm2(&self) -> Vec<f64> { self.inner.fields.heat_flux_wm2.clone() }
    #[wasm_bindgen(getter)] pub fn face_heat_flux_wm2(&self) -> Vec<f64> { self.inner.fields.face_heat_flux_wm2.clone() }
    #[wasm_bindgen(getter)] pub fn face_areas_m2(&self) -> Vec<f64> { self.inner.fields.face_areas_m2.clone() }
    #[wasm_bindgen(getter)] pub fn heat_input_w(&self) -> f64 { self.inner.fields.heat_input_w }
    #[wasm_bindgen(getter)] pub fn heat_output_w(&self) -> f64 { self.inner.fields.heat_output_w }
    #[wasm_bindgen(getter)] pub fn relative_energy_imbalance(&self) -> f64 { self.inner.fields.relative_energy_imbalance }
}

fn input(value: JsValue) -> Result<ThermalReferenceInput, JsValue> {
    serde_wasm_bindgen::from_value(value)
        .map_err(|error| js_sys::Error::new(&format!("invalid thermal reference input: {error}")).into())
}

#[wasm_bindgen]
pub fn solve_thermal_reference_wasm(value: JsValue) -> Result<WasmThermalReferenceResult, JsValue> {
    Ok(WasmThermalReferenceResult { inner: solve_thermal_reference(&input(value)?)
        .map_err(|error| js_sys::Error::new(&error))? })
}

#[wasm_bindgen]
pub fn evaluate_thermal_field_wasm(value: JsValue, temperature_k: Vec<f64>) -> Result<WasmThermalFieldEvaluation, JsValue> {
    Ok(WasmThermalFieldEvaluation { inner: evaluate_thermal_field(&input(value)?, &temperature_k)
        .map_err(|error| js_sys::Error::new(&error))? })
}
