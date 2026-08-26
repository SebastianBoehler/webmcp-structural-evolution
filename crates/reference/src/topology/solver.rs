use super::grid::Grid;

#[derive(Clone, Copy)]
pub(crate) struct Spring {
    pub left: usize,
    pub right: usize,
    pub direction: [f32; 3],
    pub length_m: f32,
    pub area_m2: f32,
    pub youngs_modulus_pa: f32,
}

pub(crate) fn springs(grid: &Grid) -> Vec<Spring> {
    let [width, height, depth] = grid.dimensions;
    let offsets = [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
        [1, 1, 0],
        [1, 0, 1],
        [0, 1, 1],
    ];
    let mut result = Vec::new();
    for z in 0..depth {
        for y in 0..height {
            for x in 0..width {
                for [dx, dy, dz] in offsets {
                    let neighbor = [x as isize + dx, y as isize + dy, z as isize + dz];
                    if neighbor[0] < 0
                        || neighbor[1] < 0
                        || neighbor[2] < 0
                        || neighbor[0] >= width as isize
                        || neighbor[1] >= height as isize
                        || neighbor[2] >= depth as isize
                    {
                        continue;
                    }
                    let delta = [
                        dx as f32 * grid.cell_size_m[0],
                        dy as f32 * grid.cell_size_m[1],
                        dz as f32 * grid.cell_size_m[2],
                    ];
                    let length = delta.iter().map(|value| value * value).sum::<f32>().sqrt();
                    let representative_area =
                        (grid.cell_size_m[0] * grid.cell_size_m[1] * grid.cell_size_m[2])
                            .powf(2.0 / 3.0);
                    result.push(Spring {
                        left: grid.index(x, y, z),
                        right: grid.index(
                            neighbor[0] as usize,
                            neighbor[1] as usize,
                            neighbor[2] as usize,
                        ),
                        direction: [delta[0] / length, delta[1] / length, delta[2] / length],
                        length_m: length,
                        area_m2: representative_area,
                        youngs_modulus_pa: grid.youngs_modulus_pa,
                    });
                }
            }
        }
    }
    result
}

fn spring_stiffness(spring: Spring, density: &[f32]) -> f32 {
    let average = (density[spring.left] + density[spring.right]) * 0.5;
    // SIMP penalization on a physically dimensioned axial spring lattice: EA/L in N/m.
    solid_stiffness(spring) * (1.0e-5 + average.powi(3))
}

fn solid_stiffness(spring: Spring) -> f32 {
    spring.youngs_modulus_pa * spring.area_m2 / spring.length_m.max(1.0e-6)
}

fn apply_operator(grid: &Grid, springs: &[Spring], density: &[f32], x: &[f32], y: &mut [f32]) {
    y.fill(0.0);
    for &spring in springs {
        let left = spring.left * 3;
        let right = spring.right * 3;
        let relative = spring
            .direction
            .iter()
            .enumerate()
            .map(|(axis, direction)| direction * (x[left + axis] - x[right + axis]))
            .sum::<f32>();
        let force = spring_stiffness(spring, density) * relative;
        for (axis, direction) in spring.direction.iter().copied().enumerate() {
            y[left + axis] += force * direction;
            y[right + axis] -= force * direction;
        }
    }
    for (dof, fixed) in grid.fixed_dofs.iter().copied().enumerate() {
        if fixed {
            y[dof] = x[dof];
        }
    }
}

fn diagonal(grid: &Grid, springs: &[Spring], density: &[f32]) -> Vec<f32> {
    let mut diagonal = vec![1.0e-6; grid.node_count() * 3];
    for &spring in springs {
        let stiffness = spring_stiffness(spring, density);
        for (axis, direction) in spring.direction.iter().copied().enumerate() {
            let contribution = stiffness * direction * direction;
            diagonal[spring.left * 3 + axis] += contribution;
            diagonal[spring.right * 3 + axis] += contribution;
        }
    }
    for (dof, fixed) in grid.fixed_dofs.iter().copied().enumerate() {
        if fixed {
            diagonal[dof] = 1.0;
        }
    }
    diagonal
}

fn dot(left: &[f32], right: &[f32]) -> f32 {
    left.iter().zip(right).map(|(a, b)| a * b).sum()
}

