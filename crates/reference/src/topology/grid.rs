use super::{AssemblySolverInput, SolverVolume};

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
}

fn volume_contains(volume: &SolverVolume, point: [f32; 3]) -> bool {
    match volume {
        SolverVolume::Box { center_m, size_m, yaw_rad } => {
            let dx = point[0] - center_m[0];
            let dy = point[1] - center_m[1];
            let cosine = yaw_rad.cos();
            let sine = yaw_rad.sin();
            let local_x = cosine * dx + sine * dy;
            let local_y = -sine * dx + cosine * dy;
            local_x.abs() <= size_m[0] * 0.5 && local_y.abs() <= size_m[1] * 0.5
                && (point[2] - center_m[2]).abs() <= size_m[2] * 0.5
        }
        SolverVolume::Cylinder { center_m, radius_m, height_m, .. } => {
            let dx = point[0] - center_m[0];
            let dy = point[1] - center_m[1];
            dx.mul_add(dx, dy * dy) <= radius_m * radius_m
                && (point[2] - center_m[2]).abs() <= height_m * 0.5
        }
    }
}

pub(crate) fn assembly_grid(input: &AssemblySolverInput) -> Result<Grid, String> {
    let dimensions = [input.grid.dimensions.width, input.grid.dimensions.height, input.grid.dimensions.depth];
    let [width, height, depth] = dimensions;
    if !(32..=64).contains(&width) || !(32..=64).contains(&height) || !(8..=32).contains(&depth) {
        return Err("live assembly grid must be 32..64 by 32..64 by 8..32 cells".into());
    }
    if input.grid.cell_size_m.iter().any(|value| !value.is_finite() || *value < input.minimum_feature_m)
        || !input.material.youngs_modulus_pa.is_finite() || input.material.youngs_modulus_pa <= 0.0
        || !input.material.failure_stress_pa.is_finite() || input.material.failure_stress_pa <= 0.0 {
        return Err("live assembly material and feature inputs must be positive finite SI values".into());
    }
    if input.motor_mounts.len() != 4 || input.supports.is_empty() {
        return Err("live FPV solve requires four motor mounts and at least one body support".into());
    }
    let mut coordinates = Vec::with_capacity(width * height * depth);
    let mut passive_solid = Vec::with_capacity(width * height * depth);
    let mut passive_void = Vec::with_capacity(width * height * depth);
    let mut fixed_dofs = vec![false; width * height * depth * 3];
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
                        && (point[2] - mount.center_m[2]).abs() <= input.grid.cell_size_m[2] * 1.5
                });
                let supported = input.supports.iter().any(|volume| volume_contains(volume, point));
                let void = input.protected_voids.iter().any(|volume| volume_contains(volume, point));
                coordinates.push(point);
                // Both motor plates and the real body fixture remain immutable interfaces.
                passive_solid.push(mount || supported);
                passive_void.push(void && !mount && !supported);
                let index = x + width * (y + height * z);
                if supported { fixed_dofs[index * 3..index * 3 + 3].fill(true); }
            }
        }
    }
    if !fixed_dofs.iter().any(|fixed| *fixed) { return Err("live assembly support does not intersect the topology grid".into()); }
    let mut load_cases = vec![vec![0.0; coordinates.len() * 3]; 4];
    for (motor_index, motor) in input.motor_mounts.iter().enumerate() {
        let nodes = coordinates.iter().enumerate().filter_map(|(index, point)| {
            let dx = point[0] - motor.center_m[0];
            let dy = point[1] - motor.center_m[1];
            (dx.mul_add(dx, dy * dy) <= motor.radius_m * motor.radius_m
                && (point[2] - motor.center_m[2]).abs() <= input.grid.cell_size_m[2] * 1.5).then_some(index)
        }).collect::<Vec<_>>();
        if nodes.is_empty() { return Err("live motor mount does not intersect the topology grid".into()); }
        for node in nodes {
            let scale = 1.0 / input.motor_mounts.iter().filter(|candidate| candidate.center_m == motor.center_m).count() as f32;
            for axis in 0..3 {
                let force = motor.load_n[axis] / nodes_for_motor(input, motor) as f32;
                load_cases[0][node * 3 + axis] += force;
                let agility_sign = if motor_index % 2 == 0 { 1.0 } else { -1.0 };
                load_cases[1][node * 3 + axis] += force * agility_sign * 0.65;
                let pitch_sign = if motor_index < 2 { 1.0 } else { -1.0 };
                load_cases[2][node * 3 + axis] += force * pitch_sign * 0.65;
                let tangent = [-motor.center_m[1], motor.center_m[0], 0.0];
                load_cases[3][node * 3 + axis] += force * scale * tangent[axis] * 3.5;
            }
        }
    }
    Ok(Grid { dimensions, coordinates, passive_solid, passive_void, fixed_dofs, load_cases,
        cell_size_m: input.grid.cell_size_m, youngs_modulus_pa: input.material.youngs_modulus_pa,
        failure_stress_pa: input.material.failure_stress_pa })
}

