use super::{AssemblySolverInput, LoadPathGuideInput, SolverVolume};

#[derive(Clone)]
pub(crate) struct Grid {
    pub dimensions: [usize; 3],
    pub coordinates: Vec<[f32; 3]>,
    pub passive_solid: Vec<bool>,
    pub passive_void: Vec<bool>,
    pub fixed_dofs: Vec<bool>,
    pub load_cases: Vec<Vec<f32>>,
    pub cell_size_m: [f32; 3],
    pub youngs_modulus_pa: f32,
    pub failure_stress_pa: f32,
    pub minimum_load_path_width_m: f32,
    pub minimum_frame_thickness_m: f32,
    pub load_path_guides: Vec<LoadPathGuideInput>,
}

fn volume_contains(volume: &SolverVolume, point: [f32; 3]) -> bool {
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

fn volume_center(volume: &SolverVolume) -> [f32; 3] {
    match volume {
        SolverVolume::Box { center_m, .. } | SolverVolume::Cylinder { center_m, .. } => *center_m,
    }
}

fn planar_segment_distance(point: [f32; 3], start: [f32; 3], end: [f32; 3]) -> f32 {
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

pub(crate) fn assembly_grid(input: &AssemblySolverInput) -> Result<Grid, String> {
    let dimensions = [
        input.grid.dimensions.width,
        input.grid.dimensions.height,
        input.grid.dimensions.depth,
    ];
    let [width, height, depth] = dimensions;
    if !(32..=128).contains(&width) || !(32..=128).contains(&height) || !(8..=48).contains(&depth) {
        return Err("live assembly grid must be 32..128 by 32..128 by 8..48 cells".into());
    }
    if input
        .grid
        .cell_size_m
        .iter()
        .any(|value| !value.is_finite() || *value <= 0.0)
        || !input.material.youngs_modulus_pa.is_finite()
        || input.material.youngs_modulus_pa <= 0.0
        || !input.material.failure_stress_pa.is_finite()
        || input.material.failure_stress_pa <= 0.0
        || !input.minimum_load_path_width_m.is_finite()
        || input.minimum_load_path_width_m < input.minimum_feature_m
        || !input.minimum_frame_thickness_m.is_finite()
        || input.minimum_frame_thickness_m < input.minimum_feature_m
        || input.load_path_guides.is_empty()
        || input.load_path_guides.iter().any(|guide| {
            guide.id.is_empty()
                || guide.points_m.len() < 2
                || !guide.member_width_m.is_finite()
                || guide.member_width_m < input.minimum_feature_m
                || !guide.frame_thickness_m.is_finite()
                || guide.frame_thickness_m < input.minimum_feature_m
                || guide
                    .points_m
                    .iter()
                    .flatten()
                    .any(|value| !value.is_finite())
        })
    {
        return Err(
            "live assembly material and feature inputs must be positive finite SI values".into(),
        );
    }
    if input.motor_mounts.len() != 4 || input.supports.is_empty() {
        return Err(
            "live FPV solve requires four motor mounts and at least one body support".into(),
        );
    }
    let mut coordinates = Vec::with_capacity(width * height * depth);
    let mut passive_solid = Vec::with_capacity(width * height * depth);
    let mut passive_void = Vec::with_capacity(width * height * depth);
    let mut fixed_dofs = vec![false; width * height * depth * 3];
    let frame_center = volume_center(&input.supports[0]);
    for z in 0..depth {
        for y in 0..height {
            for x in 0..width {
                let point = [
                    input.grid.origin_m[0] + (x as f32 + 0.5) * input.grid.cell_size_m[0],
                    input.grid.origin_m[1] + (y as f32 + 0.5) * input.grid.cell_size_m[1],
                    input.grid.origin_m[2] + (z as f32 + 0.5) * input.grid.cell_size_m[2],
                ];
                let mount = input.motor_mounts.iter().any(|mount| {
                    let dx = point[0] - mount.center_m[0];
                    let dy = point[1] - mount.center_m[1];
                    dx.mul_add(dx, dy * dy) <= mount.radius_m * mount.radius_m
                        && (point[2] - mount.center_m[2]).abs()
                            <= input.minimum_frame_thickness_m * 0.5
                });
                let supported = input
                    .supports
                    .iter()
                    .any(|volume| volume_contains(volume, point));
                let required = input
                    .required_solids
                    .iter()
                    .any(|volume| volume_contains(volume, point));
                let void = input
                    .protected_voids
                    .iter()
                    .any(|volume| volume_contains(volume, point));
                let access = input
                    .access_voids
                    .iter()
                    .any(|volume| volume_contains(volume, point));
                let frame_layer = (point[2] - frame_center[2]).abs() <= 0.011;
                let core = (point[0] - frame_center[0]).hypot(point[1] - frame_center[1]) <= 0.046;
                let arm = input.motor_mounts.iter().any(|motor| {
                    planar_segment_distance(point, frame_center, motor.center_m) <= 0.022
                });
                let inside_domain = frame_layer && (core || arm);
                coordinates.push(point);
                // Tool access must win over the motor plate. Other component keep-outs do not
                // erase the load-bearing mount annulus or the real body fixture.
                passive_solid.push((mount || supported || required) && !access);
                passive_void.push(
                    access || ((!inside_domain || void) && !mount && !supported && !required),
                );
                let index = x + width * (y + height * z);
                if supported {
                    fixed_dofs[index * 3..index * 3 + 3].fill(true);
                }
            }
        }
    }
    if !fixed_dofs.iter().any(|fixed| *fixed) {
        return Err("live assembly support does not intersect the topology grid".into());
    }
    let mut load_cases = vec![vec![0.0; coordinates.len() * 3]; 4];
    for (motor_index, motor) in input.motor_mounts.iter().enumerate() {
        let nodes = coordinates
            .iter()
            .enumerate()
            .filter_map(|(index, point)| {
                let dx = point[0] - motor.center_m[0];
                let dy = point[1] - motor.center_m[1];
                (dx.mul_add(dx, dy * dy) <= motor.radius_m * motor.radius_m
                    && (point[2] - motor.center_m[2]).abs() <= input.grid.cell_size_m[2] * 1.5
                    && passive_solid[index])
                    .then_some(index)
            })
            .collect::<Vec<_>>();
        if nodes.is_empty() {
            return Err("live motor mount does not intersect the topology grid".into());
        }
        let node_count = nodes.len() as f32;
        for node in nodes {
            for axis in 0..3 {
                let force = motor.load_n[axis] / node_count;
                load_cases[0][node * 3 + axis] += force;
                let agility_sign = if motor.center_m[1] >= frame_center[1] {
                    1.0
                } else {
                    -1.0
                };
                load_cases[1][node * 3 + axis] += force * agility_sign * 0.65;
                let pitch_sign = if motor.center_m[0] >= frame_center[0] {
                    1.0
                } else {
                    -1.0
                };
                load_cases[2][node * 3 + axis] += force * pitch_sign * 0.65;
            }
            let radial = [
                motor.center_m[0] - frame_center[0],
                motor.center_m[1] - frame_center[1],
            ];
            let radius = radial[0].hypot(radial[1]).max(1.0e-6);
            let yaw_sign = if motor_index % 2 == 0 { 1.0 } else { -1.0 };
            let tangential_force = motor.load_n[2].abs() * 0.12 / node_count;
            load_cases[3][node * 3] += -radial[1] / radius * tangential_force * yaw_sign;
            load_cases[3][node * 3 + 1] += radial[0] / radius * tangential_force * yaw_sign;
        }
    }
    Ok(Grid {
        dimensions,
        coordinates,
        passive_solid,
        passive_void,
        fixed_dofs,
        load_cases,
        cell_size_m: input.grid.cell_size_m,
        youngs_modulus_pa: input.material.youngs_modulus_pa,
        failure_stress_pa: input.material.failure_stress_pa,
        minimum_load_path_width_m: input.minimum_load_path_width_m,
        minimum_frame_thickness_m: input.minimum_frame_thickness_m,
        load_path_guides: input.load_path_guides.clone(),
    })
}

impl Grid {
    pub fn index(&self, x: usize, y: usize, z: usize) -> usize {
        let [width, height, _] = self.dimensions;
        x + width * (y + height * z)
    }

    pub fn node_count(&self) -> usize {
        self.coordinates.len()
    }
}

fn disk(x: f32, y: f32, cx: f32, cy: f32, radius: f32) -> bool {
    (x - cx).mul_add(x - cx, (y - cy) * (y - cy)) <= radius * radius
}

pub(crate) fn drone_grid() -> Grid {
    let dimensions = [25, 25, 5];
    let [width, height, depth] = dimensions;
    let mut coordinates = Vec::with_capacity(width * height * depth);
    let mut passive_solid = Vec::with_capacity(width * height * depth);
    let mut passive_void = Vec::with_capacity(width * height * depth);
    let mut fixed_dofs = vec![false; width * height * depth * 3];
    let motor_centers = [[105.0, 0.0], [-105.0, 0.0], [0.0, 105.0], [0.0, -105.0]];

    for z in 0..depth {
        let wz = -10.0 + z as f32 * 5.0;
        for y in 0..height {
            let wy = -120.0 + y as f32 * 10.0;
            for x in 0..width {
                let wx = -120.0 + x as f32 * 10.0;
                let inside_domain = (wx.abs() <= 112.0 && wy.abs() <= 27.0)
                    || (wy.abs() <= 112.0 && wx.abs() <= 27.0)
                    || (wx.abs() <= 38.0 && wy.abs() <= 38.0);
                let mount = wz == 0.0
                    && motor_centers
                        .iter()
                        .any(|center| disk(wx, wy, center[0], center[1], 18.0));
                let core_ring = wx.abs() <= 30.0
                    && wy.abs() <= 30.0
                    && (wx.abs() >= 20.0 || wy.abs() >= 20.0)
                    && wz == 0.0;
                let motor_body = wz >= 5.0
                    && motor_centers
                        .iter()
                        .any(|center| disk(wx, wy, center[0], center[1], 16.0));
                let avionics = wx.abs() <= 30.0 && wy.abs() <= 30.0 && wz >= 5.0;
                let battery = wx.abs() <= 42.0 && wy.abs() <= 22.0 && wz <= -5.0;
                let cable_channel = wz >= 5.0
                    && ((wx.abs() > 28.0 && wx.abs() < 92.0 && wy.abs() < 4.0)
                        || (wy.abs() > 28.0 && wy.abs() < 92.0 && wx.abs() < 4.0));
                coordinates.push([wx, wy, wz]);
                let solid_interface = mount || core_ring;
                passive_solid.push(solid_interface);
                passive_void.push(
                    !solid_interface
                        && (!inside_domain || motor_body || avionics || battery || cable_channel),
                );
            }
        }
    }

    for (node, [x, y, _]) in coordinates.iter().copied().enumerate() {
        if x.abs() <= 30.0 && y.abs() <= 30.0 && (x.abs() >= 20.0 || y.abs() >= 20.0) {
            fixed_dofs[node * 3..node * 3 + 3].fill(true);
        }
    }

    let mut load_cases = vec![vec![0.0; coordinates.len() * 3]; 4];
    for (node, [x, y, z]) in coordinates.iter().copied().enumerate() {
        let at_mount = motor_centers
            .iter()
            .position(|center| disk(x, y, center[0], center[1], 12.0));
        if z == 0.0 {
            if let Some(motor) = at_mount {
                load_cases[0][node * 3 + 2] = -0.25;
                load_cases[1][node * 3 + 2] = match motor {
                    0 => -0.5,
                    1 => 0.5,
                    _ => 0.0,
                };
                load_cases[2][node * 3 + 2] = match motor {
                    2 => -0.5,
                    3 => 0.5,
                    _ => 0.0,
                };
                let tangent = [-y, x];
                let length = tangent[0].hypot(tangent[1]).max(1.0);
                load_cases[3][node * 3] = tangent[0] / length * 0.35;
                load_cases[3][node * 3 + 1] = tangent[1] / length * 0.35;
            }
        }
    }
    Grid {
        dimensions,
        coordinates,
        passive_solid,
        passive_void,
        fixed_dofs,
        load_cases,
        cell_size_m: [0.01, 0.01, 0.005],
        youngs_modulus_pa: 3_500_000_000.0,
        failure_stress_pa: 50_000_000.0,
        minimum_load_path_width_m: 0.01,
        minimum_frame_thickness_m: 0.005,
        load_path_guides: vec![],
    }
}
