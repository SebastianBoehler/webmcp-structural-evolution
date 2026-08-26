use super::grid::{drone_grid, Grid};
use super::solver::{compliance_and_sensitivity, springs};
use super::{OptimizationPreset, TopologyResult};
use std::sync::OnceLock;

fn filtered(grid: &Grid, values: &[f32]) -> Vec<f32> {
    let [width, height, depth] = grid.dimensions;
    let mut result = vec![0.0; values.len()];
    for z in 0..depth {
        for y in 0..height {
            for x in 0..width {
                let mut sum = 0.0;
                let mut weight = 0.0;
                for dz in -1..=1 {
                    for dy in -1..=1 {
                        for dx in -1..=1 {
                            let point = [x as isize + dx, y as isize + dy, z as isize + dz];
                            if point[0] < 0 || point[1] < 0 || point[2] < 0
                                || point[0] >= width as isize || point[1] >= height as isize
                                || point[2] >= depth as isize { continue; }
                            let distance = ((dx * dx + dy * dy + dz * dz) as f32).sqrt();
                            let local_weight = (1.75 - distance).max(0.0);
                            sum += local_weight * values[grid.index(point[0] as usize, point[1] as usize, point[2] as usize)];
                            weight += local_weight;
                        }
                    }
                }
                result[grid.index(x, y, z)] = sum / weight.max(1.0e-6);
            }
        }
    }
    result
}

fn material_fraction(grid: &Grid, density: &[f32]) -> f32 {
    let mut sum = 0.0;
    let mut count = 0;
    for (index, &value) in density.iter().enumerate() {
        if !grid.passive_void[index] {
            sum += value;
            count += 1;
        }
    }
    sum / count as f32
}

fn optimality_update(grid: &Grid, density: &mut [f32], sensitivity: &[f32], target: f32) {
    let move_limit = 0.16;
    let mut lower = 1.0e-9_f32;
    let mut upper = 1.0e9_f32;
    let mut proposal = density.to_vec();
    for _ in 0..64 {
        let multiplier = (lower * upper).sqrt();
        for index in 0..density.len() {
            proposal[index] = if grid.passive_solid[index] {
                1.0
            } else if grid.passive_void[index] {
                0.0
            } else {
                let scaled = density[index] * (-sensitivity[index] / multiplier).max(0.0).sqrt();
                scaled.clamp((density[index] - move_limit).max(0.02), (density[index] + move_limit).min(1.0))
            };
        }
        if material_fraction(grid, &proposal) > target { lower = multiplier; } else { upper = multiplier; }
    }
    density.copy_from_slice(&proposal);
}

fn connectivity_path(grid: &Grid, density: &[f32], start: usize) -> Vec<usize> {
    let [width, height, depth] = grid.dimensions;
    let mut distance = vec![f32::INFINITY; density.len()];
    let mut previous = vec![usize::MAX; density.len()];
    let mut visited = vec![false; density.len()];
    distance[start] = 0.0;
    let mut goal = start;
    for _ in 0..density.len() {
        let Some(current) = distance.iter().enumerate()
            .filter(|(index, _)| !visited[*index])
            .min_by(|left, right| left.1.total_cmp(right.1)).map(|(index, _)| index) else { break };
        if !distance[current].is_finite() { break; }
        visited[current] = true;
        if grid.fixed_dofs[current * 3] {
            goal = current;
            break;
        }
        let x = current % width;
        let y = (current / width) % height;
        let z = current / (width * height);
        for [nx, ny, nz] in [
            [x.wrapping_sub(1), y, z], [x + 1, y, z],
            [x, y.wrapping_sub(1), z], [x, y + 1, z],
            [x, y, z.wrapping_sub(1)], [x, y, z + 1],
        ] {
            if nx >= width || ny >= height || nz >= depth { continue; }
            let neighbor = grid.index(nx, ny, nz);
            if visited[neighbor] || grid.passive_void[neighbor] { continue; }
            let cost = 0.02 + (1.0 - density[neighbor]).powi(2);
            let candidate = distance[current] + cost;
            if candidate < distance[neighbor] {
                distance[neighbor] = candidate;
                previous[neighbor] = current;
            }
        }
    }
    let mut path = vec![goal];
    while goal != start && previous[goal] != usize::MAX {
        goal = previous[goal];
        path.push(goal);
    }
    path
}

