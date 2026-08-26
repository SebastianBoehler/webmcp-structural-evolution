mod grid;
mod optimize;
mod solver;

use wasm_bindgen::prelude::*;

pub use optimize::optimize_drone_frame;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OptimizationPreset {
    Lightweight,
    Balanced,
    Stiffness,
}

impl OptimizationPreset {
    pub(crate) fn volume_fraction(self) -> f32 {
        match self {
            Self::Lightweight => 0.28,
            Self::Balanced => 0.36,
            Self::Stiffness => 0.46,
        }
    }
}

#[derive(Clone, Debug)]
pub struct TopologyResult {
    pub dimensions: [usize; 3],
    pub density: Vec<f32>,
    pub passive_solid_indices: Vec<usize>,
    pub passive_void_indices: Vec<usize>,
    pub initial_compliance: f32,
    pub final_compliance: f32,
    pub max_displacement: f32,
    pub material_fraction: f32,
    pub iterations: usize,
}

#[wasm_bindgen]
pub struct WasmTopologyResult {
    inner: TopologyResult,
}

#[wasm_bindgen]
impl WasmTopologyResult {
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> usize { self.inner.dimensions[0] }
    #[wasm_bindgen(getter)]
    pub fn height(&self) -> usize { self.inner.dimensions[1] }
    #[wasm_bindgen(getter)]
    pub fn depth(&self) -> usize { self.inner.dimensions[2] }
    #[wasm_bindgen(getter)]
    pub fn density(&self) -> Vec<f32> { self.inner.density.clone() }
    #[wasm_bindgen(getter)]
    pub fn initial_compliance(&self) -> f32 { self.inner.initial_compliance }
    #[wasm_bindgen(getter)]
    pub fn final_compliance(&self) -> f32 { self.inner.final_compliance }
    #[wasm_bindgen(getter)]
    pub fn max_displacement(&self) -> f32 { self.inner.max_displacement }
    #[wasm_bindgen(getter)]
    pub fn material_fraction(&self) -> f32 { self.inner.material_fraction }
    #[wasm_bindgen(getter)]
    pub fn iterations(&self) -> usize { self.inner.iterations }
}

#[wasm_bindgen]
pub fn optimize_demo_frame(preset: &str) -> Result<WasmTopologyResult, JsValue> {
    let preset = match preset {
        "lightweight" => OptimizationPreset::Lightweight,
        "balanced" => OptimizationPreset::Balanced,
        "stiffness" => OptimizationPreset::Stiffness,
        _ => return Err(js_sys::Error::new("preset must be lightweight, balanced, or stiffness").into()),
    };
    Ok(WasmTopologyResult { inner: optimize_drone_frame(preset) })
}
