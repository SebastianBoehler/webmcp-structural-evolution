use super::grid::Grid;
use super::solver::{compliance_and_sensitivity, load_case_fields, solve, springs};
use super::structural::{axial_bar_fixture, axial_fixture, cantilever_fixture, solve_structural};
use super::structural_element::{apply as apply_structural, stiffness as structural_stiffness};

fn two_node_grid() -> Grid {
    Grid {
        dimensions: [2, 1, 1],
        coordinates: vec![[0.0, 0.0, 0.0], [0.01, 0.0, 0.0]],
        passive_solid: vec![false; 2],
        passive_void: vec![false; 2],
        fixed_dofs: vec![true, true, true, false, false, false],
        load_case_ids: vec!["axial".into()],
        load_cases: vec![vec![0.0, 0.0, 0.0, 1.0, 0.0, 0.0]],
        cell_size_m: [0.01, 0.01, 0.01],
        youngs_modulus_pa: 3_500_000_000.0,
        failure_stress_pa: 50_000_000.0,
        minimum_load_path_width_m: 0.01,
        minimum_frame_thickness_m: 0.005,
        load_path_guides: vec![],
    }
}

fn solid_bar(dimensions: [usize; 3], cell_size_m: [f32; 3]) -> Grid {
    let [width, height, depth] = dimensions;
    let nodes = width * height * depth;
    let mut fixed_dofs = vec![false; nodes * 3];
    let mut load = vec![0.0; nodes * 3];
    let end_nodes = (height * depth) as f32;
    for z in 0..depth {
        for y in 0..height {
            let fixed = y * width + z * width * height;
            fixed_dofs[fixed * 3..fixed * 3 + 3].fill(true);
            let loaded = width - 1 + y * width + z * width * height;
            load[loaded * 3] = 1.0 / end_nodes;
        }
    }
    Grid {
        dimensions,
        coordinates: vec![[0.0; 3]; nodes],
        passive_solid: vec![false; nodes],
        passive_void: vec![false; nodes],
        fixed_dofs,
        load_case_ids: vec!["axial".into()],
        load_cases: vec![load],
        cell_size_m,
        youngs_modulus_pa: 3.5e9,
        failure_stress_pa: 50.0e6,
        minimum_load_path_width_m: 0.005,
        minimum_frame_thickness_m: 0.005,
        load_path_guides: vec![],
    }
}

fn loaded_end_displacement(grid: &Grid) -> f32 {
    let displacement = solve(
        grid,
        &springs(grid),
        &vec![1.0; grid.node_count()],
        &grid.load_cases[0],
    );
    let [width, height, depth] = grid.dimensions;
    let sum = (0..depth)
        .flat_map(|z| (0..height).map(move |y| width - 1 + y * width + z * width * height))
        .map(|node| displacement[node * 3])
        .sum::<f32>();
    sum / (height * depth) as f32
}