fn enforce_connectivity(grid: &Grid, density: &mut [f32], target: f32) -> Vec<bool> {
    let [width, height, depth] = grid.dimensions;
    let center = [width / 2, height / 2, depth / 2];
    let starts = [
        grid.index(width - 3, center[1], center[2]), grid.index(2, center[1], center[2]),
        grid.index(center[0], height - 3, center[2]), grid.index(center[0], 2, center[2]),
    ];
    let mut path_mask = vec![false; density.len()];
    for start in starts {
        for index in connectivity_path(grid, density, start) { path_mask[index] = true; }
    }
    let dilation_passes = if target >= 0.44 { 2 } else if target >= 0.34 { 1 } else { 0 };
    for _ in 0..dilation_passes {
        let previous = path_mask.clone();
        for index in 0..previous.len() {
            if !previous[index] { continue; }
            let x = index % width;
            let y = (index / width) % height;
            let z = index / (width * height);
            for [nx, ny, nz] in [
                [x.wrapping_sub(1), y, z], [x + 1, y, z],
                [x, y.wrapping_sub(1), z], [x, y + 1, z],
                [x, y, z.wrapping_sub(1)], [x, y, z + 1],
            ] {
                if nx >= width || ny >= height || nz >= depth { continue; }
                let neighbor = grid.index(nx, ny, nz);
                if !grid.passive_void[neighbor] { path_mask[neighbor] = true; }
            }
        }
    }
    let baseline = density.to_vec();
    let mut lower = 0.0_f32;
    let mut upper = 1.0_f32;
    for _ in 0..48 {
        let scale = (lower + upper) * 0.5;
        for index in 0..density.len() {
            density[index] = if grid.passive_solid[index] { 1.0 }
                else if grid.passive_void[index] { 0.0 }
                else if path_mask[index] { baseline[index].max(0.38) }
                else { (baseline[index] * scale).max(0.02) };
        }
        if material_fraction(grid, density) > target { upper = scale; } else { lower = scale; }
    }
    path_mask
}

fn supported_material(grid: &Grid, density: &[f32], start: usize) -> Vec<bool> {
    let [width, height, depth] = grid.dimensions;
    let mut supported = vec![false; density.len()];
    let mut queue = std::collections::VecDeque::from([start]);
    supported[start] = true;
    while let Some(current) = queue.pop_front() {
        let x = current % width;
        let y = (current / width) % height;
        let z = current / (width * height);
        for [nx, ny, nz] in [
            [x.wrapping_sub(1), y, z], [x + 1, y, z],
            [x, y.wrapping_sub(1), z], [x, y + 1, z],
            [x, y, z.wrapping_sub(1)], [x, y, z + 1],
        ] {
            if nx >= width || ny >= height || nz >= depth { continue; }
            let neighbor = grid.index(nx, ny, nz);
            if !supported[neighbor] && density[neighbor] >= 0.32 {
                supported[neighbor] = true;
                queue.push_back(neighbor);
            }
        }
    }
    supported
}

