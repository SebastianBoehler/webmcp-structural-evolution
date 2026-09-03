use super::grid::Grid;

fn face_neighbors(grid: &Grid, index: usize) -> [Option<usize>; 6] {
    let [width, height, depth] = grid.dimensions;
    let x = index % width;
    let y = (index / width) % height;
    let z = index / (width * height);
    [
        (x > 0).then(|| grid.index(x - 1, y, z)),
        (x + 1 < width).then(|| grid.index(x + 1, y, z)),
        (y > 0).then(|| grid.index(x, y - 1, z)),
        (y + 1 < height).then(|| grid.index(x, y + 1, z)),
        (z > 0).then(|| grid.index(x, y, z - 1)),
        (z + 1 < depth).then(|| grid.index(x, y, z + 1)),
    ]
}

fn occupied_face_neighbor_count(grid: &Grid, occupied: &[bool], index: usize) -> usize {
    face_neighbors(grid, index)
        .into_iter()
        .flatten()
        .filter(|neighbor| occupied[*neighbor])
        .count()
}

fn connected_retained_component(grid: &Grid, occupied: &[bool]) -> Vec<bool> {
    let mut connected = vec![false; occupied.len()];
    let Some(start) = occupied.iter().position(|occupied| *occupied) else {
        return connected;
    };
    let mut queue = std::collections::VecDeque::from([start]);
    connected[start] = true;
    while let Some(index) = queue.pop_front() {
        for neighbor in face_neighbors(grid, index).into_iter().flatten() {
            if occupied[neighbor] && !connected[neighbor] {
                connected[neighbor] = true;
                queue.push_back(neighbor);
            }
        }
    }
    connected
}

fn density_guided_connector(
    grid: &Grid,
    solved_density: &[f32],
    connected: &[bool],
    occupied: &[bool],
) -> Option<Vec<usize>> {
    let mut seen = connected.to_vec();
    let mut previous = vec![usize::MAX; occupied.len()];
    let mut frontier = connected
        .iter()
        .enumerate()
        .filter_map(|(index, connected)| connected.then_some(index))
        .collect::<Vec<_>>();
    while !frontier.is_empty() {
        frontier.sort_by(|left, right| {
            solved_density[*right]
                .total_cmp(&solved_density[*left])
                .then_with(|| left.cmp(right))
        });
        let mut next_previous = vec![usize::MAX; occupied.len()];
        for parent in frontier {
            for neighbor in face_neighbors(grid, parent).into_iter().flatten() {
                if !seen[neighbor]
                    && !grid.passive_void[neighbor]
                    && next_previous[neighbor] == usize::MAX
                {
                    next_previous[neighbor] = parent;
                }
            }
        }
        let mut next = next_previous
            .iter()
            .enumerate()
            .filter_map(|(index, parent)| (*parent != usize::MAX).then_some(index))
            .collect::<Vec<_>>();
        next.sort_by(|left, right| {
            solved_density[*right]
                .total_cmp(&solved_density[*left])
                .then_with(|| left.cmp(right))
        });
        for &index in &next {
            previous[index] = next_previous[index];
        }
        if let Some(goal) = next.iter().copied().find(|index| occupied[*index]) {
            let mut path = vec![goal];
            while previous[*path.last().expect("connector path has a goal")] != usize::MAX {
                path.push(previous[*path.last().expect("connector path has a predecessor")]);
            }
            return Some(path);
        }
        for &index in &next {
            seen[index] = true;
        }
        frontier = next;
    }
    None
}

fn connect_retained_components(grid: &Grid, solved_density: &[f32], occupied: &mut [bool]) {
    loop {
        let connected = connected_retained_component(grid, occupied);
        if occupied
            .iter()
            .enumerate()
            .all(|(index, occupied)| !occupied || connected[index])
        {
            return;
        }
        let connector = density_guided_connector(grid, solved_density, &connected, occupied)
            .expect("cannot connect retained seeds through non-void cells");
        for index in connector {
            occupied[index] = true;
        }
    }
}

fn target_occupied_count(grid: &Grid, target: f32) -> usize {
    let non_void_count = grid.passive_void.iter().filter(|void| !**void).count();
    ((target * non_void_count as f32 - 0.02 * non_void_count as f32) / 0.98)
        .round()
        .clamp(0.0, non_void_count as f32) as usize
}

fn grow_face_connected_by_density(
    grid: &Grid,
    solved_density: &[f32],
    occupied: &mut [bool],
    target_count: usize,
) {
    let mut occupied_count = occupied.iter().filter(|occupied| **occupied).count();
    while occupied_count < target_count {
        let mut candidate = vec![false; occupied.len()];
        for (index, is_occupied) in occupied.iter().copied().enumerate() {
            if !is_occupied {
                continue;
            }
            for neighbor in face_neighbors(grid, index).into_iter().flatten() {
                if !occupied[neighbor] && !grid.passive_void[neighbor] {
                    candidate[neighbor] = true;
                }
            }
        }
        let mut layer = candidate
            .iter()
            .enumerate()
            .filter_map(|(index, candidate)| candidate.then_some(index))
            .collect::<Vec<_>>();
        if layer.is_empty() {
            break;
        }
        layer.sort_by(|left, right| {
            solved_density[*right]
                .total_cmp(&solved_density[*left])
                .then_with(|| {
                    occupied_face_neighbor_count(grid, occupied, *right)
                        .cmp(&occupied_face_neighbor_count(grid, occupied, *left))
                })
                .then_with(|| left.cmp(right))
        });
        for index in layer {
            if occupied_count == target_count {
                return;
            }
            occupied[index] = true;
            occupied_count += 1;
        }
    }
}

pub(crate) fn reconstruct_load_path_web(
    grid: &Grid,
    solved_density: &[f32],
    required_path: &[bool],
    target: f32,
) -> Vec<f32> {
    assert_eq!(solved_density.len(), grid.node_count());
    assert_eq!(required_path.len(), grid.node_count());
    let mut occupied = required_path
        .iter()
        .zip(&grid.passive_solid)
        .zip(&grid.passive_void)
        .map(|((path, solid), void)| !void && (*path || *solid))
        .collect::<Vec<_>>();
    let seed_count = occupied.iter().filter(|occupied| **occupied).count();
    let target_count = target_occupied_count(grid, target);
    connect_retained_components(grid, solved_density, &mut occupied);
    if seed_count <= target_count
        && occupied.iter().filter(|occupied| **occupied).count() > target_count
    {
        panic!("material budget cannot connect retained seeds");
    }
    grow_face_connected_by_density(grid, solved_density, &mut occupied, target_count);
    occupied
        .iter()
        .enumerate()
        .map(|(index, active)| {
            if grid.passive_void[index] {
                0.0
            } else if *active {
                1.0
            } else {
                0.02
            }
        })
        .collect()
}

#[cfg(test)]
#[path = "reconstruct_tests.rs"]
mod tests;
