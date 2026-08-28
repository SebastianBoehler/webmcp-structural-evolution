use super::SolverVolume;

pub(crate) fn volume_contains(volume: &SolverVolume, point: [f32; 3]) -> bool {
    match volume {
        SolverVolume::Box {
            center_m,
            size_m,
            yaw_rad,
        } => {
            let dx = point[0] - center_m[0];
            let dy = point[1] - center_m[1];
            let cosine = yaw_rad.cos();
            let sine = yaw_rad.sin();
            let local_x = cosine * dx + sine * dy;
            let local_y = -sine * dx + cosine * dy;
            local_x.abs() <= size_m[0] * 0.5
                && local_y.abs() <= size_m[1] * 0.5
                && (point[2] - center_m[2]).abs() <= size_m[2] * 0.5
        }
        SolverVolume::Cylinder {
            center_m,
            radius_m,
            height_m,
            ..
        } => {
            let dx = point[0] - center_m[0];
            let dy = point[1] - center_m[1];
            dx.mul_add(dx, dy * dy) <= radius_m * radius_m
                && (point[2] - center_m[2]).abs() <= height_m * 0.5
        }
    }
}

pub(crate) fn volume_overlaps_cell(
    volume: &SolverVolume,
    cell_center: [f32; 3],
    cell_size: [f32; 3],
) -> bool {
    match volume {
        SolverVolume::Box {
            center_m,
            size_m,
            yaw_rad,
        } => {
            let dx = cell_center[0] - center_m[0];
            let dy = cell_center[1] - center_m[1];
            let cosine = yaw_rad.cos();
            let sine = yaw_rad.sin();
            let box_half = [size_m[0] * 0.5, size_m[1] * 0.5];
            let cell_half = [cell_size[0] * 0.5, cell_size[1] * 0.5];
            let local_x = cosine * dx + sine * dy;
            let local_y = -sine * dx + cosine * dy;
            (cell_center[2] - center_m[2]).abs() <= size_m[2] * 0.5 + cell_size[2] * 0.5
                && local_x.abs()
                    <= box_half[0] + cosine.abs() * cell_half[0] + sine.abs() * cell_half[1]
                && local_y.abs()
                    <= box_half[1] + sine.abs() * cell_half[0] + cosine.abs() * cell_half[1]
                && dx.abs() <= cell_half[0] + cosine.abs() * box_half[0] + sine.abs() * box_half[1]
                && dy.abs() <= cell_half[1] + sine.abs() * box_half[0] + cosine.abs() * box_half[1]
        }
        SolverVolume::Cylinder {
            center_m,
            radius_m,
            height_m,
            ..
        } => {
            let dx = ((cell_center[0] - center_m[0]).abs() - cell_size[0] * 0.5).max(0.0);
            let dy = ((cell_center[1] - center_m[1]).abs() - cell_size[1] * 0.5).max(0.0);
            (cell_center[2] - center_m[2]).abs() <= height_m * 0.5 + cell_size[2] * 0.5
                && dx.mul_add(dx, dy * dy) <= radius_m * radius_m
        }
    }
}

pub(crate) fn volume_center(volume: &SolverVolume) -> [f32; 3] {
    match volume {
        SolverVolume::Box { center_m, .. } | SolverVolume::Cylinder { center_m, .. } => *center_m,
    }
}

pub(crate) fn planar_segment_distance(point: [f32; 3], start: [f32; 3], end: [f32; 3]) -> f32 {
    let delta = [end[0] - start[0], end[1] - start[1]];
    let length_squared = delta[0].mul_add(delta[0], delta[1] * delta[1]).max(1.0e-12);
    let projection = (((point[0] - start[0]) * delta[0] + (point[1] - start[1]) * delta[1])
        / length_squared)
        .clamp(0.0, 1.0);
    let nearest = [
        start[0] + projection * delta[0],
        start[1] + projection * delta[1],
    ];
    (point[0] - nearest[0]).hypot(point[1] - nearest[1])
}