fn remove_floating_material(grid: &Grid, density: &mut [f32], path: &[bool], target: f32) {
    let [width, height, depth] = grid.dimensions;
    let start = grid.index(width / 2 + 2, height / 2, depth / 2);
    for _ in 0..4 {
        let supported = supported_material(grid, density, start);
        for index in 0..density.len() {
            if grid.passive_void[index] { density[index] = 0.0; }
            else if grid.passive_solid[index] { density[index] = 1.0; }
            else if !supported[index] { density[index] = 0.02; }
        }
        let baseline = density.to_vec();
        let mut lower = 0.0_f32;
        let mut upper = 8.0_f32;
        for _ in 0..48 {
            let scale = (lower + upper) * 0.5;
            for index in 0..density.len() {
                density[index] = if grid.passive_void[index] { 0.0 }
                    else if grid.passive_solid[index] { 1.0 }
                    else if path[index] { baseline[index].max(0.38) }
                    else if supported[index] { (baseline[index] * scale).clamp(0.02, 1.0) }
                    else { 0.02 };
            }
            if material_fraction(grid, density) > target { upper = scale; } else { lower = scale; }
        }
    }
    let supported = supported_material(grid, density, start);
    for index in 0..density.len() {
        if grid.passive_void[index] { density[index] = 0.0; }
        else if grid.passive_solid[index] { density[index] = 1.0; }
        else if !supported[index] { density[index] = 0.02; }
    }
    // Island material is reassigned only to the already supported component.
    // Adding density here can thicken an existing load path, never seed a new one.
    for _ in 0..12 {
        let deficit = target - material_fraction(grid, density);
        if deficit <= 1.0e-4 { break; }
        let eligible = density.iter().enumerate().filter(|(index, value)| {
            supported[*index] && !grid.passive_solid[*index]
                && !grid.passive_void[*index] && **value < 1.0
        }).map(|(index, _)| index).collect::<Vec<_>>();
        if eligible.is_empty() { break; }
        let non_void = grid.passive_void.iter().filter(|void| !**void).count() as f32;
        let delta = deficit * non_void / eligible.len() as f32;
        for index in eligible {
            density[index] = (density[index] + delta).min(1.0);
        }
    }
}

fn optimize_uncached(preset: OptimizationPreset) -> TopologyResult {
    let grid = drone_grid();
    let springs = springs(&grid);
    let target = preset.volume_fraction();
    let solid_fraction = grid.passive_solid.iter().filter(|solid| **solid).count() as f32
        / grid.passive_void.iter().filter(|void| !**void).count() as f32;
    let initial = ((target - solid_fraction) / (1.0 - solid_fraction)).clamp(0.04, 0.95);
    let mut density = grid.passive_void.iter().zip(&grid.passive_solid).map(|(&void, &solid)|
        if void { 0.0 } else if solid { 1.0 } else { initial }).collect::<Vec<_>>();
    let (initial_compliance, _, _) = compliance_and_sensitivity(&grid, &springs, &density);
    let iterations = 16;
    for _ in 0..iterations {
        let (_, _, sensitivity) = compliance_and_sensitivity(&grid, &springs, &density);
        let sensitivity = filtered(&grid, &sensitivity);
        optimality_update(&grid, &mut density, &sensitivity, target);
    }
    let path = enforce_connectivity(&grid, &mut density, target);
    remove_floating_material(&grid, &mut density, &path, target);
    let (final_compliance, max_displacement, _) = compliance_and_sensitivity(&grid, &springs, &density);
    TopologyResult {
        dimensions: grid.dimensions,
        passive_solid_indices: grid.passive_solid.iter().enumerate().filter_map(|(index, solid)| solid.then_some(index)).collect(),
        passive_void_indices: grid.passive_void.iter().enumerate().filter_map(|(index, void)| void.then_some(index)).collect(),
        material_fraction: material_fraction(&grid, &density),
        density,
        initial_compliance,
        final_compliance,
        max_displacement,
        iterations,
    }
}

pub fn optimize_drone_frame(preset: OptimizationPreset) -> TopologyResult {
    static LIGHTWEIGHT: OnceLock<TopologyResult> = OnceLock::new();
    static BALANCED: OnceLock<TopologyResult> = OnceLock::new();
    static STIFFNESS: OnceLock<TopologyResult> = OnceLock::new();
    match preset {
        OptimizationPreset::Lightweight => LIGHTWEIGHT.get_or_init(|| optimize_uncached(preset)).clone(),
        OptimizationPreset::Balanced => BALANCED.get_or_init(|| optimize_uncached(preset)).clone(),
        OptimizationPreset::Stiffness => STIFFNESS.get_or_init(|| optimize_uncached(preset)).clone(),
    }
}
