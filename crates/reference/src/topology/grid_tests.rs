use super::grid::assembly_grid;
use super::{
    AssemblySolverInput, InertialMassInput, LoadPathGuideInput, MotorMountInput, SolverDimensions,
    SolverGridInput, SolverMaterial, SolverVolume,
};

#[test]
fn live_fpv_grid_contains_four_nonzero_physical_load_cases() {
    let motors = [[0.105, 0.0], [0.0, 0.105], [-0.105, 0.0], [0.0, -0.105]]
        .map(|[x, y]| MotorMountInput {
            center_m: [x, y, 0.0],
            radius_m: 0.0175,
            load_n: [0.0, 0.0, -18.0],
        })
        .to_vec();
    let input = AssemblySolverInput {
        grid: SolverGridInput {
            dimensions: SolverDimensions {
                width: 32,
                height: 32,
                depth: 8,
            },
            origin_m: [-0.16, -0.16, -0.004],
            // Discretization may be finer than the printable minimum feature.
            cell_size_m: [0.01, 0.01, 0.00075],
        },
        motor_mounts: motors,
        supports: vec![SolverVolume::Box {
            center_m: [0.0, 0.0, 0.0],
            size_m: [0.04, 0.04, 0.006],
            yaw_rad: 0.0,
        }],
        required_solids: vec![
            SolverVolume::Box {
                center_m: [0.045, 0.005, -0.001],
                size_m: [0.01, 0.01, 0.006],
                yaw_rad: 0.0,
            },
            SolverVolume::Box {
                center_m: [0.08, 0.0, -0.00025],
                size_m: [0.01, 0.01, 0.0005],
                yaw_rad: 0.0,
            },
        ],
        protected_voids: vec![SolverVolume::Box {
            center_m: [0.045, 0.005, -0.001],
            size_m: [0.01, 0.01, 0.006],
            yaw_rad: 0.0,
        }],
        access_voids: vec![SolverVolume::Box {
            center_m: [0.015, 0.005, -0.001],
            size_m: [0.01, 0.01, 0.006],
            yaw_rad: 0.0,
        }],
        load_path_guides: vec![LoadPathGuideInput {
            id: "east-guide".into(),
            points_m: vec![[0.0, 0.0, 0.0], [0.06, 0.0, 0.0]],
            member_width_m: 0.005,
            frame_thickness_m: 0.005,
        }],
        material: SolverMaterial {
            youngs_modulus_pa: 3.5e9,
            failure_stress_pa: 50.0e6,
        },
        minimum_feature_m: 0.001,
        minimum_load_path_width_m: 0.005,
        minimum_frame_thickness_m: 0.005,
        inertial_masses: vec![
            InertialMassInput {
                center_m: [0.0, 0.0, -0.032],
                mass_kg: 0.254,
                inertia_tensor_kg_m2: [[0.0001, 0.0, 0.0], [0.0, 0.0001, 0.0], [0.0, 0.0, 0.0002]],
            },
            InertialMassInput {
                center_m: [0.0, 0.0, 0.008],
                mass_kg: 0.109,
                inertia_tensor_kg_m2: [
                    [0.00001, 0.0, 0.0],
                    [0.0, 0.00001, 0.0],
                    [0.0, 0.0, 0.00002],
                ],
            },
            InertialMassInput {
                center_m: [0.105, 0.0, 0.010],
                mass_kg: 0.038,
                inertia_tensor_kg_m2: [
                    [0.00001, 0.0, 0.0],
                    [0.0, 0.00001, 0.0],
                    [0.0, 0.0, 0.00001],
                ],
            },
            InertialMassInput {
                center_m: [0.0, 0.105, 0.010],
                mass_kg: 0.038,
                inertia_tensor_kg_m2: [
                    [0.00001, 0.0, 0.0],
                    [0.0, 0.00001, 0.0],
                    [0.0, 0.0, 0.00001],
                ],
            },
            InertialMassInput {
                center_m: [-0.105, 0.0, 0.010],
                mass_kg: 0.038,
                inertia_tensor_kg_m2: [
                    [0.00001, 0.0, 0.0],
                    [0.0, 0.00001, 0.0],
                    [0.0, 0.0, 0.00001],
                ],
            },
            InertialMassInput {
                center_m: [0.0, -0.105, 0.010],
                mass_kg: 0.038,
                inertia_tensor_kg_m2: [
                    [0.00001, 0.0, 0.0],
                    [0.0, 0.00001, 0.0],
                    [0.0, 0.0, 0.00001],
                ],
            },
        ],
    };

    let grid = assembly_grid(&input).expect("physical assembly grid");
    assert_eq!(grid.load_cases.len(), 4);
    assert!(grid
        .load_cases
        .iter()
        .all(|load| load.iter().any(|value| value.abs() > 0.0)));
    let divider_nodes = grid
        .coordinates
        .iter()
        .enumerate()
        .filter_map(|(index, [x, y, z])| {
            (x.abs() <= 0.02 && y.abs() <= 0.02 && z.abs() <= 0.003).then_some(index)
        })
        .collect::<Vec<_>>();
    assert!(!divider_nodes.is_empty());
    let divider_loaded = grid
        .load_cases
        .iter()
        .map(|load| {
            divider_nodes.iter().any(|node| {
                load[node * 3..node * 3 + 3]
                    .iter()
                    .any(|value| value.abs() > 1.0e-6)
            })
        })
        .collect::<Vec<_>>();
    assert!(divider_loaded.iter().all(|loaded| *loaded),
        "every in-flight case must transmit inertial force or torque through the divider board: {divider_loaded:?}");
    let access_nodes = grid
        .coordinates
        .iter()
        .enumerate()
        .filter_map(|(index, [x, y, z])| {
            ((x - 0.015).abs() <= 0.005 && (y - 0.005).abs() <= 0.005 && (z + 0.001).abs() <= 0.003)
                .then_some(index)
        })
        .collect::<Vec<_>>();
    assert!(!access_nodes.is_empty());
    assert!(access_nodes
        .iter()
        .all(|&node| grid.passive_void[node] && !grid.passive_solid[node]));
    let cable_clearance_nodes = grid
        .coordinates
        .iter()
        .enumerate()
        .filter_map(|(index, [x, y, z])| {
            ((x - 0.045).abs() <= 0.005 && (y - 0.005).abs() <= 0.005 && (z + 0.001).abs() <= 0.003)
                .then_some(index)
        })
        .collect::<Vec<_>>();
    assert!(!cable_clearance_nodes.is_empty());
    assert!(cable_clearance_nodes
        .iter()
        .all(|&node| grid.passive_void[node] && !grid.passive_solid[node]));
    assert!(
        [grid.index(23, 15, 4), grid.index(23, 15, 5)]
            .iter()
            .any(|&node| grid.passive_solid[node]),
        "a required solid thinner than one cell must survive rasterization"
    );
    assert!(grid
        .fixed_dofs
        .chunks_exact(3)
        .enumerate()
        .all(|(node, dofs)| !grid.passive_void[node] || dofs.iter().all(|fixed| !fixed)));
    assert_eq!(grid.fixed_dofs.iter().filter(|fixed| **fixed).count(), 6);
    for load in &grid.load_cases {
        let net_force = load.chunks_exact(3).fold([0.0_f32; 3], |mut sum, force| {
            for axis in 0..3 {
                sum[axis] += force[axis];
            }
            sum
        });
        assert!(
            net_force.iter().all(|force| force.abs() < 1.0e-3),
            "inertial-relief load must be force-balanced: {net_force:?}"
        );
    }
}
