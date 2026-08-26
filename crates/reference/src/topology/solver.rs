use super::grid::Grid;

#[derive(Clone, Copy)]
pub(crate) struct Spring {
    pub left: usize,
    pub right: usize,
    pub direction: [f32; 3],
}

pub(crate) fn springs(grid: &Grid) -> Vec<Spring> {
    let [width, height, depth] = grid.dimensions;
    let offsets = [
        [1, 0, 0], [0, 1, 0], [0, 0, 1],
        [1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1],
        [0, 1, 1], [0, 1, -1], [1, 1, 1], [1, 1, -1],
        [1, -1, 1], [1, -1, -1],
    ];
    let mut result = Vec::new();
    for z in 0..depth {
        for y in 0..height {
            for x in 0..width {
                for [dx, dy, dz] in offsets {
                    let neighbor = [x as isize + dx, y as isize + dy, z as isize + dz];
                    if neighbor[0] < 0 || neighbor[1] < 0 || neighbor[2] < 0
                        || neighbor[0] >= width as isize
                        || neighbor[1] >= height as isize
                        || neighbor[2] >= depth as isize { continue; }
                    let length = ((dx * dx + dy * dy + dz * dz) as f32).sqrt();
                    result.push(Spring {
                        left: grid.index(x, y, z),
                        right: grid.index(neighbor[0] as usize, neighbor[1] as usize, neighbor[2] as usize),
                        direction: [dx as f32 / length, dy as f32 / length, dz as f32 / length],
                    });
                }
            }
        }
    }
    result
}

fn spring_stiffness(spring: Spring, density: &[f32]) -> f32 {
    let average = (density[spring.left] + density[spring.right]) * 0.5;
    1.0e-4 + average.powi(3)
}

fn apply_operator(grid: &Grid, springs: &[Spring], density: &[f32], x: &[f32], y: &mut [f32]) {
    y.fill(0.0);
    for &spring in springs {
        let left = spring.left * 3;
        let right = spring.right * 3;
        let relative = spring.direction.iter().enumerate().map(|(axis, direction)|
            direction * (x[left + axis] - x[right + axis])).sum::<f32>();
        let force = spring_stiffness(spring, density) * relative;
        for (axis, direction) in spring.direction.iter().copied().enumerate() {
            y[left + axis] += force * direction;
            y[right + axis] -= force * direction;
        }
    }
    for (dof, fixed) in grid.fixed_dofs.iter().copied().enumerate() {
        if fixed { y[dof] = x[dof]; }
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
        if fixed { diagonal[dof] = 1.0; }
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
        if fixed { rhs[dof] = 0.0; }
    }
    let mut x = vec![0.0; rhs.len()];
    let mut residual = rhs.clone();
    let mut z: Vec<f32> = residual.iter().zip(&diagonal).map(|(r, d)| r / d).collect();
    let mut direction = z.clone();
    let mut rz = dot(&residual, &z);
    let rhs_norm = dot(&rhs, &rhs).sqrt().max(1.0e-9);
    let mut product = vec![0.0; rhs.len()];
    for _ in 0..96 {
        apply_operator(grid, springs, density, &direction, &mut product);
        let denominator = dot(&direction, &product);
        if denominator.abs() < 1.0e-12 { break; }
        let alpha = rz / denominator;
        for index in 0..x.len() {
            x[index] += alpha * direction[index];
            residual[index] -= alpha * product[index];
        }
        if dot(&residual, &residual).sqrt() / rhs_norm < 2.0e-5 { break; }
        z.iter_mut().enumerate().for_each(|(index, value)| *value = residual[index] / diagonal[index]);
        let next_rz = dot(&residual, &z);
        let beta = next_rz / rz.max(1.0e-20);
        for index in 0..direction.len() { direction[index] = z[index] + beta * direction[index]; }
        rz = next_rz;
    }
    x
}

pub(crate) fn compliance_and_sensitivity(
    grid: &Grid,
    springs: &[Spring],
    density: &[f32],
) -> (f32, f32, Vec<f32>) {
    let mut compliance = 0.0;
    let mut max_displacement = 0.0_f32;
    let mut sensitivity = vec![0.0; density.len()];
    for load in &grid.load_cases {
        let displacement = solve(grid, springs, density, load);
        compliance += dot(load, &displacement);
        for vector in displacement.chunks_exact(3) {
            max_displacement = max_displacement.max(vector.iter().map(|value| value * value).sum::<f32>().sqrt());
        }
        for &spring in springs {
            let left = spring.left * 3;
            let right = spring.right * 3;
            let extension = spring.direction.iter().enumerate().map(|(axis, direction)|
                direction * (displacement[left + axis] - displacement[right + axis])).sum::<f32>();
            let average = ((density[spring.left] + density[spring.right]) * 0.5).max(0.001);
            let derivative = -1.5 * average.powi(2) * extension * extension;
            sensitivity[spring.left] += derivative;
            sensitivity[spring.right] += derivative;
        }
    }
    (compliance, max_displacement, sensitivity)
}
