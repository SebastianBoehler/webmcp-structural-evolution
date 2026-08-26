use super::grid::Grid;
use super::solver::{solve, springs};

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