#[test]
fn physically_equal_solid_bars_are_mesh_convergent() {
    let coarse = solid_bar([10, 4, 4], [0.01, 0.01, 0.01]);
    let fine = solid_bar([20, 8, 8], [0.005, 0.005, 0.005]);
    let coarse_displacement = loaded_end_displacement(&coarse);
    let fine_displacement = loaded_end_displacement(&fine);
    let relative = (coarse_displacement - fine_displacement).abs() / coarse_displacement;
    assert!(
        relative < 0.2,
        "mesh refinement changed displacement by {:.1}%",
        relative * 100.0
    );
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

#[test]
fn exports_one_structural_field_per_load_case() {
    let mut grid = two_node_grid();
    grid.load_cases.push(vec![0.0, 0.0, 0.0, 2.0, 0.0, 0.0]);
    let (displacement, stress) = load_case_fields(&grid, &springs(&grid), &[1.0, 1.0]);

    assert_eq!(displacement.len(), grid.node_count() * 2);
    assert_eq!(stress.len(), grid.node_count() * 2);
    assert!(
        displacement[grid.node_count()..].iter().sum::<f32>()
            > displacement[..grid.node_count()].iter().sum::<f32>()
    );
}

#[test]
fn hex8_axial_bar_matches_closed_form_and_equilibrium() {
    let fixture = axial_bar_fixture();
    let result = solve_structural(&fixture).expect("axial structural reference must converge");
    let expected = fixture.applied_force_n * fixture.length_m
        / (fixture.youngs_modulus_pa * fixture.cross_section_m2);
    let relative = (result.observed_displacement_m - expected).abs() / expected;

    assert!(
        relative < 0.02,
        "axial displacement error was {:.2}%",
        relative * 100.0
    );
    assert!(result.relative_residual <= 1.0e-5);
    assert!(result.force_balance_error_n <= fixture.applied_force_n * 1.0e-4);
}

#[test]
fn hex8_cantilever_matches_euler_bernoulli_within_locked_resolution() {
    let fixture = cantilever_fixture();
    let result = solve_structural(&fixture).expect("cantilever structural reference must converge");
    let expected = fixture.applied_force_n * fixture.length_m.powi(3)
        / (3.0 * fixture.youngs_modulus_pa * fixture.second_moment_m4);
    let relative = (result.observed_displacement_m.abs() - expected).abs() / expected;

    assert!(
        relative < 0.05,
        "cantilever displacement error was {:.2}%",
        relative * 100.0
    );
    assert!(result.relative_residual <= 1.0e-5);
    assert!(result.force_balance_error_n <= fixture.applied_force_n * 1.0e-4);
}

#[test]
fn axial_reference_scales_with_force_modulus_length_and_section() {
    let cases = [
        axial_fixture([20, 2, 2], 0.005, 1_000.0, 70.0e9),
        axial_fixture([20, 2, 2], 0.005, 2_000.0, 70.0e9),
        axial_fixture([20, 2, 2], 0.005, 1_000.0, 140.0e9),
        axial_fixture([30, 2, 2], 0.005, 1_000.0, 70.0e9),
        axial_fixture([20, 4, 2], 0.005, 1_000.0, 70.0e9),
    ];
    for fixture in cases {
        let result = solve_structural(&fixture).expect("perturbed axial reference must converge");
        let expected = fixture.applied_force_n * fixture.length_m
            / (fixture.youngs_modulus_pa * fixture.cross_section_m2);
        let relative = (result.observed_displacement_m - expected).abs() / expected;
        assert!(
            relative < 0.02,
            "perturbed axial error was {:.2}%",
            relative * 100.0
        );
        independently_check_structural_evidence(&fixture, &result);
    }
}

fn independently_check_structural_evidence(
    fixture: &super::structural::StructuralFixture,
    result: &super::structural::StructuralReferenceResult,
) {
    let input = &fixture.input;
    let displacement: Vec<f64> = result
        .displacement_m
        .iter()
        .map(|value| f64::from(*value))
        .collect();
    let mut product = vec![0.0; displacement.len()];
    apply_structural(
        input,
        &structural_stiffness(input),
        &displacement,
        &mut product,
    );
    let load_norm = input
        .loads_n
        .iter()
        .map(|value| value * value)
        .sum::<f64>()
        .sqrt();
    let residual = product
        .iter()
        .zip(&input.loads_n)
        .enumerate()
        .filter(|(dof, _)| input.fixed_dofs[*dof] == 0)
        .map(|(_, (force, load))| (force - load).powi(2))
        .sum::<f64>()
        .sqrt()
        / load_norm;
    let mut balance = [0.0; 3];
    for (dof, fixed) in input.fixed_dofs.iter().copied().enumerate() {
        if fixed != 0 {
            balance[dof % 3] += product[dof];
        }
        balance[dof % 3] += input.loads_n[dof];
    }
    let compliance = input
        .loads_n
        .iter()
        .zip(&displacement)
        .map(|(load, u)| load * u)
        .sum::<f64>();
    let energy = 0.5
        * displacement
            .iter()
            .zip(&product)
            .map(|(u, force)| u * force)
            .sum::<f64>();
    assert!(residual <= 2.0e-5, "independent residual was {residual:e}");
    assert!(
        balance
            .iter()
            .map(|value| value * value)
            .sum::<f64>()
            .sqrt()
            <= fixture.applied_force_n * 1.0e-4
    );
    assert!((compliance - 2.0 * energy).abs() / compliance.abs() < 2.0e-5);
}
