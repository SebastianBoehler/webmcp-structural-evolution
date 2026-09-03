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
            radius_m: 0.012,
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
    let required_outside_domain = grid.index(27, 15, 4);

    assert!(!grid.passive_solid[loaded_only]);
    assert!(grid.passive_void[loaded_only]);
    assert!(!grid.passive_solid[required_outside_domain]);
    assert!(grid.passive_void[required_outside_domain]);
    assert!(grid
        .load_cases
        .iter()
        .all(|load| [loaded_only, required_outside_domain]
            .iter()
            .all(|index| load[index * 3..index * 3 + 3]
                .iter()
                .all(|force| *force == 0.0))));
    assert!(
        grid.load_cases[0]
            .chunks_exact(3)
            .enumerate()
            .any(|(index, force)| grid.passive_solid[index]
                && force.iter().any(|force| *force != 0.0))
    );
}

#[test]
fn protected_voids_override_overlapping_support_cells() {
    let mut input = load_interface_input();
    input.supports.push(SolverVolume::Box {
        center_m: [-0.1, 0.0, 0.0],
        size_m: [0.01, 0.01, 0.006],
        yaw_rad: 0.0,
    });
    input.protected_voids.push(SolverVolume::Box {
        center_m: [0.09, 0.0, 0.0],
        size_m: [0.02, 0.02, 0.008],
        yaw_rad: 0.0,
    });

    let grid = assembly_grid(&input).expect("grid with protected support overlap");
    let protected_support = grid.index(25, 15, 4);

    assert!(grid.passive_void[protected_support]);
    assert!(!grid.passive_solid[protected_support]);
    assert!(grid
        .passive_solid
        .iter()
        .zip(&grid.passive_void)
        .all(|(solid, void)| !solid || !void));
}
