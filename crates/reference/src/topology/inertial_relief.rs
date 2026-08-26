fn cross(left: [f32; 3], right: [f32; 3]) -> [f32; 3] {
    [
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0],
    ]
}

fn relative(point: [f32; 3], origin: [f32; 3]) -> [f32; 3] {
    [
        point[0] - origin[0],
        point[1] - origin[1],
        point[2] - origin[2],
    ]
}

fn centroid(coordinates: &[[f32; 3]], nodes: &[usize]) -> [f32; 3] {
    let mut center = [0.0; 3];
    for &node in nodes {
        for axis in 0..3 {
            center[axis] += coordinates[node][axis];
        }
    }
    for value in &mut center {
        *value /= nodes.len() as f32;
    }
    center
}

fn solve_symmetric_3x3(matrix: [[f32; 3]; 3], rhs: [f32; 3]) -> Result<[f32; 3], String> {
    let [[a, b, c], [_, d, e], [_, _, f]] = matrix;
    let determinant = a * (d * f - e * e) - b * (b * f - c * e) + c * (b * e - c * d);
    if !determinant.is_finite() || determinant.abs() < 1.0e-20 {
        return Err("divider-board inertia tensor is singular".into());
    }
    let inverse = [
        [
            (d * f - e * e) / determinant,
            (c * e - b * f) / determinant,
            (b * e - c * d) / determinant,
        ],
        [
            (c * e - b * f) / determinant,
            (a * f - c * c) / determinant,
            (b * c - a * e) / determinant,
        ],
        [
            (b * e - c * d) / determinant,
            (b * c - a * e) / determinant,
            (a * d - b * b) / determinant,
        ],
    ];
    Ok(inverse.map(|row| row.iter().zip(rhs).map(|(left, right)| left * right).sum()))
}

pub(crate) fn set_kinematic_stabilizers(
    fixed_dofs: &mut [bool],
    coordinates: &[[f32; 3]],
    support_nodes: &[usize],
) -> Result<(), String> {
    let center = centroid(coordinates, support_nodes);
    let anchor = *support_nodes
        .iter()
        .min_by(|&&left, &&right| {
            let distance = |node: usize| {
                relative(coordinates[node], center)
                    .iter()
                    .map(|value| value * value)
                    .sum::<f32>()
            };
            distance(left).total_cmp(&distance(right))
        })
        .ok_or_else(|| "divider-board support is empty".to_string())?;
    let x_node = *support_nodes
        .iter()
        .max_by(|&&left, &&right| {
            coordinates[left][0]
                .total_cmp(&coordinates[right][0])
                .then_with(|| {
                    (coordinates[right][1] - center[1])
                        .abs()
                        .total_cmp(&(coordinates[left][1] - center[1]).abs())
                })
        })
        .unwrap();
    let y_node = *support_nodes
        .iter()
        .max_by(|&&left, &&right| {
            coordinates[left][1]
                .total_cmp(&coordinates[right][1])
                .then_with(|| {
                    (coordinates[right][0] - center[0])
                        .abs()
                        .total_cmp(&(coordinates[left][0] - center[0]).abs())
                })
        })
        .unwrap();
    fixed_dofs[anchor * 3..anchor * 3 + 3].fill(true);
    fixed_dofs[x_node * 3 + 1] = true;
    fixed_dofs[x_node * 3 + 2] = true;
    fixed_dofs[y_node * 3 + 2] = true;
    Ok(())
}

fn wrench(load: &[f32], coordinates: &[[f32; 3]], origin: [f32; 3]) -> ([f32; 3], [f32; 3]) {
    let mut force = [0.0; 3];
    let mut moment = [0.0; 3];
    for (node, vector) in load.chunks_exact(3).enumerate() {
        for axis in 0..3 {
            force[axis] += vector[axis];
        }
        let torque = cross(
            relative(coordinates[node], origin),
            [vector[0], vector[1], vector[2]],
        );
        for axis in 0..3 {
            moment[axis] += torque[axis];
        }
    }
    (force, moment)
}

