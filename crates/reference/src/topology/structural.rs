use serde::Deserialize;

use super::structural_element::{apply, diagonal, stiffness, von_mises};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuralReferenceInput {
    pub cell_dimensions: [usize; 3],
    pub cell_size_m: f64,
    pub active_cells: Vec<u32>,
    pub fixed_dofs: Vec<u32>,
    pub loads_n: Vec<f64>,
    pub youngs_modulus_pa: f64,
    pub poisson_ratio: f64,
    pub max_iterations: usize,
    pub tolerance: f64,
}

pub struct StructuralReferenceResult {
    pub displacement_m: Vec<f32>,
    pub von_mises_stress_pa: Vec<f32>,
    pub iterations: usize,
    pub relative_residual: f64,
    pub force_balance_error_n: f64,
    pub compliance_j: f64,
    #[cfg(test)]
    pub observed_displacement_m: f64,
}

#[cfg(test)]
pub struct StructuralFixture {
    pub(crate) input: StructuralReferenceInput,
    observed_nodes: Vec<usize>,
    observed_axis: usize,
    pub applied_force_n: f64,
    pub length_m: f64,
    pub cross_section_m2: f64,
    pub second_moment_m4: f64,
    pub youngs_modulus_pa: f64,
}

fn dot(left: &[f64], right: &[f64]) -> f64 {
    left.iter().zip(right).map(|(a, b)| a * b).sum()
}

pub(super) fn validate(input: &StructuralReferenceInput) -> Result<(), String> {
    let cells = input.cell_dimensions.iter().product::<usize>();
    let nodes = input
        .cell_dimensions
        .iter()
        .map(|value| value + 1)
        .product::<usize>();
    if cells == 0
        || input.active_cells.len() != cells
        || input.loads_n.len() != nodes * 3
        || input.fixed_dofs.len() != nodes * 3
        || input.max_iterations == 0
        || !input.cell_size_m.is_finite()
        || input.cell_size_m <= 0.0
        || !input.youngs_modulus_pa.is_finite()
        || input.youngs_modulus_pa <= 0.0
        || !input.poisson_ratio.is_finite()
        || input.poisson_ratio <= -1.0
        || input.poisson_ratio >= 0.5
        || !input.tolerance.is_finite()
        || input.tolerance <= 0.0
        || input.active_cells.iter().any(|value| *value > 1)
        || input.fixed_dofs.iter().any(|value| *value > 1)
        || input.loads_n.iter().any(|value| !value.is_finite())
    {
        return Err("invalid bounded structural reference input".into());
    }
    Ok(())
}

pub fn solve_reference(
    input: &StructuralReferenceInput,
) -> Result<StructuralReferenceResult, String> {
    validate(input)?;
    let ke = stiffness(input);
    let diag = diagonal(input, &ke);
    let mut rhs = input.loads_n.clone();
    for (index, fixed) in input.fixed_dofs.iter().copied().enumerate() {
        if fixed != 0 {
            rhs[index] = 0.0;
        }
    }
    let rhs_norm = dot(&rhs, &rhs).sqrt();
    if rhs_norm == 0.0 {
        return Err("structural reference has no free applied load".into());
    }
    let mut x = vec![0.0; rhs.len()];
    let mut residual = rhs.clone();
    let mut z: Vec<f64> = residual.iter().zip(&diag).map(|(r, d)| r / d).collect();
    let mut direction = z.clone();
    let mut rz = dot(&residual, &z);
    let mut product = vec![0.0; rhs.len()];
    let mut relative_residual = 1.0;
    let mut iterations = 0;
    for iteration in 0..input.max_iterations {
        apply(input, &ke, &direction, &mut product);
        let denominator = dot(&direction, &product);
        if !denominator.is_finite() || denominator <= 0.0 {
            return Err("structural reference operator is not positive definite".into());
        }
        let alpha = rz / denominator;
        for index in 0..x.len() {
            if input.fixed_dofs[index] == 0 {
                x[index] += alpha * direction[index];
                residual[index] -= alpha * product[index];
            }
        }
        iterations = iteration + 1;
        relative_residual = dot(&residual, &residual).sqrt() / rhs_norm;
        if relative_residual <= input.tolerance {
            break;
        }
        for index in 0..z.len() {
            z[index] = residual[index] / diag[index];
        }
        let next_rz = dot(&residual, &z);
        let beta = next_rz / rz;
        for index in 0..direction.len() {
            direction[index] = if input.fixed_dofs[index] == 0 {
                z[index] + beta * direction[index]
            } else {
                0.0
            };
        }
        rz = next_rz;
    }
    if relative_residual > input.tolerance {
        return Err(format!(
            "structural reference did not converge: {relative_residual:e}"
        ));
    }
    apply(input, &ke, &x, &mut product);
    let mut balance = [0.0; 3];
    for (dof, fixed) in input.fixed_dofs.iter().copied().enumerate() {
        if fixed != 0 {
            balance[dof % 3] += product[dof];
        }
        balance[dof % 3] += input.loads_n[dof];
    }
    Ok(StructuralReferenceResult {
        displacement_m: x.iter().map(|value| *value as f32).collect(),
        von_mises_stress_pa: von_mises(input, &x),
        iterations,
        relative_residual,
        force_balance_error_n: balance
            .iter()
            .map(|value| value * value)
            .sum::<f64>()
            .sqrt(),
        compliance_j: dot(&input.loads_n, &x),
        #[cfg(test)]
        observed_displacement_m: 0.0,
    })
}

