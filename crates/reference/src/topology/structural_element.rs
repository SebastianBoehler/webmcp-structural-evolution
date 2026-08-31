use super::structural::StructuralReferenceInput;

const SIGNS: [[f64; 3]; 8] = [
    [-1.0, -1.0, -1.0],
    [1.0, -1.0, -1.0],
    [-1.0, 1.0, -1.0],
    [1.0, 1.0, -1.0],
    [-1.0, -1.0, 1.0],
    [1.0, -1.0, 1.0],
    [-1.0, 1.0, 1.0],
    [1.0, 1.0, 1.0],
];

fn constitutive(youngs: f64, poisson: f64) -> [[f64; 6]; 6] {
    let lambda = youngs * poisson / ((1.0 + poisson) * (1.0 - 2.0 * poisson));
    let mu = youngs / (2.0 * (1.0 + poisson));
    let mut matrix = [[0.0; 6]; 6];
    for (row, values) in matrix.iter_mut().enumerate().take(3) {
        for (column, value) in values.iter_mut().enumerate().take(3) {
            *value = if row == column {
                lambda + 2.0 * mu
            } else {
                lambda
            };
        }
    }
    matrix[3][3] = mu;
    matrix[4][4] = mu;
    matrix[5][5] = mu;
    matrix
}

fn strain_matrix(xi: f64, eta: f64, zeta: f64, size: f64) -> [[f64; 24]; 6] {
    let mut matrix = [[0.0; 24]; 6];
    for (node, [sx, sy, sz]) in SIGNS.iter().copied().enumerate() {
        let dx = sx * (1.0 + sy * eta) * (1.0 + sz * zeta) / (4.0 * size);
        let dy = sy * (1.0 + sx * xi) * (1.0 + sz * zeta) / (4.0 * size);
        let dz = sz * (1.0 + sx * xi) * (1.0 + sy * eta) / (4.0 * size);
        let column = node * 3;
        matrix[0][column] = dx;
        matrix[1][column + 1] = dy;
        matrix[2][column + 2] = dz;
        matrix[3][column] = dy;
        matrix[3][column + 1] = dx;
        matrix[4][column + 1] = dz;
        matrix[4][column + 2] = dy;
        matrix[5][column] = dz;
        matrix[5][column + 2] = dx;
    }
    matrix
}

pub(super) fn stiffness(input: &StructuralReferenceInput) -> Vec<f64> {
    let elasticity = constitutive(input.youngs_modulus_pa, input.poisson_ratio);
    let mut result = vec![0.0; 24 * 24];
    let gauss = [-1.0 / 3.0_f64.sqrt(), 1.0 / 3.0_f64.sqrt()];
    let determinant = input.cell_size_m.powi(3) / 8.0;
    for xi in gauss {
        for eta in gauss {
            for zeta in gauss {
                let strain = strain_matrix(xi, eta, zeta, input.cell_size_m);
                for row in 0..24 {
                    for column in 0..24 {
                        let mut value = 0.0;
                        for a in 0..6 {
                            for b in 0..6 {
                                value += strain[a][row] * elasticity[a][b] * strain[b][column];
                            }
                        }
                        result[row * 24 + column] += value * determinant;
                    }
                }
            }
        }
    }
    result
}

pub(super) fn cell_nodes(input: &StructuralReferenceInput, cell: usize) -> [usize; 8] {
    let [width, height, _] = input.cell_dimensions;
    let plane = width * height;
    let z = cell / plane;
    let rest = cell - z * plane;
    let y = rest / width;
    let x = rest - y * width;
    let node_width = width + 1;
    let node_plane = node_width * (height + 1);
    let base = x + y * node_width + z * node_plane;
    [
        base,
        base + 1,
        base + node_width,
        base + node_width + 1,
        base + node_plane,
        base + node_plane + 1,
        base + node_plane + node_width,
        base + node_plane + node_width + 1,
    ]
}

pub(super) fn apply(input: &StructuralReferenceInput, ke: &[f64], x: &[f64], output: &mut [f64]) {
    output.fill(0.0);
    for (cell, active) in input.active_cells.iter().copied().enumerate() {
        if active == 0 {
            continue;
        }
        let nodes = cell_nodes(input, cell);
        for local_row in 0..24 {
            let row = nodes[local_row / 3] * 3 + local_row % 3;
            for local_column in 0..24 {
                let column = nodes[local_column / 3] * 3 + local_column % 3;
                output[row] += ke[local_row * 24 + local_column] * x[column];
            }
        }
    }
}

pub(super) fn diagonal(input: &StructuralReferenceInput, ke: &[f64]) -> Vec<f64> {
    let mut result = vec![0.0; input.loads_n.len()];
    for (cell, active) in input.active_cells.iter().copied().enumerate() {
        if active == 0 {
            continue;
        }
        let nodes = cell_nodes(input, cell);
        for local in 0..24 {
            result[nodes[local / 3] * 3 + local % 3] += ke[local * 24 + local];
        }
    }
    for (index, fixed) in input.fixed_dofs.iter().copied().enumerate() {
        if fixed != 0 {
            result[index] = 1.0;
        } else {
            result[index] = result[index].max(1.0e-20);
        }
    }
    result
}

pub(super) fn von_mises(input: &StructuralReferenceInput, displacement: &[f64]) -> Vec<f32> {
    let elasticity = constitutive(input.youngs_modulus_pa, input.poisson_ratio);
    let strain = strain_matrix(0.0, 0.0, 0.0, input.cell_size_m);
    input
        .active_cells
        .iter()
        .enumerate()
        .map(|(cell, active)| {
            if *active == 0 {
                return 0.0;
            }
            let nodes = cell_nodes(input, cell);
            let mut epsilon = [0.0; 6];
            for row in 0..6 {
                for column in 0..24 {
                    epsilon[row] +=
                        strain[row][column] * displacement[nodes[column / 3] * 3 + column % 3];
                }
            }
            let mut stress = [0.0; 6];
            for row in 0..6 {
                for column in 0..6 {
                    stress[row] += elasticity[row][column] * epsilon[column];
                }
            }
            let normal = (stress[0] - stress[1]).powi(2)
                + (stress[1] - stress[2]).powi(2)
                + (stress[2] - stress[0]).powi(2);
            (0.5 * normal + 3.0 * (stress[3].powi(2) + stress[4].powi(2) + stress[5].powi(2)))
                .sqrt() as f32
        })
        .collect()
}
