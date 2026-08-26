#[derive(Clone)]
pub(crate) struct Grid {
    pub dimensions: [usize; 3],
    pub coordinates: Vec<[f32; 3]>,
    pub passive_solid: Vec<bool>,
    pub passive_void: Vec<bool>,
    pub fixed_dofs: Vec<bool>,
    pub load_cases: Vec<Vec<f32>>,
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
    Grid { dimensions, coordinates, passive_solid, passive_void, fixed_dofs, load_cases }
}
