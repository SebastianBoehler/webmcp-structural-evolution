use super::inertial_relief::{apply_inertial_relief, set_kinematic_stabilizers};
use super::raster::{
    volume_contains, volume_overlaps_cell,
};
use super::{AssemblySolverInput, LoadPathGuideInput};

#[derive(Clone)]
pub(crate) struct Grid {
    pub dimensions: [usize; 3],
    pub coordinates: Vec<[f32; 3]>,
    pub passive_solid: Vec<bool>,
    pub passive_void: Vec<bool>,
    pub fixed_dofs: Vec<bool>,
    pub load_case_ids: Vec<String>,
    pub load_cases: Vec<Vec<f32>>,
    pub cell_size_m: [f32; 3],
    pub youngs_modulus_pa: f32,
    pub failure_stress_pa: f32,
    pub minimum_load_path_width_m: f32,
    pub minimum_frame_thickness_m: f32,
    pub load_path_guides: Vec<LoadPathGuideInput>,
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
    if input.design_domain.is_empty() || input.load_cases.is_empty() || input.supports.is_empty() {
        return Err("assembly solve requires a design domain, load case, and support".into());
    }
    if input.load_cases.iter().any(|case| {
        case.id.is_empty()
            || case.loads.is_empty()
            || case.loads.iter().any(|load| load.force_n.iter().any(|value| !value.is_finite()))
    }) {
        return Err("assembly load cases require IDs and finite non-empty loads".into());
    }
    let mut coordinates = Vec::with_capacity(width * height * depth);
    let mut passive_solid = Vec::with_capacity(width * height * depth);
    let mut passive_void = Vec::with_capacity(width * height * depth);
    let mut fixed_dofs = vec![false; width * height * depth * 3];
    let mut support_nodes = Vec::new();
    for z in 0..depth {
        for y in 0..height {
            for x in 0..width {
                let point = [
                    input.grid.origin_m[0] + (x as f32 + 0.5) * input.grid.cell_size_m[0],
                    input.grid.origin_m[1] + (y as f32 + 0.5) * input.grid.cell_size_m[1],
                    input.grid.origin_m[2] + (z as f32 + 0.5) * input.grid.cell_size_m[2],
                ];
                let supported = input
                    .supports
                    .iter()
                    .any(|volume| volume_contains(volume, point));
                let required = input
                    .required_solids
                    .iter()
                    .any(|volume| volume_overlaps_cell(volume, point, input.grid.cell_size_m));
                let void = input
                    .protected_voids
                    .iter()
                    .any(|volume| volume_contains(volume, point));
                let access = input
                    .access_voids
                    .iter()
                    .any(|volume| volume_contains(volume, point));
                let inside_domain = input.design_domain.iter().any(|volume| volume_contains(volume, point));
                coordinates.push(point);
                // Access and component keep-outs win over generated/required material.
                // Loads are applied only to explicit retained structural interfaces.
                let structural = !access && (supported || (required && inside_domain && !void));
                let cell_void = access || (!supported && (void || !inside_domain));
                passive_solid.push(structural);
                passive_void.push(cell_void);
                let index = x + width * (y + height * z);
                if supported && !access {
                    support_nodes.push(index);
                }
            }
        }
    }
    if support_nodes.is_empty() {
        return Err("live assembly support does not intersect the topology grid".into());
    }
    set_kinematic_stabilizers(&mut fixed_dofs, &coordinates, &support_nodes)?;
    let mut load_cases = vec![vec![0.0; coordinates.len() * 3]; input.load_cases.len()];
    for (case_index, case) in input.load_cases.iter().enumerate() {
        for applied in &case.loads {
            let nodes = coordinates.iter().enumerate().filter_map(|(index, point)| {
                (volume_overlaps_cell(&applied.region, *point, input.grid.cell_size_m)
                    && passive_solid[index]).then_some(index)
            }).collect::<Vec<_>>();
            if nodes.is_empty() {
                return Err(format!("load region does not intersect the topology grid: {}", case.id));
            }
            let node_count = nodes.len() as f32;
            for node in nodes {
                for axis in 0..3 {
                    load_cases[case_index][node * 3 + axis] += applied.force_n[axis] / node_count;
                }
            }
        }
    }
    let solid_nodes = passive_solid
        .iter()
        .enumerate()
        .filter_map(|(index, solid)| solid.then_some(index))
        .collect::<Vec<_>>();
    if input.inertial_relief {
        apply_inertial_relief(
            &mut load_cases,
            &coordinates,
            &solid_nodes,
            &support_nodes,
            &input.inertial_masses,
        )?;
    }
    Ok(Grid {
        dimensions,
        coordinates,
        passive_solid,
        passive_void,
        fixed_dofs,
        load_case_ids: input.load_cases.iter().map(|case| case.id.clone()).collect(),
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
        load_case_ids: vec!["hover".into(), "roll-differential".into(), "pitch-differential".into(), "yaw-torsion".into()],
        load_cases,
        cell_size_m: [0.01, 0.01, 0.005],
        youngs_modulus_pa: 3_500_000_000.0,
        failure_stress_pa: 50_000_000.0,
        minimum_load_path_width_m: 0.01,
        minimum_frame_thickness_m: 0.005,
        load_path_guides: vec![],
    }
}
