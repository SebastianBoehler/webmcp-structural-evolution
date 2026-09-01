use serde::Deserialize;

const MAX_CELLS: usize = 262_144;
const MAX_BOUNDARY_FACES: usize = 1_048_576;
const MAX_ITERATIONS: usize = 4_096;
const TOLERANCE: f64 = 1.0e-12;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalGrid { pub cell_dimensions: [usize; 3], pub cell_size_m: f64 }

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalDirichletCell { pub cell_index: usize, pub temperature_k: f64 }

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalNeumannFace {
    pub cell_index: usize, pub axis: usize, pub direction: i32,
    pub area_m2: f64, pub heat_flux_wm2: f64,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalCapability { pub max_cells: usize, pub max_boundary_faces: usize }

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalReferenceInput {
    pub grid: ThermalGrid, pub active_cells: Vec<u32>, pub active_cell_count: usize,
    pub conductivity_wm_k: Vec<f32>, pub dirichlet_cells: Vec<ThermalDirichletCell>,
    pub neumann_faces: Vec<ThermalNeumannFace>, pub capability: ThermalCapability,
}

pub struct ThermalFieldEvaluation {
    pub heat_flux_wm2: Vec<f64>, pub face_heat_flux_wm2: Vec<f64>, pub face_areas_m2: Vec<f64>,
    pub heat_input_w: f64, pub heat_output_w: f64, pub energy_imbalance_w: f64,
    pub relative_energy_imbalance: f64,
}

pub struct ThermalReferenceResult {
    pub temperature_k: Vec<f64>, pub iterations: usize, pub relative_residual: f64,
    pub fields: ThermalFieldEvaluation,
}

struct System<'a> {
    input: &'a ThermalReferenceInput, count: usize, face_area: f64,
    fixed: Vec<Option<f64>>, source: Vec<f64>, diagonal: Vec<f64>, rhs: Vec<f64>,
}

fn neighbor(dimensions: [usize; 3], cell: usize, axis: usize, direction: i32) -> Option<usize> {
    let width = dimensions[0]; let plane = width * dimensions[1];
    let coordinates = [cell % width, (cell % plane) / width, cell / plane];
    if direction < 0 && coordinates[axis] == 0
        || direction > 0 && coordinates[axis] + 1 == dimensions[axis] { return None; }
    let stride = [1, width, plane][axis];
    Some(if direction < 0 { cell - stride } else { cell + stride })
}

fn conductance(input: &ThermalReferenceInput, left: usize, right: usize, face_area: f64) -> f64 {
    let left = f64::from(input.conductivity_wm_k[left]);
    let right = f64::from(input.conductivity_wm_k[right]);
    (2.0 / (1.0 / left + 1.0 / right)) * face_area / input.grid.cell_size_m
}