pub(crate) fn solve(grid: &Grid, springs: &[Spring], density: &[f32], load: &[f32]) -> Vec<f32> {
    let diagonal = diagonal(grid, springs, density);
    let mut rhs = load.to_vec();
    for (dof, fixed) in grid.fixed_dofs.iter().copied().enumerate() {
        if fixed {
            rhs[dof] = 0.0;
        }
    }
    let mut x = vec![0.0; rhs.len()];
    let mut residual = rhs.clone();
    let mut z: Vec<f32> = residual.iter().zip(&diagonal).map(|(r, d)| r / d).collect();
    let mut direction = z.clone();
    let mut rz = dot(&residual, &z);
    let rhs_norm = dot(&rhs, &rhs).sqrt().max(1.0e-9);
    let mut product = vec![0.0; rhs.len()];
    for _ in 0..32 {
        apply_operator(grid, springs, density, &direction, &mut product);
        let denominator = dot(&direction, &product);
        if denominator.abs() < 1.0e-12 {
            break;
        }
        let alpha = rz / denominator;
        for index in 0..x.len() {
            x[index] += alpha * direction[index];
            residual[index] -= alpha * product[index];
        }
        if dot(&residual, &residual).sqrt() / rhs_norm < 2.0e-5 {
            break;
        }
        z.iter_mut()
            .enumerate()
            .for_each(|(index, value)| *value = residual[index] / diagonal[index]);
        let next_rz = dot(&residual, &z);
        let beta = next_rz / rz.max(1.0e-20);
        for index in 0..direction.len() {
            direction[index] = z[index] + beta * direction[index];
        }
        rz = next_rz;
    }
    x
}

pub(crate) fn compliance_and_sensitivity(
    grid: &Grid,
    springs: &[Spring],
    density: &[f32],
) -> (f32, f32, Vec<f32>, f32, Vec<f32>, Vec<f32>) {
    let mut compliance = 0.0;
    let mut max_displacement = 0.0_f32;
    let mut sensitivity = vec![0.0; density.len()];
    let mut max_stress = 0.0_f32;
    let mut displacement_field = vec![0.0_f32; density.len()];
    let mut stress_field = vec![0.0_f32; density.len()];
    for load in &grid.load_cases {
        let displacement = solve(grid, springs, density, load);
        compliance += dot(load, &displacement);
        for (node, vector) in displacement.chunks_exact(3).enumerate() {
            let magnitude = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
            max_displacement = max_displacement.max(magnitude);
            displacement_field[node] = displacement_field[node].max(magnitude);
        }
        for &spring in springs {
            let left = spring.left * 3;
            let right = spring.right * 3;
            let extension = spring
                .direction
                .iter()
                .enumerate()
                .map(|(axis, direction)| {
                    direction * (displacement[left + axis] - displacement[right + axis])
                })
                .sum::<f32>();
            let average = ((density[spring.left] + density[spring.right]) * 0.5).max(0.001);
            let axial_force = spring_stiffness(spring, density) * extension;
            // Stress is a property of the thresholded printable load path. Near-void SIMP
            // springs stabilize the solve but are absent from the manufactured part and must
            // not define its peak stress or safety factor.
            if average >= 0.32 {
                let effective_area = (spring.area_m2 * average.powi(3)).max(1.0e-12);
                let stress = axial_force.abs() / effective_area;
                max_stress = max_stress.max(stress);
                stress_field[spring.left] = stress_field[spring.left].max(stress);
                stress_field[spring.right] = stress_field[spring.right].max(stress);
            }
            // Each endpoint owns half of d(EA/L * rho^3) / d(rho). Retaining EA/L is
            // essential: omitting it changes the optimized layout when the mesh is refined.
            let derivative =
                -1.5 * solid_stiffness(spring) * average.powi(2) * extension * extension;
            sensitivity[spring.left] += derivative;
            sensitivity[spring.right] += derivative;
        }
    }
    (
        compliance,
        max_displacement,
        sensitivity,
        max_stress,
        displacement_field,
        stress_field,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn two_node_grid() -> Grid {
        Grid {
            dimensions: [2, 1, 1],
            coordinates: vec![[0.0, 0.0, 0.0], [0.01, 0.0, 0.0]],
            passive_solid: vec![false; 2],
            passive_void: vec![false; 2],
            fixed_dofs: vec![true, true, true, false, false, false],
            load_cases: vec![vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0]],
            cell_size_m: [0.01, 0.01, 0.01],
            youngs_modulus_pa: 3_500_000_000.0,
            failure_stress_pa: 50_000_000.0,
            minimum_load_path_width_m: 0.01,
            minimum_frame_thickness_m: 0.005,
            load_path_guides: vec![],
        }
    }

    #[test]
    fn near_void_stabilization_springs_do_not_define_printed_peak_stress() {
        let grid = two_node_grid();
        let links = springs(&grid);
        let (_, _, _, void_stress, _, _) = compliance_and_sensitivity(&grid, &links, &[0.02, 0.02]);
        let (_, _, _, solid_stress, _, _) = compliance_and_sensitivity(&grid, &links, &[1.0, 1.0]);

        assert_eq!(void_stress, 0.0);
        assert!(solid_stress > 0.0);
    }
}
