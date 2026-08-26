use webmcp_reference::topology::{optimize_drone_frame, OptimizationPreset};

fn active_path_exists(
    density: &[f32],
    dimensions: [usize; 3],
    start: [usize; 3],
    goal_region: impl Fn([usize; 3]) -> bool,
) -> bool {
    let [width, height, depth] = dimensions;
    let index = |[x, y, z]: [usize; 3]| x + width * (y + height * z);
    let mut seen = vec![false; density.len()];
    let mut queue = std::collections::VecDeque::from([start]);
    seen[index(start)] = true;
    while let Some(point @ [x, y, z]) = queue.pop_front() {
        if goal_region(point) {
            return true;
        }
        for [nx, ny, nz] in [
            [x.wrapping_sub(1), y, z], [x + 1, y, z],
            [x, y.wrapping_sub(1), z], [x, y + 1, z],
            [x, y, z.wrapping_sub(1)], [x, y, z + 1],
        ] {
            if nx >= width || ny >= height || nz >= depth {
                continue;
            }
            let neighbor = index([nx, ny, nz]);
            if !seen[neighbor] && density[neighbor] >= 0.32 {
                seen[neighbor] = true;
                queue.push_back([nx, ny, nz]);
            }
        }
    }
    false
}

#[test]
fn optimization_is_deterministic_and_reduces_compliance() {
    let first = optimize_drone_frame(OptimizationPreset::Balanced);
    let second = optimize_drone_frame(OptimizationPreset::Balanced);

    assert_eq!(first.density, second.density);
    assert!(first.final_compliance.is_finite());
    assert!(first.final_compliance < first.initial_compliance * 0.92,
        "compliance {} did not improve from {}", first.final_compliance, first.initial_compliance);
    assert!(first.max_displacement.is_finite());
}

#[test]
fn passive_solids_and_protected_voids_are_preserved() {
    let result = optimize_drone_frame(OptimizationPreset::Balanced);

    for &index in &result.passive_solid_indices {
        assert_eq!(result.density[index], 1.0, "passive solid {index} changed");
    }
    for &index in &result.passive_void_indices {
        assert_eq!(result.density[index], 0.0, "protected void {index} filled");
    }
}

#[test]
fn presets_make_a_measurable_engineering_tradeoff() {
    let balanced = optimize_drone_frame(OptimizationPreset::Balanced);
    let lightweight = optimize_drone_frame(OptimizationPreset::Lightweight);
    let stiffness = optimize_drone_frame(OptimizationPreset::Stiffness);

    assert!(lightweight.material_fraction < stiffness.material_fraction - 0.08,
        "lightweight {} and stiffness {} mass fractions converged", lightweight.material_fraction, stiffness.material_fraction);
    assert!(stiffness.final_compliance < lightweight.final_compliance,
        "stiffness compliance {} was not below lightweight {}", stiffness.final_compliance, lightweight.final_compliance);
    for result in [lightweight, balanced, stiffness] {
        assert!((0.0..=1.0).contains(&result.material_fraction));
    }
}

#[test]
fn optimized_material_connects_each_motor_mount_to_the_core() {
    let result = optimize_drone_frame(OptimizationPreset::Balanced);
    let [width, height, depth] = result.dimensions;
    let center = [width / 2, height / 2, depth / 2];
    let core = |[x, y, _]: [usize; 3]| x.abs_diff(center[0]) <= 2 && y.abs_diff(center[1]) <= 2;
    let motor_starts = [
        [width - 3, center[1], center[2]],
        [2, center[1], center[2]],
        [center[0], height - 3, center[2]],
        [center[0], 2, center[2]],
    ];

    for start in motor_starts {
        assert!(
            active_path_exists(&result.density, result.dimensions, start, core),
            "motor mount at {start:?} has no thresholded load path",
        );
    }
}

#[test]
fn every_rendered_density_cell_belongs_to_the_supported_frame() {
    let result = optimize_drone_frame(OptimizationPreset::Balanced);
    let [width, height, depth] = result.dimensions;
    let center = [width / 2, height / 2, depth / 2];
    let start = [center[0] + 2, center[1], center[2]];
    let mut connected = vec![false; result.density.len()];
    let index = |[x, y, z]: [usize; 3]| x + width * (y + height * z);
    let mut queue = std::collections::VecDeque::from([start]);
    connected[index(start)] = true;
    while let Some([x, y, z]) = queue.pop_front() {
        for [nx, ny, nz] in [
            [x.wrapping_sub(1), y, z], [x + 1, y, z],
            [x, y.wrapping_sub(1), z], [x, y + 1, z],
            [x, y, z.wrapping_sub(1)], [x, y, z + 1],
        ] {
            if nx >= width || ny >= height || nz >= depth { continue; }
            let neighbor = index([nx, ny, nz]);
            if !connected[neighbor] && result.density[neighbor] >= 0.32 {
                connected[neighbor] = true;
                queue.push_back([nx, ny, nz]);
            }
        }
    }
    let floating = result.density.iter().enumerate()
        .filter(|(index, value)| **value >= 0.32 && !connected[*index])
        .count();
    assert_eq!(floating, 0, "rendered topology contains {floating} floating density cells");
}
