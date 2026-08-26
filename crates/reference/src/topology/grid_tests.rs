use super::grid::assembly_grid;
use super::{
    AssemblySolverInput, LoadPathGuideInput, MotorMountInput, SolverDimensions, SolverGridInput,
    SolverMaterial, SolverVolume,
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
        required_solids: vec![],
        protected_voids: vec![],
        access_voids: vec![],
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
    };

    let grid = assembly_grid(&input).expect("physical assembly grid");
    assert_eq!(grid.load_cases.len(), 4);
    assert!(grid
        .load_cases
        .iter()
        .all(|load| load.iter().any(|value| value.abs() > 0.0)));
}
