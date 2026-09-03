use super::grid::assembly_grid;
use super::{
    AssemblySolverInput, LoadCaseInput, LoadInput, SolverDimensions, SolverGridInput,
    SolverMaterial, SolverVolume,
};

fn load_interface_input() -> AssemblySolverInput {
    AssemblySolverInput {
        grid: SolverGridInput {
            dimensions: SolverDimensions {
                width: 32,
                height: 32,
                depth: 8,
            },
            origin_m: [-0.16, -0.16, -0.012],
            cell_size_m: [0.01, 0.01, 0.003],
        },
        design_domain: vec![SolverVolume::Box {
            center_m: [0.1, 0.0, 0.0],
            size_m: [0.02, 0.02, 0.008],
            yaw_rad: 0.0,
        }],
        load_cases: vec![LoadCaseInput {
            id: "interface-load".into(),
            loads: vec![LoadInput {
                region: SolverVolume::Cylinder {
                    center_m: [0.1, 0.0, 0.0],
                    radius_m: 0.03,
                    height_m: 0.005,
                    yaw_rad: 0.0,
                },
                force_n: [0.0, 0.0, -10.0],
            }],
        }],
        supports: vec![SolverVolume::Box {
            center_m: [0.09, 0.0, 0.0],
            size_m: [0.01, 0.01, 0.006],
            yaw_rad: 0.0,
        }],
        required_solids: vec![SolverVolume::Cylinder {
            center_m: [0.1, 0.0, 0.0],
            radius_m: 0.01,
            height_m: 0.005,
            yaw_rad: 0.0,
        }],
        protected_voids: vec![],
        access_voids: vec![],
        load_path_guides: vec![],
        material: SolverMaterial {
            youngs_modulus_pa: 1.0e9,
            failure_stress_pa: 1.0e6,
        },
        minimum_feature_m: 0.001,
        minimum_load_path_width_m: 0.005,
        minimum_frame_thickness_m: 0.005,
        inertial_relief: false,
        inertial_masses: vec![],
    }
}

#[test]
fn loads_use_explicit_interfaces_without_retaining_their_full_footprint() {
    let grid = assembly_grid(&load_interface_input()).expect("grid with explicit load interface");
    let loaded_only = grid.index(28, 15, 4);

    assert!(!grid.passive_solid[loaded_only]);
    assert!(grid.passive_void[loaded_only]);
    assert!(grid
        .load_cases
        .iter()
        .all(|load| load[loaded_only * 3..loaded_only * 3 + 3]
            .iter()
            .all(|force| *force == 0.0)));
    assert!(
        grid.load_cases[0]
            .chunks_exact(3)
            .enumerate()
            .any(|(index, force)| grid.passive_solid[index]
                && force.iter().any(|force| *force != 0.0))
    );
}