fn validate(input: &ThermalReferenceInput) -> Result<System<'_>, String> {
    let count = input.grid.cell_dimensions.iter().try_fold(1_usize, |n, value| n.checked_mul(*value))
        .ok_or("thermal reference grid dimensions overflow")?;
    let boundary_count = input.dirichlet_cells.len().checked_add(input.neumann_faces.len())
        .ok_or("thermal reference boundary count overflow")?;
    let face_area = input.grid.cell_size_m * input.grid.cell_size_m;
    if input.grid.cell_dimensions.contains(&0) || count > MAX_CELLS || count > input.capability.max_cells
        || boundary_count > MAX_BOUNDARY_FACES || boundary_count > input.capability.max_boundary_faces
        || input.active_cells.len() != count || input.conductivity_wm_k.len() != count
        || input.active_cell_count != input.active_cells.iter().filter(|value| **value == 1).count()
        || !input.grid.cell_size_m.is_finite() || input.grid.cell_size_m <= 0.0
        || !face_area.is_finite() || face_area <= 0.0 || input.dirichlet_cells.is_empty() {
        return Err("invalid bounded thermal reference input".into());
    }
    for cell in 0..count { let active = input.active_cells[cell]; let conductivity = input.conductivity_wm_k[cell];
        if active > 1 || !conductivity.is_finite() || active == 1 && conductivity <= 0.0
            || active == 0 && conductivity != 0.0 { return Err("invalid thermal material field".into()); }
    }
    let reference = input.dirichlet_cells[0].temperature_k;
    if !reference.is_finite() { return Err("invalid thermal reference temperature".into()); }
    let mut fixed = vec![None; count];
    for boundary in &input.dirichlet_cells {
        if boundary.cell_index >= count || input.active_cells[boundary.cell_index] != 1
            || !boundary.temperature_k.is_finite() || fixed[boundary.cell_index].is_some() {
            return Err("invalid thermal fixed-temperature boundary".into());
        }
        fixed[boundary.cell_index] = Some(boundary.temperature_k - reference);
    }
    let mut anchored = vec![false; count];
    let mut frontier: Vec<usize> = input.dirichlet_cells.iter().map(|boundary| boundary.cell_index).collect();
    for cell in &frontier { anchored[*cell] = true; }
    while let Some(cell) = frontier.pop() { for axis in 0..3 { for direction in [-1, 1] {
        if let Some(adjacent) = neighbor(input.grid.cell_dimensions, cell, axis, direction)
            .filter(|index| input.active_cells[*index] == 1 && !anchored[*index]) {
            anchored[adjacent] = true; frontier.push(adjacent);
        }
    }}}
    if input.active_cells.iter().enumerate().any(|(cell, active)| *active == 1 && !anchored[cell]) {
        return Err("thermal active material island has no temperature reference".into());
    }
    let mut source = vec![0.0; count]; let mut occupied = vec![false; count * 6];
    for boundary in &input.neumann_faces {
        if boundary.cell_index >= count || input.active_cells[boundary.cell_index] != 1 || boundary.axis > 2
            || !matches!(boundary.direction, -1 | 1) || !boundary.area_m2.is_finite()
            || boundary.area_m2 <= 0.0 || boundary.area_m2 > face_area * (1.0 + 1.0e-12)
            || !boundary.heat_flux_wm2.is_finite() { return Err("invalid thermal heat-flux boundary".into()); }
        let adjacent = neighbor(input.grid.cell_dimensions, boundary.cell_index, boundary.axis, boundary.direction);
        if adjacent.is_some_and(|cell| input.active_cells[cell] == 1) { return Err("thermal heat-flux boundary is internal".into()); }
        let slot = boundary.cell_index * 6 + boundary.axis * 2 + usize::from(boundary.direction > 0);
        if occupied[slot] { return Err("thermal heat-flux boundary is duplicated".into()); }
        occupied[slot] = true; source[boundary.cell_index] += boundary.area_m2 * boundary.heat_flux_wm2;
        if !source[boundary.cell_index].is_finite() { return Err("thermal heat source is out of range".into()); }
    }
    let mut diagonal = vec![0.0; count]; let mut rhs = source.clone();
    for cell in 0..count { if input.active_cells[cell] == 0 || fixed[cell].is_some() { rhs[cell] = 0.0; continue; }
        for axis in 0..3 { for direction in [-1, 1] {
            let Some(adjacent) = neighbor(input.grid.cell_dimensions, cell, axis, direction) else { continue };
            if input.active_cells[adjacent] == 0 { continue; }
            let g = conductance(input, cell, adjacent, face_area); diagonal[cell] += g;
            if let Some(value) = fixed[adjacent] { rhs[cell] += g * value; }
        }}
        if !diagonal[cell].is_finite() || diagonal[cell] <= 0.0 || !rhs[cell].is_finite() {
            return Err("thermal reference contains an unconnected active cell".into());
        }
    }
    Ok(System { input, count, face_area, fixed, source, diagonal, rhs })
}

fn dot(left: &[f64], right: &[f64]) -> f64 { left.iter().zip(right).map(|(a, b)| a * b).sum() }

fn apply(system: &System<'_>, field: &[f64], output: &mut [f64]) {
    for cell in 0..system.count { output[cell] = 0.0;
        if system.input.active_cells[cell] == 0 || system.fixed[cell].is_some() { continue; }
        output[cell] = system.diagonal[cell] * field[cell];
        for axis in 0..3 { for direction in [-1, 1] {
            let Some(adjacent) = neighbor(system.input.grid.cell_dimensions, cell, axis, direction) else { continue };
            if system.input.active_cells[adjacent] == 1 && system.fixed[adjacent].is_none() {
                output[cell] -= conductance(system.input, cell, adjacent, system.face_area) * field[adjacent];
            }
        }}
    }
}