fn inertia_tensor(masses: &[InertialMassInput], center: [f32; 3]) -> [[f32; 3]; 3] {
    let mut inertia = [[0.0; 3]; 3];
    for mass in masses {
        let r = relative(mass.center_m, center);
        let radius_squared = r.iter().map(|value| value * value).sum::<f32>();
        for row in 0..3 {
            for column in 0..3 {
                inertia[row][column] += mass.mass_kg
                    * (if row == column { radius_squared } else { 0.0 } - r[row] * r[column])
                    + mass.inertia_tensor_kg_m2[row][column];
            }
        }
    }
    inertia
}

fn nearest_node(point: [f32; 3], coordinates: &[[f32; 3]], candidates: &[usize]) -> usize {
    *candidates
        .iter()
        .min_by(|&&left, &&right| {
            let distance = |node: usize| {
                relative(coordinates[node], point)
                    .iter()
                    .map(|value| value * value)
                    .sum::<f32>()
            };
            distance(left).total_cmp(&distance(right))
        })
        .unwrap()
}

fn distribute_residual(
    load: &mut [f32],
    coordinates: &[[f32; 3]],
    divider_nodes: &[usize],
    origin: [f32; 3],
) -> Result<(), String> {
    let (force, moment) = wrench(load, coordinates, origin);
    let center = centroid(coordinates, divider_nodes);
    let unit_masses = divider_nodes
        .iter()
        .map(|&node| InertialMassInput {
            center_m: coordinates[node],
            mass_kg: 1.0,
            inertia_tensor_kg_m2: [[0.0; 3]; 3],
        })
        .collect::<Vec<_>>();
    let angular = solve_symmetric_3x3(
        inertia_tensor(&unit_masses, center),
        moment.map(|value| -value),
    )?;
    let translation = force.map(|value| -value / divider_nodes.len() as f32);
    for &node in divider_nodes {
        let rotational = cross(angular, relative(coordinates[node], center));
        for axis in 0..3 {
            load[node * 3 + axis] += translation[axis] + rotational[axis];
        }
    }
    Ok(())
}

pub(crate) fn apply_inertial_relief(
    load_cases: &mut [Vec<f32>],
    coordinates: &[[f32; 3]],
    solid_nodes: &[usize],
    divider_nodes: &[usize],
    masses: &[InertialMassInput],
) -> Result<(), String> {
    if divider_nodes.len() < 3 || solid_nodes.is_empty() {
        return Err("inertial relief requires at least three divider-board nodes".into());
    }
    if masses.is_empty()
        || masses.iter().any(|mass| {
            !mass.mass_kg.is_finite()
                || mass.mass_kg <= 0.0
                || mass
                    .inertia_tensor_kg_m2
                    .iter()
                    .flatten()
                    .any(|value| !value.is_finite())
        })
    {
        return Err("inertial relief requires positive finite component masses".into());
    }
    let total_mass = masses.iter().map(|mass| mass.mass_kg).sum::<f32>();
    let mut mass_center = [0.0; 3];
    for mass in masses {
        for axis in 0..3 {
            mass_center[axis] += mass.center_m[axis] * mass.mass_kg / total_mass;
        }
    }
    let mass_inertia = inertia_tensor(masses, mass_center);
    let couplings = masses
        .iter()
        .map(|mass| nearest_node(mass.center_m, coordinates, solid_nodes))
        .collect::<Vec<_>>();
    for load in load_cases {
        let (force, moment) = wrench(load, coordinates, mass_center);
        let linear_acceleration = force.map(|value| value / total_mass);
        let angular_acceleration = solve_symmetric_3x3(mass_inertia, moment)?;
        for (mass, &node) in masses.iter().zip(&couplings) {
            let rotational = cross(angular_acceleration, relative(mass.center_m, mass_center));
            for axis in 0..3 {
                load[node * 3 + axis] -=
                    mass.mass_kg * (linear_acceleration[axis] + rotational[axis]);
            }
        }
        distribute_residual(load, coordinates, divider_nodes, mass_center)?;
    }
    Ok(())
}
use super::InertialMassInput;