#[cfg(test)]
pub fn solve_structural(fixture: &StructuralFixture) -> Result<StructuralReferenceResult, String> {
    let mut result = solve_reference(&fixture.input)?;
    result.observed_displacement_m = fixture
        .observed_nodes
        .iter()
        .map(|node| f64::from(result.displacement_m[node * 3 + fixture.observed_axis]))
        .sum::<f64>()
        / fixture.observed_nodes.len() as f64;
    Ok(result)
}

#[cfg(test)]
fn prism_fixture(
    dimensions: [usize; 3],
    cell_size_m: f64,
    force: [f64; 3],
    observed_axis: usize,
    youngs_modulus_pa: f64,
) -> StructuralFixture {
    let nodes = dimensions.iter().map(|value| value + 1).product::<usize>();
    let mut fixed_dofs = vec![0; nodes * 3];
    let mut loads_n = vec![0.0; nodes * 3];
    let node_width = dimensions[0] + 1;
    let node_plane = node_width * (dimensions[1] + 1);
    let mut observed_nodes = Vec::new();
    for z in 0..=dimensions[2] {
        for y in 0..=dimensions[1] {
            let fixed = y * node_width + z * node_plane;
            fixed_dofs[fixed * 3..fixed * 3 + 3].fill(1);
            observed_nodes.push(dimensions[0] + y * node_width + z * node_plane);
        }
    }
    for node in &observed_nodes {
        for axis in 0..3 {
            loads_n[node * 3 + axis] = force[axis] / observed_nodes.len() as f64;
        }
    }
    let length_m = dimensions[0] as f64 * cell_size_m;
    let height = dimensions[1] as f64 * cell_size_m;
    let width = dimensions[2] as f64 * cell_size_m;
    StructuralFixture {
        input: StructuralReferenceInput {
            cell_dimensions: dimensions,
            cell_size_m,
            active_cells: vec![1; dimensions.iter().product()],
            fixed_dofs,
            loads_n,
            youngs_modulus_pa,
            poisson_ratio: 0.3,
            max_iterations: 1_500,
            tolerance: 1.0e-6,
        },
        observed_nodes,
        observed_axis,
        applied_force_n: force.iter().map(|value| value.abs()).sum(),
        length_m,
        cross_section_m2: height * width,
        second_moment_m4: width * height.powi(3) / 12.0,
        youngs_modulus_pa,
    }
}

#[cfg(test)]
pub fn axial_bar_fixture() -> StructuralFixture {
    axial_fixture([20, 2, 2], 0.005, 1_000.0, 70.0e9)
}

#[cfg(test)]
pub fn cantilever_fixture() -> StructuralFixture {
    prism_fixture([24, 4, 2], 0.005, [0.0, -100.0, 0.0], 1, 70.0e9)
}

#[cfg(test)]
pub fn axial_fixture(
    dimensions: [usize; 3],
    cell_size_m: f64,
    force_n: f64,
    youngs_modulus_pa: f64,
) -> StructuralFixture {
    prism_fixture(
        dimensions,
        cell_size_m,
        [force_n, 0.0, 0.0],
        0,
        youngs_modulus_pa,
    )
}