pub fn solve_thermal_reference(input: &ThermalReferenceInput) -> Result<ThermalReferenceResult, String> {
    let system = validate(input)?; let rhs_norm = dot(&system.rhs, &system.rhs).sqrt();
    let mut x = vec![0.0; system.count]; let mut residual = system.rhs.clone();
    let mut z: Vec<f64> = residual.iter().enumerate().map(|(i, r)| if system.fixed[i].is_none() && input.active_cells[i] == 1 { r / system.diagonal[i] } else { 0.0 }).collect();
    let mut direction = z.clone(); let mut rz = dot(&residual, &z); let mut product = vec![0.0; system.count];
    let mut relative_residual = if rhs_norm == 0.0 { 0.0 } else { 1.0 }; let mut iterations = 0;
    while relative_residual > TOLERANCE && iterations < MAX_ITERATIONS {
        apply(&system, &direction, &mut product); let denominator = dot(&direction, &product);
        if !denominator.is_finite() || denominator <= 0.0 { return Err("thermal reference operator is not positive definite".into()); }
        let alpha = rz / denominator;
        for cell in 0..system.count { if system.fixed[cell].is_none() && input.active_cells[cell] == 1 {
            x[cell] += alpha * direction[cell]; residual[cell] -= alpha * product[cell];
        }}
        iterations += 1; relative_residual = dot(&residual, &residual).sqrt() / rhs_norm;
        if relative_residual <= TOLERANCE { break; }
        for cell in 0..system.count { z[cell] = if system.fixed[cell].is_none() && input.active_cells[cell] == 1 { residual[cell] / system.diagonal[cell] } else { 0.0 }; }
        let next_rz = dot(&residual, &z); let beta = next_rz / rz;
        for cell in 0..system.count { direction[cell] = z[cell] + beta * direction[cell]; } rz = next_rz;
    }
    if !relative_residual.is_finite() || relative_residual > TOLERANCE { return Err(format!("thermal reference did not converge: {relative_residual:e}")); }
    let reference = input.dirichlet_cells[0].temperature_k;
    for cell in 0..system.count { x[cell] = system.fixed[cell].unwrap_or(x[cell]) + reference; }
    let fields = evaluate_with_system(&system, &x)?;
    Ok(ThermalReferenceResult { temperature_k: x, iterations, relative_residual, fields })
}

fn evaluate_with_system(system: &System<'_>, temperature: &[f64]) -> Result<ThermalFieldEvaluation, String> {
    if temperature.len() != system.count || temperature.iter().any(|value| !value.is_finite()) { return Err("thermal candidate temperature field must be finite and dimensionally exact".into()); }
    let mut face_flux = vec![0.0; system.count * 6]; let mut face_areas = vec![0.0; system.count * 6];
    for cell in 0..system.count { if system.input.active_cells[cell] == 0 { continue; }
        for axis in 0..3 { for direction in [-1, 1] { let slot = cell * 6 + axis * 2 + usize::from(direction > 0);
            if let Some(adjacent) = neighbor(system.input.grid.cell_dimensions, cell, axis, direction).filter(|i| system.input.active_cells[*i] == 1) {
                let k = conductance(system.input, cell, adjacent, system.face_area) * system.input.grid.cell_size_m / system.face_area;
                face_flux[slot] = -k * (temperature[adjacent] - temperature[cell]) / system.input.grid.cell_size_m;
                face_areas[slot] = system.face_area;
            }
        }}
    }
    for boundary in &system.input.neumann_faces { let slot = boundary.cell_index * 6 + boundary.axis * 2 + usize::from(boundary.direction > 0);
        face_flux[slot] = -boundary.heat_flux_wm2; face_areas[slot] = boundary.area_m2;
    }
    let mut heat_flux = vec![0.0; system.count * 3];
    for cell in 0..system.count { for axis in 0..3 { let minus = cell * 6 + axis * 2; let area = face_areas[minus] + face_areas[minus + 1];
        if area > 0.0 { heat_flux[cell * 3 + axis] = (-face_flux[minus] * face_areas[minus] + face_flux[minus + 1] * face_areas[minus + 1]) / area; }
    }}
    let mut powers = system.source.clone();
    for cell in 0..system.count { if system.fixed[cell].is_none() { continue; } let mut reaction = -system.source[cell];
        for axis in 0..3 { for direction in [-1, 1] { if let Some(adjacent) = neighbor(system.input.grid.cell_dimensions, cell, axis, direction).filter(|i| system.input.active_cells[*i] == 1) {
            reaction += conductance(system.input, cell, adjacent, system.face_area) * (temperature[cell] - temperature[adjacent]);
        }}} powers.push(reaction);
    }
    let heat_input_w: f64 = powers.iter().filter(|value| **value >= 0.0).sum();
    let heat_output_w: f64 = -powers.iter().filter(|value| **value < 0.0).sum::<f64>();
    let energy_imbalance_w = heat_input_w - heat_output_w; let imposed = heat_input_w.max(heat_output_w);
    let relative_energy_imbalance = if imposed == 0.0 { 0.0 } else { energy_imbalance_w.abs() / imposed };
    Ok(ThermalFieldEvaluation { heat_flux_wm2: heat_flux, face_heat_flux_wm2: face_flux, face_areas_m2: face_areas,
        heat_input_w, heat_output_w, energy_imbalance_w, relative_energy_imbalance })
}

