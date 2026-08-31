mod grid;
#[cfg(test)]
mod grid_tests;
mod inertial_relief;
mod optimize;
mod raster;
mod solver;
#[cfg(test)]
mod solver_tests;
mod structural;
mod structural_element;
mod structural_field;
mod structural_wasm;

use serde::Deserialize;
use wasm_bindgen::prelude::*;

use optimize::optimize_assembly_frame as optimize_live_assembly;
pub use optimize::optimize_drone_frame;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssemblySolverInput {
    pub grid: SolverGridInput,
    pub design_domain: Vec<SolverVolume>,
    pub load_cases: Vec<LoadCaseInput>,
    pub supports: Vec<SolverVolume>,
    pub required_solids: Vec<SolverVolume>,
    pub protected_voids: Vec<SolverVolume>,
    pub access_voids: Vec<SolverVolume>,
    pub load_path_guides: Vec<LoadPathGuideInput>,
    pub material: SolverMaterial,
    pub minimum_feature_m: f32,
    pub minimum_load_path_width_m: f32,
    pub minimum_frame_thickness_m: f32,
    pub inertial_relief: bool,
    pub inertial_masses: Vec<InertialMassInput>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadCaseInput {
    pub id: String,
    pub loads: Vec<LoadInput>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadInput {
    pub region: SolverVolume,
    pub force_n: [f32; 3],
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InertialMassInput {
    pub center_m: [f32; 3],
    pub mass_kg: f32,
    pub inertia_tensor_kg_m2: [[f32; 3]; 3],
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadPathGuideInput {
    pub id: String,
    pub points_m: Vec<[f32; 3]>,
    pub member_width_m: f32,
    pub frame_thickness_m: f32,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolverGridInput {
    pub dimensions: SolverDimensions,
    pub origin_m: [f32; 3],
    pub cell_size_m: [f32; 3],
}

#[derive(Clone, Deserialize)]
pub struct SolverDimensions {
    pub width: usize,
    pub height: usize,
    pub depth: usize,
}

#[derive(Clone, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum SolverVolume {
    Box {
        center_m: [f32; 3],
        size_m: [f32; 3],
        yaw_rad: f32,
    },
    Cylinder {
        center_m: [f32; 3],
        radius_m: f32,
        height_m: f32,
        yaw_rad: f32,
    },
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SolverMaterial {
    pub youngs_modulus_pa: f32,
    pub failure_stress_pa: f32,
}

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
    pub case_ids: Vec<String>,
    pub density: Vec<f32>,
    pub displacement: Vec<f32>,
    pub stress: Vec<f32>,
    pub case_displacement: Vec<f32>,
    pub case_stress: Vec<f32>,
    pub passive_solid_indices: Vec<usize>,
    pub passive_void_indices: Vec<usize>,
    pub initial_compliance: f32,
    pub final_compliance: f32,
    pub max_displacement: f32,
    pub max_stress: f32,
    pub minimum_safety_factor: f32,
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
    pub fn width(&self) -> usize {
        self.inner.dimensions[0]
    }
    #[wasm_bindgen(getter)]
    pub fn height(&self) -> usize {
        self.inner.dimensions[1]
    }
    #[wasm_bindgen(getter)]
    pub fn depth(&self) -> usize {
        self.inner.dimensions[2]
    }
    #[wasm_bindgen(getter)]
    pub fn case_ids(&self) -> Vec<String> {
        self.inner.case_ids.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn density(&self) -> Vec<f32> {
        self.inner.density.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn displacement(&self) -> Vec<f32> {
        self.inner.displacement.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn stress(&self) -> Vec<f32> {
        self.inner.stress.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn case_displacement(&self) -> Vec<f32> {
        self.inner.case_displacement.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn case_stress(&self) -> Vec<f32> {
        self.inner.case_stress.clone()
    }
    #[wasm_bindgen(getter)]
    pub fn initial_compliance(&self) -> f32 {
        self.inner.initial_compliance
    }
    #[wasm_bindgen(getter)]
    pub fn final_compliance(&self) -> f32 {
        self.inner.final_compliance
    }
    #[wasm_bindgen(getter)]
    pub fn max_displacement(&self) -> f32 {
        self.inner.max_displacement
    }
    #[wasm_bindgen(getter)]
    pub fn max_stress(&self) -> f32 {
        self.inner.max_stress
    }
    #[wasm_bindgen(getter)]
    pub fn minimum_safety_factor(&self) -> f32 {
        self.inner.minimum_safety_factor
    }
    #[wasm_bindgen(getter)]
    pub fn material_fraction(&self) -> f32 {
        self.inner.material_fraction
    }
    #[wasm_bindgen(getter)]
    pub fn iterations(&self) -> usize {
        self.inner.iterations
    }
}

#[wasm_bindgen]
pub fn optimize_demo_frame(preset: &str) -> Result<WasmTopologyResult, JsValue> {
    let preset = match preset {
        "lightweight" => OptimizationPreset::Lightweight,
        "balanced" => OptimizationPreset::Balanced,
        "stiffness" => OptimizationPreset::Stiffness,
        _ => {
            return Err(
                js_sys::Error::new("preset must be lightweight, balanced, or stiffness").into(),
            )
        }
    };
    Ok(WasmTopologyResult {
        inner: optimize_drone_frame(preset),
    })
}

#[wasm_bindgen]
pub fn optimize_assembly_frame(
    preset: &str,
    input: JsValue,
) -> Result<WasmTopologyResult, JsValue> {
    let preset = match preset {
        "lightweight" => OptimizationPreset::Lightweight,
        "balanced" => OptimizationPreset::Balanced,
        "stiffness" => OptimizationPreset::Stiffness,
        _ => {
            return Err(
                js_sys::Error::new("preset must be lightweight, balanced, or stiffness").into(),
            )
        }
    };
    let input: AssemblySolverInput = serde_wasm_bindgen::from_value(input)
        .map_err(|error| js_sys::Error::new(&format!("invalid live assembly input: {error}")))?;
    Ok(WasmTopologyResult {
        inner: optimize_live_assembly(preset, &input)
            .map_err(|error| js_sys::Error::new(&error))?,
    })
}
