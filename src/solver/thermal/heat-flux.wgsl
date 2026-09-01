struct GridParams {
  dimensions: vec3<u32>, count: u32,
  cell_size_m: f32, face_area_m2: f32,
  _padding: vec2<u32>,
}

@group(0) @binding(0) var<uniform> params: GridParams;
@group(0) @binding(1) var<storage, read> active_cells: array<u32>;
@group(0) @binding(2) var<storage, read> fixed: array<u32>;
@group(0) @binding(3) var<storage, read> conductivity: array<f32>;
@group(0) @binding(4) var<storage, read> temperature: array<f32>;
@group(0) @binding(5) var<storage, read> boundary_face_flux: array<f32>;
@group(0) @binding(6) var<storage, read> boundary_face_area: array<f32>;
@group(0) @binding(7) var<storage, read_write> face_flux: array<f32>;
@group(0) @binding(8) var<storage, read_write> face_area: array<f32>;
@group(0) @binding(9) var<storage, read_write> flux_vector: array<f32>;
@group(0) @binding(10) var<storage, read_write> thermostat_power: array<f32>;
@group(0) @binding(11) var<storage, read> source_power: array<f32>;

fn neighbor(cell: u32, axis: u32, direction: i32) -> i32 {
  let width = params.dimensions.x;
  let plane = width * params.dimensions.y;
  let z = cell / plane;
  let remainder = cell - z * plane;
  let y = remainder / width;
  let x = remainder - y * width;
  var coordinate = x;
  var stride = 1u;
  var extent = params.dimensions.x;
  if (axis == 1u) { coordinate = y; stride = width; extent = params.dimensions.y; }
  if (axis == 2u) { coordinate = z; stride = plane; extent = params.dimensions.z; }
  if (direction < 0 && coordinate == 0u) { return -1; }
  if (direction > 0 && coordinate + 1u >= extent) { return -1; }
  return i32(cell) + direction * i32(stride);
}

fn harmonic(left: f32, right: f32) -> f32 {
  return 2.0 / (1.0 / left + 1.0 / right);
}

@compute @workgroup_size(64)
fn derive_face_heat_flux(@builtin(global_invocation_id) id: vec3<u32>) {
  let cell = id.x;
  if (cell >= params.count) { return; }
  for (var axis = 0u; axis < 3u; axis += 1u) {
    for (var side = 0u; side < 2u; side += 1u) {
      let slot = cell * 6u + axis * 2u + side;
      face_flux[slot] = 0.0;
      face_area[slot] = 0.0;
      if (active_cells[cell] == 0u) { continue; }
      let direction = select(-1, 1, side == 1u);
      let candidate = neighbor(cell, axis, direction);
      if (candidate >= 0 && active_cells[u32(candidate)] != 0u) {
        let adjacent = u32(candidate);
        face_flux[slot] = -harmonic(conductivity[cell], conductivity[adjacent])
          * (temperature[adjacent] - temperature[cell]) / params.cell_size_m;
        face_area[slot] = params.face_area_m2;
      } else if (boundary_face_area[slot] > 0.0) {
        face_flux[slot] = boundary_face_flux[slot];
        face_area[slot] = boundary_face_area[slot];
      }
    }
  }
}

@compute @workgroup_size(64)
fn project_heat_flux(@builtin(global_invocation_id) id: vec3<u32>) {
  let cell = id.x;
  if (cell >= params.count) { return; }
  for (var axis = 0u; axis < 3u; axis += 1u) {
    let minus = cell * 6u + axis * 2u;
    let plus = minus + 1u;
    let represented = face_area[minus] + face_area[plus];
    flux_vector[cell * 3u + axis] = select(
      0.0,
      (-face_flux[minus] * face_area[minus] + face_flux[plus] * face_area[plus]) / represented,
      represented > 0.0,
    );
  }
}

@compute @workgroup_size(64)
fn derive_thermostat_power(@builtin(global_invocation_id) id: vec3<u32>) {
  let cell = id.x;
  if (cell >= params.count || active_cells[cell] == 0u || fixed[cell] == 0u) {
    if (cell < params.count) { thermostat_power[cell] = 0.0; }
    return;
  }
  var reaction = 0.0;
  for (var axis = 0u; axis < 3u; axis += 1u) {
    for (var direction = -1; direction <= 1; direction += 2) {
      let candidate = neighbor(cell, axis, direction);
      if (candidate < 0 || active_cells[u32(candidate)] == 0u) { continue; }
      let adjacent = u32(candidate);
      reaction += harmonic(conductivity[cell], conductivity[adjacent])
        * params.face_area_m2 / params.cell_size_m * (temperature[cell] - temperature[adjacent]);
    }
  }
  thermostat_power[cell] = reaction - source_power[cell];
}
