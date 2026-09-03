use super::reconstruct_load_path_web;
use crate::topology::grid::Grid;

fn reconstruction_fixture() -> Grid {
    Grid {
        dimensions: [4, 3, 1],
        coordinates: (0..12).map(|index| [index as f32, 0.0, 0.0]).collect(),
        passive_solid: vec![
            true, false, false, false, false, false, false, false, false, false, false, false,
        ],
        passive_void: vec![
            false, false, false, false, false, true, false, false, false, false, false, false,
        ],
        fixed_dofs: vec![false; 36],
        load_case_ids: vec![],
        load_cases: vec![],
        cell_size_m: [1.0, 1.0, 1.0],
        youngs_modulus_pa: 1.0,
        failure_stress_pa: 1.0,
        minimum_load_path_width_m: 1.0,
        minimum_frame_thickness_m: 1.0,
        load_path_guides: vec![],
    }
}

fn fixture_density() -> Vec<f32> {
    vec![
        1.0, 1.0, 0.95, 0.1, 0.6, 0.0, 0.8, 0.2, 0.15, 0.1, 0.01, 0.05,
    ]
}

fn fixture_required_path() -> Vec<bool> {
    vec![
        false, true, false, false, false, false, false, false, false, false, false, false,
    ]
}

fn line_fixture(length: usize, solids: &[usize], voids: &[usize]) -> Grid {
    let mut grid = reconstruction_fixture();
    grid.dimensions = [length, 1, 1];
    grid.coordinates = (0..length).map(|index| [index as f32, 0.0, 0.0]).collect();
    grid.passive_solid = vec![false; length];
    grid.passive_void = vec![false; length];
    grid.fixed_dofs = vec![false; length * 3];
    for &index in solids {
        grid.passive_solid[index] = true;
    }
    for &index in voids {
        grid.passive_void[index] = true;
    }
    grid
}

fn non_void_count(grid: &Grid) -> usize {
    grid.passive_void.iter().filter(|void| !**void).count()
}

fn material_fraction(grid: &Grid, density: &[f32]) -> f32 {
    density
        .iter()
        .enumerate()
        .filter(|(index, _)| !grid.passive_void[*index])
        .map(|(_, density)| density)
        .sum::<f32>()
        / non_void_count(grid) as f32
}

fn occupied_cells_are_face_connected(grid: &Grid, density: &[f32], threshold: f32) -> bool {
    let Some(start) = density.iter().position(|density| *density >= threshold) else {
        return true;
    };
    let [width, height, depth] = grid.dimensions;
    let mut seen = vec![false; density.len()];
    let mut queue = std::collections::VecDeque::from([start]);
    seen[start] = true;
    while let Some(index) = queue.pop_front() {
        let x = index % width;
        let y = (index / width) % height;
        let z = index / (width * height);
        for [nx, ny, nz] in [
            [x.wrapping_sub(1), y, z],
            [x + 1, y, z],
            [x, y.wrapping_sub(1), z],
            [x, y + 1, z],
            [x, y, z.wrapping_sub(1)],
            [x, y, z + 1],
        ] {
            if nx >= width || ny >= height || nz >= depth {
                continue;
            }
            let neighbor = grid.index(nx, ny, nz);
            if !seen[neighbor] && density[neighbor] >= threshold {
                seen[neighbor] = true;
                queue.push_back(neighbor);
            }
        }
    }
    density
        .iter()
        .enumerate()
        .all(|(index, density)| *density < threshold || seen[index])
}

#[test]
fn reconstructed_web_preserves_seeds_voids_connectivity_and_target() {
    let grid = reconstruction_fixture();
    let solved = fixture_density();
    let path = fixture_required_path();
    let result = reconstruct_load_path_web(&grid, &solved, &path, 0.35);
    assert!(path
        .iter()
        .enumerate()
        .all(|(i, keep)| !keep || result[i] >= 0.32));
    assert!(grid
        .passive_void
        .iter()
        .enumerate()
        .all(|(i, void)| !void || result[i] == 0.0));
    assert!(occupied_cells_are_face_connected(&grid, &result, 0.32));
    assert!((material_fraction(&grid, &result) - 0.35).abs() <= 1.0 / non_void_count(&grid) as f32);
}

#[test]
fn reconstruction_is_deterministic_and_density_guided() {
    let grid = reconstruction_fixture();
    let solved = fixture_density();
    let path = fixture_required_path();
    let first = reconstruct_load_path_web(&grid, &solved, &path, 0.35);
    let second = reconstruct_load_path_web(&grid, &solved, &path, 0.35);
    assert_eq!(first, second);
    assert!(first[2] > first[10]);
}

#[test]
fn ordinary_growth_prefers_density_within_the_same_frontier_layer() {
    let grid = line_fixture(5, &[2], &[]);
    let result = reconstruct_load_path_web(
        &grid,
        &[0.1, 0.9, 1.0, 0.2, 0.8],
        &[false; 5],
        0.412,
    );

    assert!(result[1] >= 0.32);
    assert!(result[3] < 0.32);
}

#[test]
fn reconstruction_targets_the_returned_density_fraction() {
    let mut grid = reconstruction_fixture();
    grid.dimensions = [10, 10, 1];
    grid.coordinates = (0..100).map(|index| [index as f32, 0.0, 0.0]).collect();
    grid.passive_solid = vec![true; 1];
    grid.passive_solid.resize(100, false);
    grid.passive_void = vec![false; 100];
    grid.fixed_dofs = vec![false; 300];
    let mut path = vec![false; 100];
    path[1] = true;
    let result = reconstruct_load_path_web(&grid, &vec![0.5; 100], &path, 0.26);

    assert!((material_fraction(&grid, &result) - 0.26).abs() <= 1.0 / 100.0);
}

#[test]
fn reconstruction_connects_separated_retained_seeds_before_target_growth() {
    let grid = line_fixture(5, &[0, 4], &[]);
    let result = reconstruct_load_path_web(&grid, &[0.5; 5], &[false; 5], 0.99);

    assert!(occupied_cells_are_face_connected(&grid, &result, 0.32));
    assert!(result[1..4].iter().all(|density| *density >= 0.32));
    assert!((material_fraction(&grid, &result) - 0.99).abs() <= 1.0 / non_void_count(&grid) as f32);
}

#[test]
#[should_panic(expected = "material budget cannot connect retained seeds")]
fn reconstruction_rejects_connectivity_that_exceeds_the_material_budget() {
    let grid = line_fixture(5, &[0, 4], &[]);
    reconstruct_load_path_web(&grid, &[0.5; 5], &[false; 5], 0.4);
}

#[test]
fn connector_prefers_the_high_density_shortest_path() {
    let mut grid = line_fixture(9, &[0, 8], &[]);
    grid.dimensions = [3, 3, 1];
    grid.coordinates = (0..9).map(|index| [index as f32, 0.0, 0.0]).collect();
    let result = reconstruct_load_path_web(
        &grid,
        &[1.0, 0.9, 0.9, 0.1, 0.1, 0.9, 0.1, 0.1, 1.0],
        &[false; 9],
        0.565,
    );

    assert!(result[1] >= 0.32 && result[2] >= 0.32 && result[5] >= 0.32);
    assert!(result[3] < 0.32);
}

#[test]
#[should_panic(expected = "cannot connect retained seeds")]
fn reconstruction_rejects_seed_components_separated_by_voids() {
    let grid = line_fixture(5, &[0, 4], &[2]);
    reconstruct_load_path_web(&grid, &[0.5; 5], &[false; 5], 0.4);
}