fn nodes_for_motor(input: &AssemblySolverInput, motor: &super::MotorMountInput) -> usize {
    let [width, height, depth] = [input.grid.dimensions.width, input.grid.dimensions.height, input.grid.dimensions.depth];
    let mut count = 0;
    for z in 0..depth { for y in 0..height { for x in 0..width {
        let point = [input.grid.origin_m[0] + (x as f32 + 0.5) * input.grid.cell_size_m[0], input.grid.origin_m[1] + (y as f32 + 0.5) * input.grid.cell_size_m[1], input.grid.origin_m[2] + (z as f32 + 0.5) * input.grid.cell_size_m[2]];
        let dx = point[0] - motor.center_m[0]; let dy = point[1] - motor.center_m[1];
        if dx.mul_add(dx, dy * dy) <= motor.radius_m * motor.radius_m && (point[2] - motor.center_m[2]).abs() <= input.grid.cell_size_m[2] * 1.5 { count += 1; }
    }}}
    count.max(1)
}

impl Grid {
    pub fn index(&self, x: usize, y: usize, z: usize) -> usize {
        let [width, height, _] = self.dimensions;
        x + width * (y + height * z)
    }

    pub fn node_count(&self) -> usize { self.coordinates.len() }
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
                    && motor_centers.iter().any(|center| disk(wx, wy, center[0], center[1], 18.0));
                let core_ring = wx.abs() <= 30.0 && wy.abs() <= 30.0
                    && (wx.abs() >= 20.0 || wy.abs() >= 20.0) && wz == 0.0;
                let motor_body = wz >= 5.0
                    && motor_centers.iter().any(|center| disk(wx, wy, center[0], center[1], 16.0));
                let avionics = wx.abs() <= 30.0 && wy.abs() <= 30.0 && wz >= 5.0;
                let battery = wx.abs() <= 42.0 && wy.abs() <= 22.0 && wz <= -5.0;
                let cable_channel = wz >= 5.0 && (
                    (wx.abs() > 28.0 && wx.abs() < 92.0 && wy.abs() < 4.0)
                    || (wy.abs() > 28.0 && wy.abs() < 92.0 && wx.abs() < 4.0)
                );
                coordinates.push([wx, wy, wz]);
                let solid_interface = mount || core_ring;
                passive_solid.push(solid_interface);
                passive_void.push(!solid_interface && (!inside_domain || motor_body || avionics || battery || cable_channel));
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
        let at_mount = motor_centers.iter().position(|center| disk(x, y, center[0], center[1], 12.0));
        if z == 0.0 {
            if let Some(motor) = at_mount {
                load_cases[0][node * 3 + 2] = -0.25;
                load_cases[1][node * 3 + 2] = match motor { 0 => -0.5, 1 => 0.5, _ => 0.0 };
                load_cases[2][node * 3 + 2] = match motor { 2 => -0.5, 3 => 0.5, _ => 0.0 };
                let tangent = [-y, x];
                let length = tangent[0].hypot(tangent[1]).max(1.0);
                load_cases[3][node * 3] = tangent[0] / length * 0.35;
                load_cases[3][node * 3 + 1] = tangent[1] / length * 0.35;
            }
        }
    }
    Grid { dimensions, coordinates, passive_solid, passive_void, fixed_dofs, load_cases,
        cell_size_m: [0.01, 0.01, 0.005], youngs_modulus_pa: 3_500_000_000.0, failure_stress_pa: 50_000_000.0 }
}