pub fn evaluate_thermal_field(input: &ThermalReferenceInput, temperature: &[f64]) -> Result<ThermalFieldEvaluation, String> {
    let system = validate(input)?; evaluate_with_system(&system, temperature)
}

#[cfg(test)]
impl ThermalReferenceInput {
    fn bar(conductivity: impl Into<Vec<f32>>) -> Self { let conductivity_wm_k = conductivity.into(); let count = conductivity_wm_k.len(); Self {
        grid: ThermalGrid { cell_dimensions: [count, 1, 1], cell_size_m: 0.25 }, active_cells: vec![1; count], active_cell_count: count,
        conductivity_wm_k, dirichlet_cells: vec![ThermalDirichletCell { cell_index: 0, temperature_k: 300.0 }, ThermalDirichletCell { cell_index: count - 1, temperature_k: 400.0 }],
        neumann_faces: vec![], capability: ThermalCapability { max_cells: 1_024, max_boundary_faces: 1_024 },
    }}
    fn mixed() -> Self { let mut input = Self::bar([10.0; 5]); input.dirichlet_cells.pop(); input.neumann_faces.push(ThermalNeumannFace { cell_index: 4, axis: 0, direction: 1, area_m2: 0.0625, heat_flux_wm2: 100.0 }); input }
}

#[cfg(test)]
mod tests {
    use super::{evaluate_thermal_field, solve_thermal_reference, ThermalReferenceInput};
    #[test] fn one_material_bar_matches_the_hand_derived_linear_solution() { let solved = solve_thermal_reference(&ThermalReferenceInput::bar([10.0; 5])).unwrap(); assert_eq!(solved.temperature_k, [300.0, 325.0, 350.0, 375.0, 400.0]); assert!((solved.fields.heat_input_w - 62.5).abs() < 1.0e-10); assert!((solved.fields.heat_output_w - 62.5).abs() < 1.0e-10); }
    #[test] fn two_material_wall_uses_harmonic_interface_conductivity() { let solved = solve_thermal_reference(&ThermalReferenceInput::bar([10.0, 10.0, 1.0, 1.0])).unwrap(); for (actual, expected) in solved.temperature_k.iter().zip([300.0, 306.06060606060606, 339.3939393939394, 400.0]) { assert!((actual - expected).abs() < 1.0e-9); } assert!((solved.fields.heat_input_w - 15.15151515151515).abs() < 1.0e-9); }
    #[test] fn mixed_temperature_flux_fixture_balances_independently_evaluated_heat() { let input = ThermalReferenceInput::mixed(); let solved = solve_thermal_reference(&input).unwrap(); assert_eq!(solved.temperature_k, [300.0, 302.5, 305.0, 307.5, 310.0]); let field = evaluate_thermal_field(&input, &solved.temperature_k).unwrap(); assert!((field.heat_input_w - 6.25).abs() < 1.0e-10); assert!((field.heat_output_w - 6.25).abs() < 1.0e-10); assert!(field.relative_energy_imbalance < 1.0e-12); }
    #[test] fn disconnected_material_island_without_a_temperature_reference_is_rejected() { let mut input = ThermalReferenceInput::bar([10.0; 4]); input.active_cells = vec![1, 0, 1, 1]; input.active_cell_count = 3; input.conductivity_wm_k = vec![10.0, 0.0, 10.0, 10.0]; input.dirichlet_cells.pop(); let error = match solve_thermal_reference(&input) { Ok(_) => panic!("unanchored island was accepted"), Err(error) => error }; assert!(error.contains("temperature reference")); }
    #[test] fn fixed_cell_source_is_balanced_by_its_thermostat_without_entering_cg() { let mut input = ThermalReferenceInput::mixed(); input.grid.cell_dimensions = [1, 1, 1]; input.active_cells = vec![1]; input.active_cell_count = 1; input.conductivity_wm_k = vec![10.0]; input.neumann_faces[0].cell_index = 0; let solved = solve_thermal_reference(&input).unwrap(); assert_eq!(solved.temperature_k, [300.0]); assert_eq!(solved.iterations, 0); assert!((solved.fields.heat_input_w - 6.25).abs() < 1.0e-12); assert!((solved.fields.heat_output_w - 6.25).abs() < 1.0e-12); }
    #[test] fn total_boundary_face_count_is_bounded_before_solving() { let mut input = ThermalReferenceInput::bar([10.0; 5]); input.capability.max_boundary_faces = 1; assert!(solve_thermal_reference(&input).is_err()); }
}
